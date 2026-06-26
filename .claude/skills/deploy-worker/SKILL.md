---
name: deploy-worker
description: Use when deploying, releasing, shipping, or rolling back the Tribeunal remote MCP server (the Cloudflare Worker in worker/) to production, or when `wrangler deploy` fails on KV namespace, secrets, Auth0 audience, or callback-URL config.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Edit
---

# deploy-worker

Deploy the **Tribeunal remote MCP server** — the Auth0-authenticated Cloudflare Worker in
`worker/` (`tribeunal-mcp-worker`) — to production.

**Core principle:** this worker deploys with **plain `wrangler deploy`**. The
`workers-mcp docgen` flow described in the repo `CLAUDE.md` is **stale** and belongs to
the old worker — do not run it. Authoritative source for everything below is
`worker/README.md` and `worker/wrangler.jsonc`; reconcile against them if they disagree
with this skill.

## When to use

- "deploy / release / ship the prod worker", "push the MCP server", "go live on mcp.tribeunal.com"
- `wrangler deploy` errors on KV id, missing secret, or Auth0 401s after deploy
- Rolling back a bad worker deploy

Not for: the **local stdio** MCP server (root `src/`, deployed differently), or `wrangler dev`
(that's local dev — see `worker/README.md` "Local development").

## Two paths

- **Routine redeploy** (KV id + secrets already configured — the usual case): just
  `cd worker && npx wrangler deploy`. Skip the one-time steps below.
- **First-time / fresh environment**: run the full "Deploy procedure". Steps 1 and 2 are
  marked **ONE-TIME** — skip any that's already done.

## Pre-flight (check before every deploy)

```bash
cd worker
npx wrangler whoami                   # confirm correct Cloudflare account
grep -n REPLACE wrangler.jsonc        # if this MATCHES, KV id is unset -> do step 1 first (Gotcha #1)
npx wrangler deploy --dry-run --outdir /tmp/wkr   # build/config valid without shipping
```

A `grep REPLACE` match is not an abort — it routes you to step 1. For a routine redeploy it
should return nothing.

## Required config

| Kind | Names | Where | Notes |
|---|---|---|---|
| KV namespace | `OAUTH_KV` | `wrangler.jsonc` `kv_namespaces[0].id` | Real id, not the placeholder. One-time. |
| Secrets (5) | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE`, `COOKIE_ENCRYPTION_KEY` | `wrangler secret put` | **Never** from `.dev.vars` (that's local-only). |
| Non-secret vars | `TRIBEUNAL_API_BASE_URL`, `AUTH0_SCOPE` | already in `wrangler.jsonc` `vars` | Prod base URL is already `https://tribeunal.com/api`. Don't re-set as secrets. |

## Deploy procedure

```bash
cd worker

# 1. ONE-TIME: create the OAuth KV namespace, then paste the printed id into
#    wrangler.jsonc -> kv_namespaces[0].id (replacing <REPLACE_WITH_OAUTH_KV_NAMESPACE_ID>).
npx wrangler kv namespace create OAUTH_KV

# 2. ONE-TIME (or when rotating): set the 5 secrets. Each prompts for the value.
npx wrangler secret put AUTH0_DOMAIN          # e.g. tribeunal.eu.auth0.com (no scheme, no trailing slash)
npx wrangler secret put AUTH0_CLIENT_ID
npx wrangler secret put AUTH0_CLIENT_SECRET
npx wrangler secret put AUTH0_AUDIENCE        # MUST byte-match app AUTH0_API_AUDIENCE (Gotcha #2)
npx wrangler secret put COOKIE_ENCRYPTION_KEY # paste the output of: openssl rand -hex 32

# 3. Deploy. First-ever deploy serves at https://tribeunal-mcp-worker.<subdomain>.workers.dev
npx wrangler deploy

# 4. FIRST DEPLOY ONLY: add that exact <...>.workers.dev/callback URL to Auth0
#    (Allowed Callback URLs), then test. Remove it once the custom domain is live.

# 5. GO LIVE on the custom domain: uncomment the `routes` block at the bottom of
#    wrangler.jsonc  ({ "pattern": "mcp.tribeunal.com", "custom_domain": true })  and redeploy.
npx wrangler deploy
```

After any `wrangler.jsonc` change, regenerate types: `npx wrangler types`.

## Verify the deploy

1. `npx wrangler deployments list` — confirm the new version is active.
2. Connect an MCP client to the deployed MCP endpoint. The worker serves both `/sse`
   (SSE transport) and `/mcp` (Streamable HTTP) — use the custom domain
   `https://mcp.tribeunal.com/sse`, or the `*.workers.dev/sse` URL on first deploy:
   ```json
   { "mcpServers": { "tribeunal": { "command": "npx", "args": ["mcp-remote", "https://mcp.tribeunal.com/sse"] } } }
   ```
3. Complete the Auth0 login, then call `tribeunal_get_current_user`. It must return the
   **logged-in human's** profile — that proves on-behalf-of auth and a valid token, not a shared key.

## Gotchas

| # | Symptom | Cause / fix |
|---|---|---|
| 1 | `wrangler deploy` fails on KV binding / `grep REPLACE` matches | `kv_namespaces[0].id` is still `<REPLACE_WITH_OAUTH_KV_NAMESPACE_ID>`. Run step 1 and paste the real id. **#1 first-deploy blocker.** |
| 2 | Login works but every tool call returns **401** from the Tribeunal API | `AUTH0_AUDIENCE` ≠ the app's `AUTH0_API_AUDIENCE`. They must match **byte-for-byte** (`https://api.tribeunal.com`). **#1 misconfiguration risk.** |
| 3 | Tempted to run `workers-mcp docgen` | Stale `CLAUDE.md` instruction for the old worker. This worker uses plain `wrangler deploy`. |
| 4 | Auth0 "callback URL mismatch" after deploy | The active hostname's `/callback` isn't in Auth0 Allowed Callback URLs. Add the `*.workers.dev/callback` (first deploy) or `https://mcp.tribeunal.com/callback` (custom domain). |
| 5 | Refresh-token / re-login loop | Auth0 API needs **Allow Offline Access = ON** and grant types **Authorization Code + Refresh Token**. |
| 6 | Used `.dev.vars` values for prod | `.dev.vars` is local `wrangler dev` only. Prod secrets come from `wrangler secret put`. |

## Rollback

```bash
cd worker
npx wrangler deployments list           # find the last-good version id
npx wrangler rollback [version-id]       # revert to it
```

Secrets and KV are unaffected by rollback — only the code/config version changes.
