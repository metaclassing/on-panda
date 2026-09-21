import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { preview } from 'vite'
import { fileURLToPath } from 'node:url'
const model = 'fixture-model'
const outputDir = fileURLToPath(new URL('../test-results/chat-ui/', import.meta.url))
await fs.mkdir(outputDir, { recursive: true })
// Serve only static assets. No inference proxy or deployment config is loaded.
const server = await preview({
  configFile: false, envDir: false,
  root: fileURLToPath(new URL('../packages/serve/', import.meta.url)),
  build: { outDir: 'web' },
  preview: { host: '127.0.0.1', port: 0, open: false },
})
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const config = {
  apiConfigs: [{
    endpoint_name: 'fixture', tag_name: model,
    client_config: { base_url: 'https://api.example.test/v1', api_key: 'fixture-only' },
    chat_config: { model, max_tokens: 128 },
    response_template: { name_or_path: 'deepseek-ai/DeepSeek-V4-Flash', continuation: 'vllm_deepseek_v4' },
  }],
  modelName: model,
  messages: [{ role: 'system', content: '' }, { role: 'user', content: '' }],
}
const report = { requests: [], checks: {}, errors: [] }
function sse(choices) { return choices.map(choice => `data: ${JSON.stringify({ model, choices: [{ index: 0, ...choice }] })}\n\n`).join('') + 'data: [DONE]\n\n' }
const alternatives = Array.from({ length: 20 }, (_, i) => ({ token: i === 0 ? 'Alpha' : i === 1 ? 'Omega' : `Alternative${i}`, logprob: -i - 0.2 }))
const chunks = [{ delta: { role: 'assistant', reasoning: 'Check the response.\n\n' } }]
for (const text of ['Alpha', '\n', 'Beta', '\n', 'Gamma', '\n', ...Array.from({ length: 70 }, (_, i) => `More output on line ${i + 4}.\n`)]) {
  chunks.push({ delta: { content: text }, logprobs: { content: [{ token: text, logprob: -0.2, top_logprobs: text === 'Alpha' ? alternatives : [{ token: text, logprob: -0.2 }] }] } })
}
chunks.push({ delta: {}, finish_reason: 'stop' })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.setDefaultTimeout(10000)
page.on('pageerror', e => report.errors.push(e.message))
await page.addInitScript(() => {
  window.testState = () => {
    function find(vnode) {
      if (!vnode || typeof vnode !== 'object') return null
      if (vnode.props?.dialogWithControlState) return vnode.props.dialogWithControlState
      if (vnode.component) { const r = find(vnode.component.subTree); if (r) return r }
      for (const c of Array.isArray(vnode.children) ? vnode.children : []) { const r = find(c); if (r) return r }
    }
    return find(document.querySelector('#app')?._vnode)
  }
})
await page.route('**/*', async route => {
  const url = route.request().url()
  if (url === `${origin}/on-panda-web/web_config.json5`) return route.fulfill({ json: config })
  if (new URL(url).origin === origin && !url.includes('/bypass-CORS/') && route.request().method() === 'GET') {
    return route.continue()
  }
  if (!url.startsWith('https://api.example.test/v1/')) {
    report.errors.push('Unexpected request: ' + url)
    return route.abort()
  }
  if (url.endsWith('/models')) return route.fulfill({ json: { data: [{ id: model }] } })
  const body = route.request().postDataJSON()
  if (url.endsWith('/chat/completions/render')) return route.fulfill({ json: { token_ids: [0, 128821] } })
  if (url.endsWith('/completions/render')) return route.fulfill({ json: [{ token_ids: [128821, ...Array.from(body.prompt.slice(7), c => c.codePointAt(0))] }] })
  if (url.endsWith('/completions')) {
    report.requests.push({ url, body })
    return route.fulfill({ contentType: 'text/event-stream', body: body.messages ? sse(chunks) : sse([
      { text: ' [branch]', logprobs: { tokens: [' [branch]'], token_logprobs: [-0.1], top_logprobs: [{ ' [branch]': -0.1 }] }, finish_reason: 'stop' },
    ]) })
  }
  report.errors.push('Unmocked API call: ' + url)
  return route.abort()
})
async function send(text) {
  const response = page.waitForResponse(r => r.url().endsWith('/chat/completions'))
  await page.getByPlaceholder('Message your model…').fill(text)
  await page.getByPlaceholder('Message your model…').press('Enter')
  await (await response).finished()
  await page.waitForFunction(() => !window.testState().agenticLoopStatus.running)
}
async function check(name, fn) {
  try { report.checks[name] = { passed: true, ...(await fn()) }; console.log('PASS', name) }
  catch (e) { report.checks[name] = { passed: false, error: e.message }; console.log('FAIL', name, e.message.slice(0,800)) }
}
async function closePicker() {
  await page.keyboard.press('Escape')
  await page.mouse.move(3, 3)
}
async function hoverAlphaAt(y) {
  await closePicker()
  const alpha = page.locator('.PatchSpan').filter({ hasText: /^Alpha$/ })
  await alpha.evaluate((el, y) => {
    const transcript = el.closest('.chat-transcript')
    transcript.scrollTop += el.getBoundingClientRect().top - y
  }, y)
  await alpha.hover()
  await page.waitForTimeout(50)
  return alpha
}
async function activeToken() { return page.locator('.ActivatePatchSpan').textContent() }
try {
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.testState()?.apiConfig.value.response_template?.continuation)
  await check('composer_keyboard_without_buttons', async () => {
    const input = page.getByPlaceholder('Message your model…')
    await input.fill('First question')
    await input.press('Shift+Enter')
    await input.type('second line')
    assert.equal(report.requests.length, 0)
    assert.equal(await page.locator('.chat-composer button:visible').count(), 0)
    assert.equal(await page.getByText('Enter to send · Shift+Enter for a new line', { exact: true }).count(), 0)
    const response = page.waitForResponse(r => r.url().endsWith('/chat/completions'))
    await input.press('Enter'); await (await response).finished()
    await page.waitForFunction(() => !window.testState().agenticLoopStatus.running)
    assert.equal(report.requests.at(-1).body.messages.at(-1).content, 'First question\nsecond line')
    assert.equal(await page.locator('.active-response').getByRole('button', { name: 'Regenerate this response', exact: true }).count(), 1)
    assert.equal(await page.locator('.chat-composer').getByRole('button', { name: /Regenerate/ }).count(), 0)
  })
  const originalKey = await page.evaluate(() => String(window.testState().pandaState.currentDialogKey.value))
  await page.getByRole('tab', { name: 'Tokens', exact: true }).click()
  await check('long_chat_has_one_vertical_scroll_owner', async () => {
    const data = await page.evaluate(() => ({
      bodyOverflow: document.documentElement.scrollHeight > innerHeight + 1,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      scrollers: [...document.querySelectorAll('.chat-main, .chat-main *')].filter(el => {
        const style = getComputedStyle(el)
        return el.getClientRects().length && /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
      }).map(el => el.className),
    }))
    assert.equal(data.bodyOverflow, false)
    assert.equal(data.horizontalOverflow, false)
    assert.deepEqual(data.scrollers, ['chat-transcript'])
    return data
  })
  await check('slow_pointer_journey_down_and_up', async () => {
    const paths = []
    for (const y of [150, 580]) {
      await page.setViewportSize({ width: 1280, height: y === 150 ? 900 : 600 })
      const alpha = await hoverAlphaAt(y)
      const a = await alpha.boundingBox()
      const p = await page.locator('.token-picker').boundingBox()
      const below = p.y > a.y
      const bx = a.x + 2
      const by = below ? a.y + a.height + 6 : a.y - 6
      await page.mouse.move(bx, by, { steps: 10 })
      await page.waitForTimeout(500)
      assert.equal(await activeToken(), 'Alpha', 'Crossing the next line changed the picker anchor')
      const option = page.locator('.token-candidate').filter({ hasText: /^"Omega"/ })
      const o = await option.boundingBox()
      const start = { x: bx, y: by }, end = { x: o.x + 4, y: o.y + o.height/2 }
      for (let step = 1; step <= 12; step++) {
        await page.mouse.move(start.x + (end.x-start.x)*step/12, start.y + (end.y-start.y)*step/12)
        await page.waitForTimeout(35)
        assert.equal(await activeToken(), 'Alpha')
      }
      const scrollers = await page.locator('.token-picker').evaluate(root => [root, ...root.querySelectorAll('*')].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1).length)
      assert.equal(scrollers, 1)
      const scrollBefore = await page.locator('.chat-transcript').evaluate(el => el.scrollTop)
      await page.mouse.wheel(0, 800)
      await page.waitForTimeout(100)
      assert.equal(await page.locator('.chat-transcript').evaluate(el => el.scrollTop), scrollBefore)
      assert.equal(await activeToken(), 'Alpha')
      paths.push({ direction: below ? 'down' : 'up', scrollers })
    }
    await closePicker()
    assert.deepEqual(paths.map(p => p.direction), ['down', 'up'])
    await page.setViewportSize({ width: 1280, height: 900 })
    return { paths }
  })
  await check('candidate_click_uses_original_token', async () => {
    const alpha = await hoverAlphaAt(160)
    const a = await alpha.boundingBox()
    await page.mouse.move(a.x + a.width/2, a.y + a.height + 6, { steps: 5 })
    const response = page.waitForResponse(r => r.url().endsWith('/completions') && !r.url().endsWith('/chat/completions'))
    await page.locator('.token-candidate').filter({ hasText: /^"Omega"/ }).click()
    await (await response).finished()
    await page.waitForFunction(() => !window.testState().agenticLoopStatus.running)
    assert.equal(await page.evaluate(() => window.testState().finalMessage.value.content), 'Omega [branch]')
    await page.getByRole('button', { name: new RegExp(`^Branch ${originalKey}:`) }).click()
    assert.ok((await page.evaluate(() => window.testState().finalMessage.value.content)).startsWith('Alpha\nBeta'))
  })
  await check('regenerate_targets_historical_response', async () => {
    await closePicker()
    await send('Second question; preserve this branch.')
    const previousKey = await page.evaluate(() => String(window.testState().pandaState.currentDialogKey.value))
    const regen = page.locator('.chat-message-assistant:not(.active-response)').getByRole('button', { name: /^Regenerate response/ }).first()
    const response = page.waitForResponse(r => r.url().endsWith('/chat/completions'))
    await regen.click(); await (await response).finished()
    await page.waitForFunction(() => !window.testState().agenticLoopStatus.running)
    const userMessages = report.requests.at(-1).body.messages.filter(m => m.role === 'user')
    assert.deepEqual(userMessages.map(m => m.content), ['First question\nsecond line'])
    await page.getByRole('button', { name: new RegExp(`^Branch ${previousKey}:`) }).click()
    assert.ok(await page.getByText('Second question; preserve this branch.', { exact: true }).count())
    await page.locator('.active-response .finalMessageHeadBar').scrollIntoViewIfNeeded()
    await page.screenshot({ path: outputDir + 'desktop.png' })
  })
  await check('mobile_chat_layout', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.active-response .finalMessageHeadBar').scrollIntoViewIfNeeded()
    await page.screenshot({ path: outputDir + 'mobile.png' })
    const controls = await page.locator('.active-response .finalMessageControlButtons').boundingBox()
    assert.ok(controls.x + controls.width <= 390, 'Response controls overflow on mobile')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1), false)
    assert.equal(await page.locator('.chat-composer button:visible').count(), 0)
  })
  assert.deepEqual(report.errors, [])
} finally {
  await fs.writeFile(outputDir + 'report.json', JSON.stringify(report, null, 2))
  await browser.close()
  server.httpServer.closeAllConnections()
  await new Promise(resolve => server.httpServer.close(resolve))
}
if (Object.values(report.checks).some(c => !c.passed)) process.exitCode = 1
