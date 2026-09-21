import { mergeHeaders, omitNullRequestFields, parseSseJsonStream } from './utils.js'

// Some native DS4 tokenizers ignore continue_final_message. Render the
// conversation without its final assistant message, then append that assistant
// prefix as raw tokens. Never send the prefix through the chat template twice.
export async function createVllmDeepSeekContinuationStream({ requestBody, apiConfig, signal }) {
    const { base_url, api_key, extra_headers } = apiConfig.client_config
    const headers = mergeHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${api_key}` }, extra_headers)
    async function post(path, body) {
        const response = await fetch(`${base_url.replace(/\/$/, '')}/${path}`, {
            method: 'POST', headers, signal, body: JSON.stringify(omitNullRequestFields(body)),
        })
        if (!response.ok) throw new Error(`DeepSeek continuation: ${response.status} ${await response.text()}`)
        return response
    }

    const prefix = requestBody.messages.at(-1)?.content
    if (typeof prefix !== 'string' || !/^<\/?think>/.test(prefix)) {
        throw new Error('DeepSeek continuation requires a complete reasoning boundary at the start of the prefix.')
    }
    const baseBody = { ...requestBody, messages: requestBody.messages.slice(0, -1),
        add_generation_prompt: true, continue_final_message: false, stream: false }
    delete baseBody.stream_options
    const base = await (await post('chat/completions/render', baseBody)).json()
    const renderedPrefix = await (await post('completions/render', {
        model: requestBody.model, prompt: prefix, add_special_tokens: false, max_tokens: 1,
    })).json()
    const partial = Array.isArray(renderedPrefix) ? renderedPrefix[0] : renderedPrefix
    const prompt = joinDeepSeekContinuation(base.token_ids, partial.token_ids)

    // Retain sampler controls; remove chat-only fields. Raw completions must keep
    // the reasoning/tool markers so the existing response template can parse them.
    const body = { ...requestBody, prompt, add_special_tokens: false, echo: false,
        max_tokens: requestBody.max_completion_tokens ?? requestBody.max_tokens,
        logprobs: requestBody.logprobs ? requestBody.top_logprobs ?? 0 : null,
        skip_special_tokens: false, spaces_between_special_tokens: false,
        return_token_ids: true }
    for (const key of ['messages', 'tools', 'tool_choice', 'parallel_tool_calls', 'top_logprobs',
        'continue_final_message', 'add_generation_prompt', 'chat_template', 'chat_template_kwargs',
        'reasoning_effort', 'reasoning', 'max_completion_tokens']) delete body[key]
    if (body.stream === false) delete body.stream_options
    const response = await post('completions', body)
    if (body.stream === false) {
        const completion = await response.json()
        return (async function* () { yield completionToChatChunk(completion) })()
    }
    return (async function* () {
        for await (const chunk of parseSseJsonStream(response)) yield completionToChatChunk(chunk)
    })()
}

export function joinDeepSeekContinuation(base, partial) {
    if (!Array.isArray(base) || !base.length || !Array.isArray(partial) || !partial.length || base.at(-1) !== partial[0]) {
        throw new Error('DeepSeek prompt boundary changed; refusing to resume with a mismatched prefix.')
    }
    // Both contain the same opening reasoning-mode token. Keep exactly one.
    return base.slice(0, -1).concat(partial)
}

export function completionToChatChunk(chunk) {
    if (chunk.error) return chunk
    return { ...chunk, object: 'chat.completion.chunk', choices: (chunk.choices || []).map(choice => {
        const { text, logprobs, ...metadata } = choice
        return { ...metadata, delta: { content: text || '' },
            logprobs: logprobs ? { content: logprobs.tokens.map((token, index) => ({
                token, logprob: logprobs.token_logprobs[index],
                top_logprobs: Object.entries(logprobs.top_logprobs?.[index] || {}).map(([token, logprob]) => ({ token, logprob })),
            })) } : null }
    }) }
}
