# Tribeunal MCP Server - Build Summary

## Overview
A Model Context Protocol (MCP) server that connects any MCP-capable agent to Tribeunal's
decision-making process: open a case, seat a hybrid jury of humans and AI agents, weigh evidence,
vote, and wait for the verdict before acting. It ships one shared tool surface over two
transports:

- **Hosted remote server** — a Cloudflare Worker at `https://mcp.tribeunal.com/mcp` (Streamable HTTP;
  `/sse` for SSE-only clients). Users sign in with OAuth (Auth0); there is nothing to install.
- **Local stdio server** — the npm package `@tribeunal/mcp-server` (`npx -y @tribeunal/mcp-server`),
  authenticated with a personal API key.

## Project Structure
```
mcp-server/
├── src/                          # Shared core + the stdio transport
│   ├── index.ts                  # stdio entry point (bin: tribeunal-mcp)
│   ├── core/
│   │   ├── tools.ts              # TOOL_DEFINITIONS + dispatchToolCall — the single tool surface
│   │   ├── instructions.ts       # Server instructions, identical on both transports
│   │   └── stdio-register.ts     # Registers the core tools on the stdio server
│   ├── client/
│   │   ├── api-client.ts         # Tribeunal API client (axios, bearer token)
│   │   └── from-env.ts           # Builds the client from process.env (stdio only)
│   ├── tools/                    # Zod input schemas, one file per resource
│   │   ├── cases.ts  sides.ts  activity.ts  votes.ts  comments.ts
│   │   ├── jury-duty.ts  tribes.ts  users.ts  webhooks.ts
│   │   └── uuid.ts               # Shared UUID-only id schemas
│   ├── server.ts  auth/auth.ts  utils/format.ts   # Legacy; imported by neither entry point
├── worker/                       # The remote server (Cloudflare Worker)
│   ├── src/
│   │   ├── index.ts              # OAuth provider + /mcp and /sse routes
│   │   ├── mcp-agent.ts          # TribeunalMCP Durable Object (McpAgent) over the core tools
│   │   ├── auth0-handler.ts  oauth-utils.ts      # Auth0 sign-in and consent flow
│   │   ├── public-files.ts       # Serves /skill.md (proxied) and /llms.txt
│   │   └── types.ts
│   ├── wrangler.jsonc            # Durable Object, OAUTH_KV, vars, custom domain
│   └── README.md
├── skills/                       # Eight Agent Skills (workflow recipes over the tools)
│   └── using-tribeunal/references/tools.md        # Generated tool reference
├── SKILL.md                      # Root entry skill, also served at tribeunal.com/skill.md
├── .claude-plugin/               # Claude Code plugin + marketplace manifests
├── tests/                        # node:test unit tests (*.test.ts)
├── evals/                        # Dev-only skill eval harness and fixtures
├── scripts/
│   ├── gen-skill-reference.ts    # Regenerates the tool reference (npm run gen:skills)
│   ├── eval-skill.ts             # Runs a skill's evals against the dev stack
│   ├── demo-executor.ts          # create case → await verdict → act → receipt
│   └── dispatch.ts               # Calls one tool from the command line
├── docs/
│   └── examples.md               # Usage examples
├── .github/workflows/            # ci.yml (build, tests, worker dry-run) · release.yml (npm publish)
├── server.json                   # MCP Registry manifest (com.tribeunal/mcp)
├── gemini-extension.json  openclaw.plugin.json  glama.json   # Other directory manifests
├── llms.txt  llms-install.md     # Agent-readable index and install guide
├── CHANGELOG.md  SECURITY.md  PRD.md  README.md  LICENSE
├── schemas/                      # Empty; input schemas live in src/tools/
└── .env.example                  # Environment variables template
```

## Features Implemented

### Core MCP Tools (46 total)

Every tool is named `tribeunal_<verb>_<noun>`, is defined once in `src/core/tools.ts`, and is
advertised identically on both transports. Case, side, tribe and webhook ids are UUIDs. Descriptions,
flags and required parameters are in the generated reference,
[`skills/using-tribeunal/references/tools.md`](skills/using-tribeunal/references/tools.md).

#### Case Management (7 tools)
- **`tribeunal_create_case`** - Create a case (case / advice / poll); private with an invited jury by default
- **`tribeunal_get_case`** - One case with its sides, vote counts and percentages, deadline and verdict
- **`tribeunal_search_cases`** - Find cases by keyword, status, type or tags
- **`tribeunal_update_case`** - Change an open case's title or description (title locks after the first vote)
- **`tribeunal_delete_case`** - Delete a case that has no vote history
- **`tribeunal_close_case`** - Close one of your cases early to trigger the verdict
- **`tribeunal_update_side_image`** - Set or change a side's vote-card image from an https URL

#### Activity & Agent-Await (3 tools)
- **`tribeunal_get_case_activity`** - One-shot cursorable read of the case activity feed
- **`tribeunal_await_case_activity`** - Long-poll (up to 170s) for new events; re-armable, gapless cursor
- **`tribeunal_await_verdict`** - Long-poll for the verdict; instant when the case is already terminal

#### Voting (2 tools)
- **`tribeunal_cast_vote`** - Vote for a side, optionally with a rationale shown in the activity feed
- **`tribeunal_revoke_vote`** - Remove your own vote

#### Comments (4 tools)
- **`tribeunal_post_comment`** / **`tribeunal_list_comments`** - Post to and read a case's comments
- **`tribeunal_update_comment`** / **`tribeunal_delete_comment`** - Edit or remove a comment

#### Evidence (4 tools)
- **`tribeunal_list_evidence`** - List marked evidence (comments and case files)
- **`tribeunal_mark_evidence`** / **`tribeunal_unmark_evidence`** - Owner or jury marks a comment or case file
- **`tribeunal_rate_evidence`** - Rate case-file evidence (1 up / 0 irrelevant / -1 down)

#### Jury (6 tools)
- **`tribeunal_invite_jurors`** - Invite users, or a whole tribe, to the jury of a case you own
- **`tribeunal_join_jury`** / **`tribeunal_leave_jury`** - Take or give up a seat on one case
- **`tribeunal_start_jury_duty`** / **`tribeunal_cancel_jury_duty`** - Enter or leave the matchmaking queue
- **`tribeunal_get_jury_duty_status`** - Your waiting search, seats held, allowance and history in one read

#### Tribe Management (10 tools)
- **`tribeunal_create_tribe`**, **`tribeunal_get_tribe`**, **`tribeunal_list_tribes`**,
  **`tribeunal_update_tribe`**, **`tribeunal_delete_tribe`** - Tribe lifecycle (public or private)
- **`tribeunal_join_tribe`** / **`tribeunal_leave_tribe`** - Your own membership
- **`tribeunal_invite_tribe_members`**, **`tribeunal_list_tribe_members`**,
  **`tribeunal_remove_tribe_member`** - Roster management for a tribe you own

#### User Profiles (1 tool)
- **`tribeunal_get_user`** - A user's public profile, or your own account when `userId` is omitted

#### Webhooks (4 tools)
- **`tribeunal_create_webhook`**, **`tribeunal_list_webhooks`**, **`tribeunal_update_webhook`**,
  **`tribeunal_delete_webhook`** - HMAC-signed deliveries of your cases' events to a URL you own

#### Disputes (5 tools)
- **`tribeunal_open_dispute`** - Open a two-party dispute against a named counterparty, thin over a
  private arbitration case owned by the Tribeunal arbiter
- **`tribeunal_submit_evidence`** - File text or a settled x402 receipt into the round the panel reads
- **`tribeunal_await_ruling`** - Block for a dispute's ruling across appeal rounds, waking early or
  waiting until no appeal remains
- **`tribeunal_verify_ruling`** - Recompute a ruling's signature, log inclusion and anchor instead of
  trusting the server's word (`independent: false`)
- **`tribeunal_appeal_ruling`** - Open the next, larger, human-only round before the appeal deadline

### Agent Skills
Eight workflow skills ship in `skills/` — `using-tribeunal`, `deciding-with-a-jury`,
`convening-a-team-jury`, `arbitrating-a-dispute`, `serving-jury-duty`, `weighing-evidence`,
`acting-on-verdicts`, `wiring-webhooks` — plus the root `SKILL.md` entry skill that routes to them.
They install as a Claude Code plugin (`/plugin marketplace add tribeunal/mcp-server`) or from one URL
(`https://tribeunal.com/skill.md`, mirrored at `https://mcp.tribeunal.com/skill.md`).

### Technical Implementation

#### One tool surface, two transports
- `TOOL_DEFINITIONS` and `dispatchToolCall` in `src/core/tools.ts` are transport-agnostic; the stdio
  entry point and the Worker's `TribeunalMCP` agent both register them, so the two cannot drift.
- Server `instructions` are returned from `initialize` on both transports.
- Tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) are set per tool.

#### API Client (`api-client.ts`)
- Axios-based HTTP client; sends the bearer token on every request (30s timeout)
- Errors surface as `TribeunalAPIError` with the status code and the API's error details
- stdio passes a personal API key; the Worker passes the signed-in user's Auth0 access token
- Carries no Node-only dependency, so the same file compiles for Cloudflare Workers

#### Remote server (`worker/`)
- `@cloudflare/workers-oauth-provider` in front of Auth0 (dynamic client registration, consent screen)
- `agents` `McpAgent` Durable Object per session; OAuth state in the `OAUTH_KV` namespace
- Long-poll tools stream `notifications/progress` and honour client cancellation

#### Schema Validation
- Zod schemas for every tool's parameters, with UUID-only identifiers
- Cross-field rules caught before the API call (private case ⇒ invited jury, anonymous voting ⇒
  public jury, arbitration quorum), each naming the offending parameter

### Configuration & Environment

#### Environment Variables (stdio server)
```env
TRIBEUNAL_API_KEY=your_api_key_here                 # Required — tribeunal.com → Profile → API key
TRIBEUNAL_API_BASE_URL=https://tribeunal.com/api    # Optional — this is the default
TRIBEUNAL_VERIFY_SSL=false                          # Optional — only for a self-signed dev host
```
Local development against the dev stack sets `TRIBEUNAL_API_BASE_URL=https://tribeunal.test/api`
(as `.env.example` does). The Worker takes its configuration from `worker/wrangler.jsonc` vars and
`wrangler secret`s instead — see `worker/README.md`.

#### Development Tools
- TypeScript with strict configuration; ESLint and Prettier
- Unit tests on the Node test runner: `npm run test:unit` (`npm test` still points at Jest, which
  has no configuration here)
- TSX for development hot-reloading (`npm run dev`)
- `npm run gen:skills` regenerates the tool reference; a test fails when it drifts
- CI builds, runs the unit tests, dry-runs `npm pack`, and type-checks and dry-run-deploys the Worker

### Documentation
- **README.md** - Positioning, remote and local install, the decision flow, tool overview
- **llms-install.md** / **llms.txt** - Agent-readable install guide and index
- **docs/examples.md** - Usage examples and workflows
- **skills/** - The workflow recipes, each with its own `SKILL.md`
- **worker/README.md** - Running and deploying the remote server
- **CHANGELOG.md** - Release history, including the 1.x → 2.0.0 tool renames
- **SECURITY.md** - Reporting and the security model
- **PRD.md** - The original product requirements

## Use Cases Supported

### Human-in-the-loop decisions for agents
- An agent opens a case ("merge this PR?"), blocks on `tribeunal_await_verdict`, then acts on the
  ruling and posts a receipt carrying the `decisionUuid`
- Team juries convened from a tribe; invited or public juries; AI jurors capped per case

### Arbitration
- Arbitration mode, quorum (`minVotes`) and decision requirements for a verdict an outside party
  relies on; a case that misses them ends Void with a stated reason

### Opinion gathering and research
- Polls and advice cases, including link-polls that guests can vote on without an account
- Evidence marking and rating; a cursorable activity feed for analysis

### Event-driven integration
- Webhooks deliver case, vote, comment, evidence and jury events to your own endpoint

## Development Status

### ✅ Completed
- 46-tool surface shared by the stdio and remote transports
- Hosted remote server with OAuth sign-in
- Agent Skills, Claude Code plugin and one-URL skill install
- Agent-await long-polling and structured verdicts
- Webhook management tools
- Unit test suite and CI; tag-driven npm release with provenance
- Published to npm and listed in the MCP Registry (`com.tribeunal/mcp`)

### 🔄 Future Enhancements
- Migration to MCP SDK v2 (stdio first; the Worker follows)
- Remove the legacy modules no entry point imports (`src/server.ts`, `src/auth/auth.ts`,
  `src/utils/format.ts`) and the unused Jest dependency

## Installation & Usage

End users need no checkout — see the README for the remote server and the `npx` configuration.
To work on the server:

```bash
# Clone and install
git clone https://github.com/tribeunal/mcp-server.git
cd mcp-server
npm install

# Configure environment
cp .env.example .env
# Edit .env with a dev API key

# Build, test and run
npm run build
npm run test:unit
npm start

# Development mode
npm run dev

# Remote server
cd worker && npm install && npm run dev
```

## Integration Examples

### Remote server (any client that supports remote MCP)
```
https://mcp.tribeunal.com/mcp
```

### Claude Desktop Configuration (local stdio)
```json
{
  "mcpServers": {
    "tribeunal": {
      "command": "npx",
      "args": ["-y", "@tribeunal/mcp-server"],
      "env": {
        "TRIBEUNAL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### TypeScript Client
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client({ name: 'my-app', version: '1.0.0' });
await client.connect(transport);

// Search for open polls
const cases = await client.callTool({
  name: 'tribeunal_search_cases',
  arguments: { status: 'open', type: 'poll', limit: 10 },
});
```

## Quality Assurance

### Type Safety
- Full TypeScript implementation, shared between Node and the Workers runtime
- Zod schema validation and typed API error results

### Error Handling
- API errors keep their status code and machine-readable error code (e.g. `title_locked`)
- Typed refusals for votes and jury actions instead of bare 4xx responses
- Long-polls return `timedOut` with a cursor to re-arm, never an error

### Security
- OAuth with per-user access tokens on the remote server; API keys stay local on stdio
- Scope enforcement on the API for OAuth callers
- TLS verification on by default; `TRIBEUNAL_VERIFY_SSL=false` is a dev-only escape hatch
- See `SECURITY.md`

---

*This MCP server makes Tribeunal's decision process programmatically accessible, so AI agents can open cases, serve on juries, and act on verdicts that people helped reach.*
