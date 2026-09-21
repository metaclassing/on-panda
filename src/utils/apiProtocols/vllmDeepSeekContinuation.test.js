import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVllmDeepSeekContinuationStream, joinDeepSeekContinuation, completionToChatChunk } from './vllmDeepSeekContinuation.js'

test('resume after exactly one reasoning boundary without inserting EOS', () => {
    assert.deepEqual(joinDeepSeekContinuation([0, 10, 128821], [128821, 2581]), [0, 10, 128821, 2581])
    assert.deepEqual(joinDeepSeekContinuation([0, 10, 128821], [128821, 2581, 128822, 22]), [0, 10, 128821, 2581, 128822, 22])
    assert.deepEqual(joinDeepSeekContinuation([0, 10, 128822], [128822, 22]), [0, 10, 128822, 22])
    assert.throws(() => joinDeepSeekContinuation([0, 10, 1], [128821, 2581]), /mismatched prefix/)
})

test('completion logprobs preserve chosen token and distinct candidate probabilities', () => {
    const chunk = completionToChatChunk({ choices: [{ text: ' cat', token_ids: [123],
        logprobs: { tokens: [' cat'], token_logprobs: [-3.5], top_logprobs: [{ ' dog': -0.1, ' cat': -3.5 }] } }] })
    assert.equal(chunk.choices[0].delta.content, ' cat')
    assert.ok(!('text' in chunk.choices[0]), 'Do not duplicate the entire non-stream response on every split token')
    assert.deepEqual(chunk.choices[0].token_ids, [123])
    assert.deepEqual(chunk.choices[0].logprobs.content[0], {
        token: ' cat', logprob: -3.5, top_logprobs: [{ token: ' dog', logprob: -0.1 }, { token: ' cat', logprob: -3.5 }],
    })
})

test('chat renderer sees only prior turns; raw continuation retains sampler and abort signal', async t => {
    const calls = []
    const chunks = [{ choices: [{ index: 0, text: ' need', logprobs: null, token_ids: [1309], finish_reason: null }] },
        { choices: [], usage: { completion_tokens: 1 } }]
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body), signal: options.signal })
        if (url.endsWith('/chat/completions/render')) return Response.json({ token_ids: [0, 10, 128821] })
        if (url.endsWith('/completions/render')) return Response.json([{ token_ids: [128821, 2581] }])
        return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n')
    })
    const signal = new AbortController().signal
    const stream = await createVllmDeepSeekContinuationStream({
        signal,
        apiConfig: { client_config: { base_url: 'http://example.test/v1', api_key: 'test' } },
        requestBody: { model: 'ds4', messages: [{ role: 'user', content: 'question' }, { role: 'assistant', content: '<think>We' }],
            stream: true, logprobs: true, top_logprobs: 20, temperature: 1, top_p: 0.95, max_tokens: 64,
            continue_final_message: true, add_generation_prompt: false, chat_template_kwargs: { reasoning_effort: 'low' } },
    })
    const output = []
    for await (const chunk of stream) output.push(chunk)
    assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'question' }])
    assert.equal(calls[0].body.continue_final_message, false)
    assert.deepEqual(calls[0].body.chat_template_kwargs, { reasoning_effort: 'low' })
    assert.deepEqual(calls[2].body.prompt, [0, 10, 128821, 2581])
    assert.equal(calls[2].body.logprobs, 20)
    assert.equal(calls[2].body.temperature, 1)
    assert.equal(calls[2].body.top_p, 0.95)
    assert.equal(calls[2].body.max_tokens, 64)
    assert.equal(calls[2].body.skip_special_tokens, false)
    assert.equal(calls[2].body.add_special_tokens, false)
    assert.ok(!('messages' in calls[2].body))
    assert.ok(!('chat_template_kwargs' in calls[2].body))
    assert.ok(calls.every(call => call.signal === signal))
    assert.equal(output[0].choices[0].delta.content, ' need')
    assert.equal(output[1].usage.completion_tokens, 1)
})
