# Tribeunal MCP Server Changelog

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