# Chat interface and token branching

This fork opens in a compact, dark chat view. Settings contains model and sampling
controls, the system prompt, and a switch back to the original workbench.

- Open **Tokens** on a response to inspect probabilities and choose an alternative.
  The branch sidebar keeps the original response and its descendants available.
- Reasoning starts collapsed in both rendered responses and the token view.
  Folding it does not change token positions or continuation prefixes.
- The token picker leaves room around the selected token and keeps its anchor
  while the pointer crosses adjacent lines. Its candidate list scrolls inside
  one popup; the chat transcript scrolls separately.
- **Regenerate** belongs to a response. Regenerating an earlier response branches
  from the preceding user message and preserves the later conversation.
- Enter sends a message; Shift+Enter inserts a newline. **Stop** aborts an active
  model request, including a stream stalled between chunks.
- Under **Session tools**, export a conversation before reloading. Conversations
  are not automatically persisted. Include candidate probabilities in the export
  to retain them, along with their byte metadata, on import.

## Run this fork from source

Use Node.js 22 or newer and pnpm. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:web
pnpm preview --port 8080 --web_config web_config.json5
```

The preview command listens on all interfaces. The published upstream npm package
does not contain this fork's changes.
`web_config.json5` is an ignored, deployment-specific file. Create it using the
configuration format in the main README, or add an endpoint through Settings.
Set `chat_config.max_tokens` to the output limit suitable for your model (for
example, 32768 for a reasoning model), and copy sampling defaults from that
model's documentation. This fork does not assume one sampler fits every model.

An optional `VITE_ON_PANDA_DEFAULT_SYSTEM_PROMPT` in `.env.production.local`
sets the initial system message at build time. It defaults to an empty string.
As with all `VITE_*` values, the value becomes part of the browser bundle;
do not use it for secrets. No deployment endpoint or custom persona is included.

## Native DeepSeek V4 continuation

Some native DeepSeek V4 serving paths close a final assistant message even when
`continue_final_message` is requested. Passing a forced-token prefix through that
chat template can therefore insert an unwanted reasoning boundary or end token.

For an affected vLLM endpoint, explicitly enable the adapter in that API's config:

```js
{
  endpoint_name: 'my-vllm',
  tag_name: 'my-model',
  client_config: {
    base_url: 'http://127.0.0.1:8000/v1',
    api_key: 'YOUR_API_KEY',
  },
  chat_config: {
    model: 'your-exact-served-model-id',
    max_tokens: 32768,
    top_logprobs: 20,
  },
  response_template: {
    name_or_path: 'deepseek-ai/DeepSeek-V4-Flash',
    continuation: 'vllm_deepseek_v4',
  },
}
```

The endpoint must support `/v1/chat/completions/render`,
`/v1/completions/render`, and `/v1/completions`. The adapter renders preceding
turns separately from the assistant prefix, verifies the shared boundary token,
then generates through raw completions. It preserves sampler controls and
normalizes completion logprobs for the existing token view. Boundary mismatches
fail explicitly. Other API configurations retain their existing continuation path.

This adapter retokenizes the reconstructed text prefix; it does not guarantee
exact token-ID replay for arbitrary byte fragments or alternate tokenizations.
Token probabilities describe the next-token distribution, not factual confidence.

## Verification

```sh
pnpm test:continuation
pnpm exec playwright install chromium
pnpm test:chat-ui
```

The UI smoke test starts a temporary loopback preview and supplies synthetic
model responses. It checks pointer travel, scrolling, forced-token branching,
historical regeneration, keyboard submission, and mobile layout. It makes no
inference requests. Reports and screenshots go into ignored `test-results/`.
