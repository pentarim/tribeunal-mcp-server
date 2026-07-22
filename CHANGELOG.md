# Tribeunal MCP Server Changelog

## [Unreleased]

### Added
- `tribeunal_invite_tribe_members` — invite people into a PRIVATE tribe you own, by username
  or email (max 50 per call). Each invitee may then view and join the tribe. Public tribes are
  already open to everyone, so inviting into one returns 400 `tribe_not_private`.
- `tribeunal_create_case` sides now accept an optional `image` https URL per side (33 tools
  total). The image is fetched and re-encoded server-side (png/jpeg/webp, <= 5 MB; http URLs,
  private/internal hosts and non-images are rejected) and shown on the choice's vote card.
  `TribeunalAPIClient.createCase` maps each side's `image` to the backend's `imageUrl` field.
- `tribeunal_set_side_image` — set or replace the image on an existing case side (owner-only).
  Confirms the side belongs to the named case first (via `tribeunal_get_case`) so a mismatched
  id gets a clear message instead of a bare 404, then calls the new
  `POST /api/sides/{uuid}/image` endpoint. A 422 failure now surfaces its machine-readable
  `reason` (e.g. `blocked_host`, `too_large`, `bad_type`) verbatim via
  `extractApiErrorMessage`, ahead of the generic `detail` fallback.
- `tribeunal_create_case` gains an optional `allowsGuestVotes` boolean (default false). When
  enabled, visitors with no Tribeunal account can vote on the case and their votes count in
  full — they enter the tallies, percentages and the verdict exactly like a registered juror's.
  Requires a public jury; combining it with an invited jury is rejected before the request
  leaves the client. Guests are deduplicated per browser (a returning visitor changes their
  vote rather than adding one), but voting again from another browser stays possible, so
  enable it where reach matters more than strict one-person-one-vote.
- Pairing `allowsGuestVotes` with `visibility: 'private'` creates a **link-poll**: the case
  stays absent from every listing, search result and feed, but anyone holding its link can
  read it and vote without an account. That combination was previously rejected, since a
  private case had to run an invited jury; it now runs a public jury instead, and an omitted
  `juryType` on such a case is set to `public` rather than `invited`.
- `tribeunal_create_case` gains an optional `openImmediately` boolean (default true). Cases now
  open for voting as soon as they are created — invited jurors are still invited and can view,
  join and vote while the case is open. Pass `openImmediately: false` to hold the case in jury
  selection until `jurorCount` jurors have joined, matching the previous invited-jury behavior.

### Fixed
- `tribeunal_invite_tribe_members` now constrains `tribeId` to the UUID form. A tribe slug or
  the numeric `id` that `create_tribe`/`get_tribe` hand back reaches the backend's uuid-typed
  column and returned an opaque HTTP 500; it is now rejected at the tool boundary with a
  message naming the `uuid` field. (The app returns 404 for these too as of the same release.)
- `tribeunal_create_tribe` silently dropped `isPublic`: the tool advertised it, but neither the
  dispatcher nor the API client forwarded it, so every tribe was created public regardless of
  what the caller asked for. It is now forwarded, and private tribes are genuinely hidden and
  invitation-only.

### Removed
- `membershipFee` from `tribeunal_create_tribe`, and the "requires tokens" / "may require
  tokens for membership fee" wording from the tribe tool descriptions. None of it had any
  backing implementation anywhere in the platform — the parameter was accepted and discarded,
  and the descriptions promised a token economy that does not exist. `tribeunal_join_tribe`
  now documents the rule that does apply: private tribes are invitation-only, and joining one
  without an invitation returns 404.

### Changed
- `create_case` copy no longer implies an invited case only opens once its whole jury joins;
  `jurorCount` is described as an opening gate that applies only in the wait-for-jury mode.
- `await_verdict`'s pre-open advisory now explains the case is waiting for a full jury
  (`openImmediately: false`) and suggests creating with `openImmediately: true` to open at once.

## [1.5.0] - 2026-07-14

### Added
- `tribeunal_invite_jurors` (32 tools total) — case owner (or admin) invites users to the jury
  by username or email address (1-50 per call). Each invitee is resolved independently and the
  response reports `invited` / `duplicate` / `not_found` per entry, so unknown names don't fail
  the batch. Backs onto the new `POST /api/cases/{uuid}/jury/invite` endpoint; the case must have
  `juryType: "invited"`. Documented under the existing `jury:duty` OAuth scope — no new scope
  required.

## [1.4.0] - 2026-07-13

Public beta launch release.

### Added
- MCP tool annotations on all 31 tools: `title` plus `readOnlyHint`/`destructiveHint`/`openWorldHint`
  (16 read-only; `tribeunal_close_case` and `tribeunal_jury_duty_reject` flagged destructive) so
  clients can gate confirmations appropriately — also a Claude connectors directory requirement.
- npm publish readiness: `bin` (`tribeunal-mcp`), `files`, `publishConfig.access=public`,
  `prepublishOnly` build, `mcpName: "com.tribeunal/mcp"` for official MCP registry package validation.
- `server.json` (official MCP registry manifest, schema 2025-12-11) advertising the hosted
  streamable-HTTP/SSE remotes and the npm package; `glama.json` for Glama listing ownership.
- `SECURITY.md` (reporting contact, auth model, rate limits) and `llms-install.md`
  (agent-readable install guide for Cline and similar).
- stdio transport now threads progress notifications and client cancellation into the long-poll
  `await_*` tools (parity with the worker).

### Changed
- stdio server SDK upgraded `@modelcontextprotocol/sdk` `^0.5.0` → `^1.29.0` (same major as the
  worker); `tools/list` + `tools/call` handlers now use the SDK's canonical request schemas.
- README rewritten remote-first around `https://mcp.tribeunal.com/mcp` with per-client quickstarts;
  server version aligned at 1.4.0 across package.json, stdio and worker.
- `wrangler.jsonc` declares the `mcp.tribeunal.com` custom domain route (matches production).

### Security
- Replaced a committed real API key in `claude-config-example.json` with a placeholder (the key is
  being rotated server-side).

## [1.3.1] - 2026-07-10

### Added
- `tribeunal_create_case` gains an optional `visibility` parameter (`public` | `private`, default
  `public`). A `private` case is visible only to its owner, invited jurors and admins. Because a
  private case must run an invited jury, the handler coerces an omitted `juryType` to `invited`
  when `visibility` is `private`, and a `.superRefine` rejects an explicit `private` + `public`
  combination. Wired through `CreateCaseSchema` (zod) + the tool `inputSchema`, and forwarded
  verbatim by `TribeunalAPIClient.createCase`. Adds `tests/create-case-visibility.test.ts`.

## [1.3.0] - 2026-07-09

### Added
- `tribeunal_close_case` — close one of your own open cases early (case owner or admin) to trigger
  the verdict pipeline now (31 tools total). Calls the new API Platform operation
  `POST /api/cases/{uuid}/close` (via the `/api` baseURL, like `createCase`) through
  `CloseCaseSchema` (zod) + `TribeunalAPIClient.closeCase()`; both the stdio transport and the
  Cloudflare worker advertise it automatically. The backend enforces owner/admin + open-state, so
  403/400/409 surface as readable `API Error: ...` messages. Adds `tests/close-case.test.ts`.

## [1.2.1] - 2026-07-09

### Added
- `tribeunal_create_case` gains an optional `maxAiJurorPercentage` (integer 0-100) parameter — the
  per-case AI juror cap that controls how much of a case's jury may be AI. Wired through
  `CreateCaseSchema` (zod) and `TribeunalAPIClient.createCase` (same field name as the API, no
  mapping). Omitting it defers to the backend default (50).

## [1.2.0] - 2026-07-06

### Added
- Three agent-await tools (30 tools total) so an executor agent can react to human decisions:
  - `tribeunal_get_case_activity` — one-shot cursorable read of the case activity feed
  - `tribeunal_await_case_activity` — long-poll (≤170s, 5s interval) for new events; re-armable with a gapless cursor
  - `tribeunal_await_verdict` — long-poll for the verdict; returns instantly when the case is already terminal
- `TribeunalAPIClient.getCaseActivity()` + `CaseActivityPage`/`CaseVerdict` types.
- `scripts/dispatch.ts` (CLI tool harness) and `scripts/demo-executor.ts` (executor story).
- `tests/activity.test.ts` + `npm run test:unit` (node --test via tsx).

### Changed
- `dispatchToolCall(apiClient, name, args, ctx?)` gains an optional 4th `ctx`
  ({ reportProgress?, signal?, sleep? }); the stdio path is unchanged.
- Worker (`worker/src/mcp-agent.ts`) streams `notifications/progress` (per the request's
  `progressToken`) and honors client cancellation (`extra.signal`) for the await tools.

### Notes
- Long-poll (not server push) is deliberate: MCP push never reaches the model's turn and
  Claude Desktop caps a remote tool call at ~4 min, hence the 170s ceiling with re-arm.

## [1.1.0] - 2025-01-10

### Added
- Trial URLs are now included in all API responses
- Trial creation response prominently displays the shareable URL
- Added `url` and `slug` fields to Trial DTO

### Changed
- MCP server now displays UUID instead of numeric ID in responses
- Improved trial creation success message to include the full URL
- Updated documentation to explain URL structure

### Fixed
- Fixed incorrect URL pattern - trials use `/cases/{uuid}/{slug}` not `/trial/{id}`
- MCP server now returns proper shareable URLs for all trials

### Technical Details
- Updated `src/Dto/Trial.php` to include `url` and `slug` fields
- Modified `src/Dto/Factory.php` to generate URLs using Symfony router
- Enhanced `src/Controller/Api/TrialController.php` to return slug and URL
- Improved MCP server response formatting in `mcp-server/src/server.ts`

### Migration Notes
No breaking changes. The numeric `id` field is still returned for backwards compatibility, but clients should use `uuid` for all operations.