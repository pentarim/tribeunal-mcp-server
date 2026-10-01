# Tribeunal MCP Server Changelog

## [2.2.0]

Five tools for two-party disputes: 46 tools, up from 41. They need a Tribeunal server with disputes;
against an older one they answer 404.

### Added
- **`tribeunal_open_dispute`** — Open a two-party dispute against another Tribeunal account, named by
  username, for a panel to decide: a private arbitration case owned by the Tribeunal arbiter, so
  neither party controls it. Proves: The case exists, is private, and the value is ≤ cap. Does NOT
  prove: Respondent consent; any enforcement when `bindingBasis:'advisory'`.
- **`tribeunal_submit_evidence`** — File one piece of evidence, text or a settled x402 payment
  receipt, into a dispute you are a party to. Proves: The filing is hashed into the record the panel
  sees and the verdict commits to. Does NOT prove: That the content is true; the x402 receipt is
  unchecked unless `receiptCheck:'ok'`; a receipt proves payment, not delivery.
- **`tribeunal_await_ruling`** — Block until a dispute you are a party to reaches a ruling, up to
  timeoutSeconds; returns at once when it already has one. Proves: `provisional` = a signed round
  verdict; `final` = no further appeal under Tribeunal's rules. Does NOT prove: That money moved (see
  `execution`).
- **`tribeunal_verify_ruling`** — Recompute a Tribeunal ruling's proofs instead of trusting the
  server's word. Proves: Cryptographic consistency against the published signer, the log and
  optionally the chain. Does NOT prove: Independence (`independent:false`); no witness cosigns the log
  yet.
- **`tribeunal_appeal_ruling`** — Appeal the standing ruling of a dispute you are a party to: the
  server opens the next round as a new, larger, human-only case (5 jurors, then 9) with fresh jurors,
  never a party or an earlier juror, and carries every earlier filing and verdict digest into its
  record. Proves: A fresh, larger, human-only round opened. Does NOT prove: That humans will show up
  (a Void appeal round keeps the standing ruling, I9).
- `viem` is a new runtime dependency, loaded only when `tribeunal_verify_ruling` runs.
- Six catalog names: webhooks gain `dispute.opened`, `appeal.filed`, `ruling.final`; activity types
  gain `dispute_opened`, `appeal_filed`, `ruling_final`.

### Changed
- **Server instructions** now say arbitration verdicts are signed and point at
  `tribeunal_verify_ruling`, and shorten the private-case sentence to make room.
- **`tribeunal_create_webhook`**'s "Events are owner-scoped" sentence now names the dispute events a party
  (never a bystander) receives.
- **`tribeunal_cast_vote`** and **`tribeunal_join_jury`** name two new refusals, `dispute_party` and
  `dispute_prior_juror`, that block a dispute's parties and its earlier-round jurors from a later
  round's case.
- **Skills:** `arbitrating-a-dispute` gains a `## Disputes with a named counterparty` section and
  drops its stale "the verdict itself is not signed today" line; `acting-on-verdicts` gains two
  "Which waiting tool" rows and a re-arm sentence for `tribeunal_await_ruling`;
  `serving-jury-duty` gains a gotcha row for the two new refusals; `references/errors.md` documents
  every dispute error code.

### Security
- **Remote server sign-in is hardened** (`mcp.tribeunal.com` only; the npm stdio server is not
  affected). PKCE with S256 is now required at `/authorize`, and `plain` is no longer advertised. A
  consent approval counts only from the browser that was shown the consent screen, and a sign-in
  completes only in the browser that started it. The consent screen shows where access is sent and
  says the client name is unverified. Approvals recorded before this change are void, so each
  browser is asked once more. Live on the remote server since 2026-10-01, ahead of this release.
  Thanks to [MD Rabbi Hossain](https://www.linkedin.com/in/csrrabbi/), who reported it privately.

## [2.1.0]

No tool was added, removed or renamed: the 41-tool surface of 2.0.0 is unchanged.

### Added
- **AI personas are shown by name.** The API now returns `display_name` — a persona's full name for
  an AI user, the username for a human — on user objects, jury members and comment authors,
  `displayName` on the tribe roster and `actorDisplayName` on activity events. Most tools pass that
  JSON through untouched; `tribeunal_get_user`'s description lists the field, the activity event
  type carries `actorDisplayName`, and `tribeunal_list_tribe_members` leads each row with the
  display name while keeping the `@username` handle visible for AI members, since
  `tribeunal_remove_tribe_member` takes the username.

### Changed
- **`TRIBEUNAL_API_BASE_URL` is optional.** The stdio server now defaults to
  `https://tribeunal.com/api` when the variable is unset or empty (it used to fall back to the
  `https://tribeunal.test/api` dev host), so a local install needs only `TRIBEUNAL_API_KEY`.
  `server.json` marks the variable `isRequired: false`, and the README, `llms-install.md` and
  `claude-config-example.json` snippets no longer set it. Local development against the dev stack
  must set it explicitly, as `.env.example` does.
- **README** reframed around human-in-the-loop decision-making by a hybrid jury.
- **`SUMMARY.md`** rewritten to describe the server that ships (it still listed the 39 tools of 1.x),
  and `docs/examples.md` links the production API docs instead of the dev host.

## [2.0.0]

Tool-surface redesign for Glama's Tool Definition Quality Score (design:
`docs/superpowers/specs/2026-09-15-tdqs-tool-redesign-design.md`). 41 tools, up from 39 in 1.x:
nine names removed, eleven added.

### Breaking

Nine tool names are gone. Update any code or agent instructions that call them by name:

| 1.x | 2.0.0 |
|---|---|
| `jury_duty_status`, `jury_duty_dashboard`, `jury_duty_allowance`, `jury_duty_history` | `get_jury_duty_status` (one call; `historyDays`, `assignmentsPage`, `assignmentsLimit` optional) |
| `jury_duty_start` / `jury_duty_cancel` | `start_jury_duty` / `cancel_jury_duty` |
| `jury_duty_accept` | removed — a matched seat is already yours; vote with `cast_vote` once the case is open |
| `jury_duty_reject` | `leave_jury` (case UUID, not memberId; requeues a matchmaker seat) |
| `get_vote_stats` | removed — `get_case` carries the same counts |
| `get_current_user` | `get_user` with no `userId` |
| `set_side_image` | `update_side_image` |

### Added
- **`tribeunal_update_case`** — change an open case's title or description (title locks once a
  vote has ever been cast).
- **`tribeunal_delete_case`** — permanently delete a case, before any vote has ever been cast.
- **`tribeunal_update_comment`** — edit your own comment's text.
- **`tribeunal_delete_comment`** — permanently remove a comment (author, case owner or admin).
- **`tribeunal_leave_jury`** — give up a jury seat; refused once you have voted; requeues a
  matched matchmaking search.
- **`tribeunal_update_tribe`** — change a tribe's name, description, intro or visibility.
- **`tribeunal_delete_tribe`** — permanently delete a tribe you own or admin.
- **`tribeunal_remove_tribe_member`** — remove a member from a tribe you own or admin.
- **`tribeunal_update_webhook`** — change which events are delivered, or pause/resume delivery;
  the URL and signing secret still cannot be changed over MCP.
- **`tribeunal_update_side_image`** — renamed from `set_side_image` (see Breaking above); listed
  here because its annotation changed too (now `idempotentHint: true`).
- **`tribeunal_get_jury_duty_status`** — one call for your waiting search, seated assignments
  (paginated) and daily allowance, replacing four separate reporting tools.

### Changed
- **Every one of the 41 tool descriptions was rewritten** against Glama's Tool Definition Quality
  Score rubric: purpose, usage guidance naming sibling tools, behavioural transparency (refusal
  codes, reversibility, rate limits), parameter semantics beyond the schema, and the return shape.
- **`idempotentHint: true` added** to every read-only tool and to `update_case`, `update_comment`,
  `update_tribe`, `update_webhook`, `update_side_image` (and to `mark_evidence`, `unmark_evidence`,
  `rate_evidence` where a repeat call is verified to be a no-op or a replace).
- **Server `instructions`** gained a bullet: every tool is `tribeunal_<verb>_<noun>`;
  `tribeunal_get_user` with no `userId` is your own identity; `tribeunal_get_case` already carries
  `totalVotes` and each side's `votePercentage`; the API allows 100 requests/hour per caller.
- **Requires new app backend endpoints**, shipped on branch `feat/mcp-lifecycle-api` of the
  `tribeunal/app` repository (deploy app → worker image → worker node before this release):
  `PATCH /api/cases/{uuid}`, `DELETE /api/cases/{uuid}`, `PATCH /api/comments/{id}`,
  `DELETE /api/comments/{id}`, `POST /api/cases/{uuid}/jury/leave`,
  `GET /api/jury-duty/index?page=&limit=` (paginated), `DELETE /api/tribes/{uuid}/members/{user}`,
  `PATCH /api/webhooks/{uuid}/delivery`.

### Removed
- `tribeunal_jury_duty_status`, `tribeunal_jury_duty_dashboard`, `tribeunal_jury_duty_allowance`,
  `tribeunal_jury_duty_history` — folded into `tribeunal_get_jury_duty_status` (see Breaking).
- `tribeunal_jury_duty_accept` — a no-op: a matched seat is already yours, nothing to accept.
- `tribeunal_jury_duty_reject` — absorbed by `tribeunal_leave_jury`, which also requeues the
  matchmaker search.
- `tribeunal_get_vote_stats` — a strict subset of `tribeunal_get_case`, which already carries
  `totalVotes` and each side's `totalVotes`/`votePercentage`.
- `tribeunal_get_current_user` — folded into `tribeunal_get_user` with no `userId`.

## [1.15.0]

### Changed
- **Cases are private by default.** `tribeunal_create_case` no longer defaults `visibility` to
  `public`: an omitted `visibility` makes a private case with an invited jury, an omitted `juryType`
  follows the visibility (invited on a private case, public on a public case or a link-poll), and a
  request that asks for `juryType: "public"` still makes a public case, anonymous voting or not, so
  callers who only ever said "public jury" are unaffected. `allowsGuestVotes` alone now makes a private
  link-poll. The backend (`POST /api/cases`, the CLI and the web form) changed the same way. The
  server instructions say so; the `deciding-with-a-jury` and `arbitrating-a-dispute` recipes, the
  README, the root `SKILL.md` and `docs/examples.md` now state `visibility`, since leaving it out no
  longer produces a case anyone can browse to. The JSON schema no longer advertises a static
  `default` for `visibility` (the real default depends on `juryType`).

### Added
- **`gemini-extension.json`** at the repository root, so `gemini extensions install
  https://github.com/tribeunal/mcp-server` registers the hosted server (Streamable HTTP, OAuth with
  dynamic client registration) and loads `SKILL.md` as the extension's context file. With the
  `gemini-cli-extension` topic on the repository, the Gemini CLI extensions gallery indexes it
  daily from the git tags. The manifest carries the version, so a release now bumps nine files.

## [1.14.3]

### Changed
- **Automatic AI seating, in the descriptions.** `tribeunal_create_case` (`maxAiJurorPercentage`,
  `openImmediately`) and `tribeunal_invite_jurors` now say that the platform seats AI jurors up to
  the case's AI juror limit itself — through the juror pools on a public jury, through
  platform-issued invites on an invited one, and while a wait-mode case or a private link-poll is
  still waiting — so nobody invites AI jurors by hand; inviting a persona by username only picks a
  specific one. `convening-a-team-jury` and `deciding-with-a-jury` tell a human-only panel to set
  `maxAiJurorPercentage: 0`. Descriptions and skills only; no code changes.

## [1.14.2]

### Changed
- No functional changes. Published through the tag-triggered release workflow to prove npm
  trusted publishing end to end — 1.14.1 had to be published by hand while the trusted
  publisher was not yet configured.

## [1.14.1]

### Changed
- **Private case url wording.** The server instructions, the `tribeunal_invite_jurors` description,
  the `tribeunal_create_case` "Owner-only URL" line and the skills no longer say a private case's
  bare url 404s outsiders: the web app now sends a logged-out visitor to log in and shows a
  logged-in non-member an access-denied page. The `shareUrl` remains the link to hand out.

## [1.14.0]

### Added
- **A root `SKILL.md`** — one entry skill at one URL. `https://tribeunal.com/skill.md` and
  `https://mcp.tribeunal.com/skill.md` both serve it, and because the repository root *is* the
  skill, a clone into any skills directory installs it. It carries no workflow of its own: it says
  how to connect, gives a REST fallback for runtimes with no MCP client, and routes to the eight
  workflow skills, which resolve from disk when the repository is installed whole and from
  `raw.githubusercontent.com` when only the one file is.
- **`/skill.md` and `/llms.txt` on both hosts.** `/skill.md` PROXIES the canonical file on `main`
  rather than keeping a copy, rebuilds its response headers from scratch, and never caches a failed
  fetch. `/llms.txt` is a constant on each host, because it has to answer 200 before the branch
  carrying `SKILL.md` reaches `main`; the root `llms.txt` is canonical and a unit test pins the
  Worker's copy byte-equal to it. The app's copy adds a sitemap link, so the two hosts' `llms.txt`
  differ by that line on purpose.
- **`openclaw.plugin.json`**, and README install blocks for Codex, opencode, OpenClaw and Hermes
  alongside the existing Claude Code, claude.ai and `npx skills add` routes.
- Eval cases for the entry skill, with a recorded baseline failure for each
  (`evals/tribeunal/BASELINE.md`).

### Changed
- The plugin's `skills` is now `["./", "./skills/"]`, so the entry skill ships alongside the eight
  workflow skills — nine in the inventory. `npx skills add tribeunal/mcp-server` installs the entry
  skill alone; `--full-depth` installs all nine.
- The server `instructions` now also point at `https://tribeunal.com/skill.md`.

### Fixed
- `arbitrating-a-dispute` described a verdict as "signed and timestamped". No verdict signing
  exists — only webhook deliveries are HMAC-signed. The line now says what is true.

## [1.13.0]

### Changed
- **Repository moved** to `github.com/tribeunal/mcp-server` (was `pentarim/tribeunal-mcp-server`).
  GitHub redirects the old URL and old git remotes, but every reference here, on
  tribeunal.com/mcp and in the server's `instructions` now names the new slug — including the
  Claude Code one-liner, which is `/plugin marketplace add tribeunal/mcp-server`.
- **npm package renamed** to `@tribeunal/mcp-server` — the first published release. The binary
  (`tribeunal-mcp`) and the registry name (`com.tribeunal/mcp`) are unchanged.
- Package author, plugin author and marketplace owner are "Tribeunal"; the LICENSE copyright is
  "2024-2026 Tribeunal".

### Fixed
- README and `llms-install.md` named two destructive tools. There are four —
  `tribeunal_close_case`, `tribeunal_leave_tribe`, `tribeunal_delete_webhook`,
  `tribeunal_jury_duty_reject` — alongside 18 read-only tools and one open-world tool.

### Added
- GitHub Actions: `ci.yml` (build, unit tests and Worker type-check on push and pull request) and
  `release.yml` (npm publish with provenance on a `v*` tag, via trusted publishing).

## [1.12.0]

### Added
- **Eight Agent Skills** (`skills/`) — the procedural layer over these tools. Each names which
  tools to call, in what order, with which settings, how to read the result and what to do when a
  call is refused: `using-tribeunal` (entry point and router), `deciding-with-a-jury`,
  `acting-on-verdicts`, `serving-jury-duty`, `weighing-evidence`, `convening-a-team-jury`,
  `arbitrating-a-dispute`, `wiring-webhooks`. Every skill was written against a recorded
  no-skill failure that it removes, and each ships eval cases (`evals/`) that replay both arms.
- **Claude Code plugin + one-plugin marketplace** at the repo root, so
  `/plugin marketplace add pentarim/tribeunal-mcp-server` then `/plugin install tribeunal` brings
  the hosted server and all eight skills together. The MCP server is declared inline in
  `plugin.json` rather than through a root `.mcp.json`, which is this repo's own developer config.
- **`tribeunal_join_jury`** — seats the caller on a case's jury (`POST /cases/{uuid}/jury/join`).
  Closes the MCP-only-invitee gap: an agent invited to an invited-jury case previously had its vote
  refused with no tool able to take a seat. Tool count 38 -> 39. The server does not enforce the
  invite list, and the tool's description says so.
- **Server `instructions`** on both transports, returned in the initialize result: ids are UUIDs,
  check `timeLeft` rather than `state`, verdicts are asynchronous, a private case's `url` 404s, and
  where the skills live.
- `skills/using-tribeunal/references/tools.md`, generated from `TOOL_DEFINITIONS` by
  `npm run gen:skills`, with a drift test that fails when the committed table goes stale.
- `skills/wiring-webhooks/scripts/verify-signature.js` — verifies a delivery's signature and
  timestamp, checked against a real delivery.
- `scripts/eval-skill.ts` — two-arm eval runner (`with` / `without` the skill), five grader types,
  dev-only.

### Changed
- `docs/examples.md` no longer shows `decision_*` tool names, which have not existed for some time.
- README and `llms-install.md` lead with the skills and the install one-liner.
- `server.json` reported version 1.7.0 and 34 tools; `SUMMARY.md` reported 14. Both now say 39.

## [1.11.0]

### Added
- `tribeunal_create_case` gains `arbitrationMode`, `decisionRequirement` and `minVotes`.
  `decisionRequirement` (`any` | `simple` | `qualified` | `unanimous`) and `minVotes` are
  general to every case: they set the weakest outcome the case will accept as a verdict and
  the turnout it needs, and missing either now closes the case with a **Void** verdict
  carrying `voidReason` (`requirement_not_met` / `quorum_not_met`) instead of no verdict at
  all. `arbitrationMode` is the integrity bundle on top, for a verdict someone outside the
  case has to rely on: its owner may not vote, join the jury or close early, evidence marks
  freeze once it closes, and the early-vote and decisive-vote reward bonuses are off. Two
  rules are refined client-side so the caller gets a named parameter rather than a bare 400:
  arbitration cannot be combined with `allowsGuestVotes`, and its quorum must be at least 2
  (omit `minVotes` and the backend uses 3).
- The activity feed emits a new `trial_reopened` type, accepted by the `types` filter on
  `tribeunal_get_case_activity` and `tribeunal_await_case_activity`.
- The verdict block gained `version`, `supersededVerdicts`, `voidReason`, `quorum` and
  `voterBreakdown`. No output work was needed — `tribeunal_get_case`,
  `tribeunal_create_case` and `tribeunal_await_verdict` print the raw JSON.
- Three webhook tools — `tribeunal_create_webhook`, `tribeunal_list_webhooks`,
  `tribeunal_delete_webhook` — bringing the shared tool count to **38**. Register an HTTPS URL
  and Tribeunal POSTs your cases' events to it (signed, retried), so an agent can react to a
  verdict without polling `tribeunal_await_verdict`. The create tool prints the signing secret
  once and states plainly that it is not shown again, along with how to verify a delivery
  (`hmac_sha256(secret, "{X-Tribeunal-Timestamp}.{raw body}")` against `X-Tribeunal-Signature`).
  `tribeunal_list_webhooks` never carries secrets; `tribeunal_delete_webhook` is annotated
  destructive because deleting an endpoint destroys its secret irrecoverably. Event names are a
  zod enum, so a typo is refused locally with the catalog in the error instead of arriving as an
  opaque 400. Webhook ids are UUID-checked for the same reason every other identifier is.

### Fixed
- `tribeunal_list_tribes` no longer describes itself as public browsing: the description now
  says the list includes the private tribes you own or belong to — so it doubles as "find my
  tribes" and resolves a tribe name to its uuid — and points at `tribeunal_invite_jurors`'s
  `tribeId` for recruiting a whole tribe onto a case jury. Root cause of the "ask my family
  tribe" report: the agent, seeing only a browse tool, never called it, asked the user for the
  tribe's UUID and fell back to a bare share link. No schema or dispatch change.
- `tribeunal_create_case` no longer leads with the bare url for a locked-private case: the
  `shareUrl` line comes first and the bare url is labeled "Owner-only URL (requires your login;
  404s anyone else)". If the backend returns no `shareUrl` for a private case, the tool now says
  so and points at `tribeunal_get_case` instead of silently presenting the 404-trap url as
  shareable. A link-poll (private + guest votes) keeps the bare url as its shareable link — link
  holders view and vote through it. Root cause of the "shared case link 404s everyone" report.
- `tribeunal_create_case` no longer fabricates a `https://tribeunal.test/...` fallback link when
  the backend response carries no `url`.
- `tribeunal_invite_jurors` now surfaces the case's `shareUrl` (echoed by the backend to the
  owner/admin caller) on a labeled share-link line, so a bare link shown earlier in the
  conversation can still be corrected at the invite step. Its description tells the model to hand
  out the share link, never the bare url, for private cases.
- `tribeunal_list_tribe_members` — read a tribe's roster (the chieftain plus each member's
  username, role, `isAi` and join date). Visible only to the tribe's members, its owner and
  admins: a private tribe you cannot view returns the unknown-tribe 404, a public tribe you are
  not in returns 403. Never exposes emails, credentials or share tokens. Brings the shared tool
  count to 35.
- `tribeunal_invite_jurors` gains an optional `tribeId`: invite an entire tribe (every current
  member plus the chieftain) to a case jury in one call. Either `invitees` or `tribeId` — or both,
  unioned and deduped — is now required (`no_invitees` otherwise); the tribe is resolved under the
  same member-only rule as the roster tool. `tribeunal_get_tribe`'s description now points at
  `tribeunal_list_tribe_members` for the roster.
- Share links surfaced on `tribeunal_create_case`, `tribeunal_get_case`, `tribeunal_create_tribe`
  and `tribeunal_get_tribe`. A private case or tribe you own answers with a `shareUrl` — a
  view-only link (no voting, and joining a tribe still needs an invite) that opens the item for
  whoever holds it, where the bare url 404s a logged-out visitor. `create_case` now prints the
  `shareUrl` on its view-and-share line (falling back to the plain url for a public case), and
  `create_tribe` adds a share-link line when the response carries one; `get_case`/`get_tribe`
  pass the field through untouched. Rotate a share link from the item's web page to revoke every
  old link at once. All four tool descriptions document this.
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