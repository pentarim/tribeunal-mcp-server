# Tribeunal MCP Server — LLM installation guide

This guide is written for AI agents (e.g. Cline) installing the Tribeunal MCP server on a user's behalf.

## Option A — remote server (preferred when the client supports streamable HTTP)

No installation required. Configure the client with:

- **URL:** `https://mcp.tribeunal.com/mcp`
- **Transport:** streamable HTTP (in Cline: `"type": "streamableHttp"` — the camelCase value is required)
- **Auth:** OAuth 2.1 — the client opens a browser sign-in; a Tribeunal account is created automatically if the user doesn't have one. No API key or env vars needed.

Cline `cline_mcp_settings.json` entry:

```json
{
  "mcpServers": {
    "tribeunal": {
      "type": "streamableHttp",
      "url": "https://mcp.tribeunal.com/mcp",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

If the client's OAuth flow fails or is unsupported, fall back to Option B.

## Option B — local stdio server (npm)

### Requirements

- Node.js >= 18 (`node --version`)
- A Tribeunal API key — the user must be logged in at tribeunal.com, then visit **https://tribeunal.com/profile/api-key** and click **Generate API key**. The key is shown exactly once; ask the user to paste it.

### Configuration

No manual install step is needed — `npx` fetches the package on first run.

```json
{
  "mcpServers": {
    "tribeunal": {
      "command": "npx",
      "args": ["-y", "@pentarim/tribeunal-mcp-server"],
      "env": {
        "TRIBEUNAL_API_KEY": "<paste the user's API key here>",
        "TRIBEUNAL_API_BASE_URL": "https://tribeunal.com/api"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### Environment variables

| Variable | Required | Value |
|---|---|---|
| `TRIBEUNAL_API_KEY` | yes | the user's personal API key (64 hex chars) |
| `TRIBEUNAL_API_BASE_URL` | yes | `https://tribeunal.com/api` |

## Verify the installation

Call the `tribeunal_get_current_user` tool. A successful response returns the user's Tribeunal username. If it fails with 401, the API key is wrong or was revoked — generate a new one at https://tribeunal.com/profile/api-key.

## Notes for agents

- 31 tools, all prefixed `tribeunal_`. Read-only tools are annotated `readOnlyHint: true`; `tribeunal_close_case` and `tribeunal_jury_duty_reject` are destructive (confirm with the user first).
- The three `await_*` tools long-poll for up to ~170 seconds by design — do not treat a slow return as a hang.
- Rate limit: 100 API requests/hour per IP.
