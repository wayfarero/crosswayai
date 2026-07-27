# CrossWayAI AI Configuration

AI is disabled by default. To use AI features update:

```txt
.crosswayai/crosswayai_settings.json
```

## How AI Features Use Project Files

CrossWayAI uses plain text project files as context for AI-based features. This lets the configured AI provider work from the actual source and schema text instead of only file names or dependency metadata.

Current AI-assisted features use text context in these ways:

* AI node summaries read the selected ABL source file (`.p`, `.w`, `.cls`, or `.i`) as UTF-8 text and send that source text directly to the configured AI provider (`http` or `vscode`) with the summary prompt.
* The Table Relations Diagram does not call the configured provider directly. Instead it opens the VS Code Chat agent with a prompt that points to the dumped database schema `.df` text (created by `CrossWayAI: Dump All DB Definitions`); the VS Code Chat agent then reads that `.df` file and generates the diagram. The `.df` content is processed by whichever model backs VS Code Chat, which may differ from the provider configured here.

Because these features include source or schema text in the AI prompt, make sure the destination model — the configured provider for node summaries, or the VS Code Chat agent for the Table Relations Diagram — and your workspace policy allow that content to be sent.

## Security And Responsibility Notice

When you enable AI features, CrossWayAI will include source code, schema definitions, database metadata, file paths, and related workspace context in prompts sent to the configured AI provider or, for the Table Relations Diagram, to the VS Code Chat agent.

You are responsible for deciding whether that content can be shared with the selected provider. CrossWayAI does not control, audit, or accept responsibility for how external AI providers or VS Code language models process, store, retain, train on, secure, or otherwise use submitted data.

Before enabling AI features, review:

* your AI provider's terms, privacy policy, data retention policy, and security commitments;
* your organization's rules for source code, customer data, confidential information, and regulated data;
* any contractual or legal restrictions that apply to the workspace content.

Do not enable or use AI features with confidential, regulated, customer-owned, or otherwise sensitive code or data unless you are authorized to send that content to the configured AI service.

## Example: VS Code Provider

```json
{
  "ai": {
    "enabled": true,
    "provider": "vscode"
  }
}
```
This uses VS Code language models through the Language Model API.

You can optionally request a specific VS Code model selector:

```json
{
  "ai": {
    "enabled": true,
    "provider": "vscode",
    "vscode": {
      "vendor": "copilot",
      "model": "gpt-4o"
    }
  }
}
```

For VS Code, `model` selects the VS Code model family. When any VS Code selector field is configured (`vendor`, `model`, `id`, or `version`), CrossWayAI treats that selector as strict. If no matching model is available, CrossWayAI shows an error notification, writes the same issue to CrossWayAILog, and does not try unrelated models.

If no selector is configured, CrossWayAI uses the VS Code language models available to the extension, in the order VS Code provides them, and keeps the `auto` model as a last resort. Each candidate model is tried in turn until one returns a result.


## Example: HTTP Provider

The HTTP provider supports only OpenAI-compatible Chat Completions APIs. It does
not yet support other native model provider APIs directly, including Anthropic
Claude's native `/v1/messages` API.

```json
{
  "ai": {
    "enabled": true,
    "provider": "http",
    "http": {
      "baseUrl": "https://api.example.com/v1",
      "apiKey": "YOUR_API_KEY",
      "model": "your-model-name"
    }
  }
}
```

The HTTP provider must be compatible with OpenAI Chat Completions:

```txt
POST /chat/completions
```

`baseUrl` should be the API root, for example `https://api.openai.com/v1`.

Do not set `baseUrl` to a provider-specific operation endpoint such as
`https://api.anthropic.com/v1/messages`. CrossWayAI appends
`/chat/completions` to the configured `baseUrl`, so provider-specific endpoint
URLs will fail unless they are exposed by an OpenAI-compatible proxy.



## Rules

* Supported providers are only `"http"` and `"vscode"`.
* The `"http"` provider supports only OpenAI-compatible Chat Completions APIs.
* Native provider APIs that use different endpoints, headers, request bodies, or
  response formats are not supported directly.
* If `enabled` is not `true`, AI is off.
* If `provider` is missing, AI is not configured.
* There is no automatic provider fallback.
* Invalid configuration fails fast with an error.

