# CrossWayAI AI Configuration

AI is disabled by default. To use AI features update:

```txt
.crosswayai/crosswayai_settings.json
```

## Example: VS Code Provider

```json
{
  "ai": {
    "enabled": true,
    "provider": "vscode"
  }
}
```
This uses the first available VS Code language model.


## Example: HTTP Provider

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



## Rules

* Supported providers are only `"http"` and `"vscode"`.
* If `enabled` is not `true`, AI is off.
* If `provider` is missing, AI is not configured.
* There is no automatic provider fallback.
* Invalid configuration fails fast with an error.

