# Tribeunal Remote MCP Server (Cloudflare Worker + Auth0)

A remote [Model Context Protocol](https://modelcontextprotocol.io) server, hosted
on Cloudflare Workers, that authenticates each caller with **Auth0** and runs
every tool call **as that user** against the Tribeunal API.

- Humans connect an MCP client (Claude Desktop/CLI, MCP Inspector, the
  Cloudflare AI Playground) to a public URL, log in once via Auth0 Universal
  Login, and every tool call hits the Tribeunal API as that human.
- It exposes the **same 32 tools** as the local stdio server — they share a
  transport-agnostic core (`../src/core/tools.ts`, `../src/client/api-client.ts`).

The Auth0 contract (audience, scopes, env-var names, callback URLs, token shape)
is authoritative in **`app/docs/AUTH0_CONTRACT.md`** in the Tribeunal app repo.
Both this worker and the Symfony resource server build against it.

## Architecture

```
MCP client ──(mcp-remote / SSE | Streamable HTTP)──▶ Worker
                                                       │  @cloudflare/workers-oauth-provider
                                                       │  (defaultHandler = Auth0 Hono app)
                                                       ▼
                                          /authorize ─▶ Auth0 Universal Login (PKCE S256,
                                                        audience = AUTH0_AUDIENCE, scopes)
                                          /callback  ◀─ code → /oauth/token exchange
                                                       │  props { sub, email, upstream*Token }
                                                       ▼
                                    McpAgent (Durable Object) tool call
                                                       │  TribeunalAPIClient(bearer = Auth0 access token)
                                                       ▼
                              Tribeunal API (Symfony) — validates RS256 JWT, maps sub → User
```

| File | Role |
|---|---|
| `src/index.ts` | `OAuthProvider` wiring: `apiHandlers` for `/sse` + `/mcp`, Auth0 `defaultHandler`, endpoints, `scopesSupported`, `tokenExchangeCallback`. Re-exports the `TribeunalMCP` Durable Object. |
| `src/mcp-agent.ts` | `TribeunalMCP extends McpAgent` — registers the shared 32 tools, each routed through a per-user `TribeunalAPIClient` using `this.props.upstreamAccessToken`. |
| `src/auth0-handler.ts` | Hono app: `/authorize` (consent + Auth0 redirect, PKCE), `/callback` (code → token exchange, `completeAuthorization`), and the `tokenExchangeCallback` (refresh). |
| `src/oauth-utils.ts` | PKCE (S256), Auth0 authorize-URL / token / refresh helpers, signed client-approval cookie, consent dialog. Web Crypto only — no Node crypto. |
| `src/types.ts` | `Env` (= generated `Cloudflare.Env`), `UserProps`, `HonoEnv`. |
| `wrangler.jsonc` | DO binding `MCP_OBJECT` + migration, KV `OAUTH_KV`, non-secret `vars`, `nodejs_compat`, commented custom-domain block. |

## Pinned library versions

| Package | Version |
|---|---|
| `@cloudflare/workers-oauth-provider` | `^0.8.1` |
| `agents` | `^0.16.2` |
| `@modelcontextprotocol/sdk` | `^1.29.0` |
| `hono` | `^4.12.26` |
| `wrangler` (dev) | `^4.103.0` |
| `zod` | `^4.4.3` (required as a peer by `agents`) |

> Note: `agents@0.16` peer-depends on **zod v4**, so the worker uses zod 4 while
> the root stdio project stays on zod 3. The shared schemas use only stable Zod
> APIs (`object`, `string().min()`, `enum`, `default`, `optional`, `describe`)
> that behave identically in both majors.

## Prerequisites

1. A Cloudflare account with Workers + KV.
2. An Auth0 tenant with the **"Tribeunal Remote MCP"** Regular Web Application and
   the **"Tribeunal API"** resource server configured per
   `app/docs/AUTH0_CONTRACT.md` (§4.1 and §1). In particular:
   - Allowed Callback URLs include `http://localhost:8788/callback` and
     `https://mcp.tribeunal.com/callback` (and, temporarily, the exact
     `https://<name>.<subdomain>.workers.dev/callback` after the first deploy).
   - Grant types: Authorization Code + Refresh Token. Token endpoint auth = Post.
   - The API has **Allow Offline Access = ON** (refresh tokens).
3. The Tribeunal app deployed as an Auth0 resource server (Workstream A) so it can
   validate the forwarded tokens.

## Local development

```bash
cd worker
npm install

# Secrets / config for `wrangler dev`
cp .dev.vars.example .dev.vars
#   then edit .dev.vars with real Auth0 values + a COOKIE_ENCRYPTION_KEY
#   (openssl rand -hex 32). See app/docs/AUTH0_CONTRACT.md §5.2.

# Regenerate Cloudflare runtime types after any wrangler.jsonc change:
npx wrangler types

# Validate the build/config without deploying:
npx wrangler deploy --dry-run --outdir /tmp/wkr

# Run locally (http://localhost:8788). For end-to-end auth against a local
# Tribeunal, expose tribeunal.test through a tunnel (real TLS) first:
#   cloudflared tunnel --url https://tribeunal.test
# then set TRIBEUNAL_API_BASE_URL in .dev.vars to https://<tunnel>/api
npx wrangler dev
```

Connect the MCP Inspector or the Cloudflare AI Playground to
`http://localhost:8788/sse`, complete the Auth0 login, and call
`tribeunal_get_current_user` — it should return the **logged-in human's** profile
(proving on-behalf-of, not a shared key).

## Deploy to production

```bash
cd worker

# 1. Create the KV namespace and paste its id into wrangler.jsonc (kv_namespaces[0].id)
npx wrangler kv namespace create OAUTH_KV

# 2. Set the secrets (NOT committed). See "Required secrets" below.
npx wrangler secret put AUTH0_DOMAIN
npx wrangler secret put AUTH0_CLIENT_ID
npx wrangler secret put AUTH0_CLIENT_SECRET
npx wrangler secret put AUTH0_AUDIENCE
npx wrangler secret put COOKIE_ENCRYPTION_KEY
#   (AUTH0_SCOPE and TRIBEUNAL_API_BASE_URL are non-secret `vars` in
#    wrangler.jsonc; override them as secrets only if you prefer.)

# 3. Deploy. First deploy serves at https://<name>.<subdomain>.workers.dev —
#    add that exact /callback URL to Auth0 temporarily, then test.
npx wrangler deploy

# 4. Bind the custom domain: uncomment the `routes` block in wrangler.jsonc
#    ({ "pattern": "mcp.tribeunal.com", "custom_domain": true }) and redeploy.
#    Remove the temporary *.workers.dev callback from Auth0 once live.
```

### Required secrets (set before deploy)

| Secret | Notes |
|---|---|
| `AUTH0_DOMAIN` | Tenant domain, no scheme/trailing slash (e.g. `tribeunal.eu.auth0.com`). |
| `AUTH0_CLIENT_ID` | "Tribeunal Remote MCP" application Client ID. |
| `AUTH0_CLIENT_SECRET` | Its Client Secret. |
| `AUTH0_AUDIENCE` | **MUST equal the app's `AUTH0_API_AUDIENCE` byte-for-byte** (`https://api.tribeunal.com`). #1 misconfiguration risk. |
| `COOKIE_ENCRYPTION_KEY` | `openssl rand -hex 32` — signs the client-approval cookie. |

Non-secret `vars` already in `wrangler.jsonc` (override as secrets if desired):
`AUTH0_SCOPE`, `TRIBEUNAL_API_BASE_URL`.

## Connecting an MCP client (mcp-remote bridge)

Most stdio MCP clients (Claude Desktop, Claude CLI) reach a remote server through
the `mcp-remote` bridge. Add to `.mcp.json` / Claude Desktop config:

```json
{
  "mcpServers": {
    "tribeunal": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.tribeunal.com/sse"]
    }
  }
}
```

On first use, `mcp-remote` opens a browser to complete the Auth0 login; the token
is then cached for the session. Use `http://localhost:8788/sse` against
`wrangler dev` for local testing.
