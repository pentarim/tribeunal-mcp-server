import { z } from 'zod';
import { TribeunalAPIClient, TribeunalAPIError } from '../client/api-client.js';
import { UUID_PATTERN, caseWithUuidOnly } from '../tools/uuid.js';

// Dispute schemas, honesty rows and result/error shaping
import {
  DESC as DISPUTE_DESC,
  OpenDisputeSchema,
  SubmitEvidenceSchema,
  AppealRulingSchema,
  buildOpenBody,
  buildFilingBody,
  openResult,
  filingResult,
  appealResult,
  localContentHash,
  disputeApiError,
} from '../tools/disputes.js';

// Case schemas
import {
  SearchCasesSchema,
  GetCaseSchema,
  CreateCaseSchema,
  withCaseDefaults,
  UpdateCaseSchema,
  DeleteCaseSchema,
  CloseCaseSchema,
  ListEvidenceSchema,
} from '../tools/cases.js';

// Voting & evidence schemas
import {
  CastVoteSchema,
  RevokeVoteSchema,
  RateEvidenceSchema,
} from '../tools/votes.js';

// Comment & evidence-mark schemas
import {
  PostCommentSchema,
  ListCommentsSchema,
  MarkEvidenceSchema,
  UnmarkEvidenceSchema,
  UpdateCommentSchema,
  DeleteCommentSchema,
} from '../tools/comments.js';

import {
  ListTribesSchema,
  GetTribeSchema,
  ListTribeMembersSchema,
  JoinTribeSchema,
  LeaveTribeSchema,
  CreateTribeSchema,
  InviteTribeMembersSchema,
  UpdateTribeSchema,
  DeleteTribeSchema,
  RemoveTribeMemberSchema,
} from '../tools/tribes.js';

import {
  CreateWebhookSchema,
  ListWebhooksSchema,
  DeleteWebhookSchema,
  UpdateWebhookSchema,
  WEBHOOK_EVENTS,
} from '../tools/webhooks.js';

import {
  GetUserSchema,
} from '../tools/users.js';

import {
  GetJuryDutyStatusSchema,
  StartJuryDutySchema,
  CancelJuryDutySchema,
  JoinJurySchema,
  LeaveJurySchema,
  InviteJurorsSchema,
} from '../tools/jury-duty.js';

import { UpdateSideImageSchema } from '../tools/sides.js';

// Activity feed + agent-await schemas and loops
import {
  GetCaseActivitySchema,
  AwaitCaseActivitySchema,
  AwaitVerdictSchema,
  awaitCaseActivity,
  awaitVerdict,
  awaitVerdictNotice,
  verdictHeadline,
  type AwaitContext,
} from '../tools/activity.js';

/**
 * Activity event types, mirrored here for the JSON Schema `types` enum on
 * tribeunal_get_case_activity / tribeunal_await_case_activity. Kept in lock-step
 * with the ACTIVITY_TYPES list in ../tools/activity.ts by hand (that file is
 * owned by the activity-tools work; this is the JSON-Schema mirror of it).
 */
const ACTIVITY_EVENT_TYPES = [
  'vote',
  'vote_revoked',
  'comment',
  'evidence_marked',
  'evidence_unmarked',
  'jury_joined',
  'jury_left',
  'trial_closed',
  'trial_reopened',
  'trial_updated',
  'dispute_opened',
  'appeal_filed',
  'ruling_final',
] as const;

/**
 * JSON-Schema mirror of `X402ReceiptSchema` (../tools/disputes.ts), shared by
 * tribeunal_open_dispute's and tribeunal_submit_evidence's `x402Receipt`
 * property. Every property `description` is the imported `DISPUTE_DESC.<key>`
 * string, never a copy.
 */
const X402_RECEIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    network: { type: 'string', pattern: '^eip155:[0-9]{1,20}$', description: DISPUTE_DESC.network },
    transaction: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$', description: DISPUTE_DESC.transaction },
    nonce: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$', description: DISPUTE_DESC.nonce },
    payer: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: DISPUTE_DESC.payer },
    payTo: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: DISPUTE_DESC.payTo },
    asset: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: DISPUTE_DESC.receiptAsset },
    value: { type: 'string', pattern: '^[0-9]{1,78}$', description: DISPUTE_DESC.value },
    validAfter: { type: 'string', pattern: '^[0-9]{1,20}$', description: DISPUTE_DESC.validAfter },
    validBefore: { type: 'string', pattern: '^[0-9]{1,20}$', description: DISPUTE_DESC.validBefore },
    resource: { type: 'string', pattern: '^[\\x21-\\x7E]{1,2048}$', description: DISPUTE_DESC.resource },
  },
  required: ['network', 'transaction', 'nonce', 'payer', 'payTo', 'asset', 'value', 'validAfter', 'validBefore', 'resource'],
  additionalProperties: false,
  description: DISPUTE_DESC.x402Receipt,
} as const;

/**
 * The canonical list of tool definitions advertised via `tools/list`.
 *
 * A single "case" vocabulary: every tool maps directly to a Tribeunal API
 * operation. The stdio server and the Cloudflare worker advertise the SAME
 * set so behaviour is identical regardless of how the caller authenticated.
 */
export const TOOL_DEFINITIONS = [
  // Case tools (7)
  {
    name: 'tribeunal_create_case',
    title: 'Create case',
    annotations: { title: 'Create case', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: 'Create a case on Tribeunal for community decision-making — case (jury decides), advice (creator decides), or poll (opinion gathering). Use directly when the user wants something decided; do not search first. Cases are private by default; set visibility "public" to let anyone find and join. Add allowsGuestVotes to a private case for a link-poll instead: unlisted, votable via the link. A private case answers with a shareUrl to share. Refuses 400 if arbitrationMode pairs with allowsGuestVotes or minVotes under 2. Returns the created case; keys you need first: {uuid, title, state, url, shareUrl}. This only creates a case — edit it with tribeunal_update_case, remove it with tribeunal_delete_case, and change a side\'s picture later with tribeunal_update_side_image (sides[].image here sets only the initial picture).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 200, description: 'The question or statement to be decided (3-200 characters).' },
        description: { type: 'string', minLength: 10, description: 'Context, background and decision criteria (at least 10 characters).' },
        type: { type: 'string', enum: ['case', 'advice', 'poll'], description: 'case (binding jury decision), advice (input for the creator) or poll (opinion gathering) — changes only how the result reads, not the voting mechanics.' },
        sides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Option/choice name' },
              description: { type: 'string', description: 'Optional description for this choice' },
              image: { type: 'string', format: 'uri', description: 'Optional https image URL for this choice — fetched and re-encoded server-side (png/jpeg/webp, <= 5 MB). Shown on the choice\'s vote card.' },
            },
            required: ['name'],
          },
          minItems: 2,
          maxItems: 10,
          description: "2-10 choices voters pick between; each needs a name and may carry a description and an https image URL, fetched and re-encoded server-side (png/jpeg/webp, <=5 MB) for its vote card.",
        },
        juryType: { type: 'string', enum: ['public', 'invited'], description: 'public (anyone) or invited (named jurors only). Omitted, it follows visibility: invited on a private case, public on a public case or a link-poll.' },
        visibility: { type: 'string', enum: ['public', 'private'], description: 'private (default: only you, invited jurors and admins) or public (anyone can find and read it). Pairing private with allowsGuestVotes makes a link-poll instead.' },
        caseLength: { type: 'number', minimum: 60, maximum: 2592000, default: 86400, description: 'Voting duration in seconds, 60 to 2,592,000 (30 days); defaults to 86400 (1 day).' },
        maxAiJurorPercentage: { type: 'integer', minimum: 0, maximum: 100, description: '0-100; caps the share of jurors the platform may auto-seat as AI personas. Defaults to 50; set 0 for an all-human panel.' },
        jurorCount: { type: 'integer', minimum: 2, maximum: 100, description: '2-100 jurors requested; defaults to 12. Only gates opening when openImmediately is false, holding the case in jury_selection until this many have joined.' },
        openImmediately: { type: 'boolean', description: 'Defaults to true: opens for voting right away, with invited jurors free to join/vote while already open. Set false to wait in jury_selection until jurorCount jurors join.' },
        allowsGuestVotes: { type: 'boolean', description: 'Defaults to false. Lets visitors with no account vote, full-weight and deduplicated per browser via a signed cookie. Requires a public jury — pairing it with a private case makes a link-poll.' },
        arbitrationMode: { type: 'boolean', description: 'Bind this case to arbitration rules, for a verdict someone outside the case has to rely on (default false). You cannot vote on, join the jury of, or close early a case you created in this mode — an admin closes it, or it closes at its deadline; evidence marks freeze once it closes so the record it was decided on stops moving; and the early-vote and decisive-vote reward multipliers are switched off, so timing your vote no longer multiplies your payout. Requires minVotes of at least 2 (omit it and 3 is used) and cannot be combined with allowsGuestVotes. Use it when the case settles something with stakes — a dispute, a payout, a contract term — rather than gathering opinion.' },
        decisionRequirement: { type: 'string', enum: ['any', 'simple', 'qualified', 'unanimous'], description: 'The weakest outcome this case will accept as a verdict (default "any"). "any" takes whatever the tally gives, down to a plurality. "simple" needs at least half, "qualified" at least 66%, "unanimous" every vote on one side. A case that reaches a stronger result than required still reports the stronger one. On any value other than "any", missing the requirement closes the case with a Void verdict carrying voidReason "requirement_not_met"; an "any" case that merely ties stays Undecided.' },
        minVotes: { type: 'integer', minimum: 0, maximum: 100, description: 'Fewest votes this case needs before it can reach a verdict (0-100, default 0 = no minimum). Close it with fewer and it ends with a Void verdict carrying voidReason "quorum_not_met" rather than deciding on a turnout of one or two.' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Up to 4 category tags.' },
      },
      required: ['title', 'description', 'type', 'sides'],
    },
  },
  {
    name: 'tribeunal_get_case',
    title: 'Get case',
    annotations: { title: 'Get case', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Fetch one case by id: title, description, state, sides with each side's uuid, totalVotes and votePercentage, the deadline (endsAt, timeLeft), and — for a private case you own — a shareUrl view-only link (rotate it from the case web page to revoke old links). This is the one-shot read; call it again for a fresh snapshot. To block until something changes instead, use tribeunal_await_case_activity for any event or tribeunal_await_verdict for the final decision. Vote with a side's uuid via tribeunal_cast_vote.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: UUID_PATTERN, description: "The case's uuid field (from tribeunal_search_cases, tribeunal_create_case, or a case URL) — not its numeric id." },
      },
      required: ['id'],
    },
  },
  {
    name: 'tribeunal_search_cases',
    title: 'Search cases',
    annotations: { title: 'Search cases', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Find existing cases by keyword, status, type or tags — a lighter-weight search than get_case: results carry only id, uuid, title, description, visibility and image, not state, sides, votes or deadline, so fetch a hit\'s full detail with tribeunal_get_case. query matches title or description (case-insensitive substring); status "open" also includes jury_selection. Private cases surface only when you own them, sit on their jury, or are an admin. Paginated newest-first: page (default 1), limit (default 20, max 100). To start a new case instead of searching, use tribeunal_create_case.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Matches case title or description, case-insensitive substring.' },
        status: { type: 'string', enum: ['init', 'jury_selection', 'open', 'closed', 'expired', 'suspended'], description: 'Exact state filter; "open" also includes jury_selection (a case still assembling its jury); "closed" is the closed state alone.' },
        type: { type: 'string', enum: ['case', 'advice', 'poll'], description: 'case, advice or poll.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Case must carry at least one of these tag names.' },
        page: { type: 'number', minimum: 1, default: 1, description: '1-based page number; defaults to 1.' },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Results per page; defaults to 20, hard-capped at 100.' },
      },
    },
  },
  {
    name: 'tribeunal_update_case',
    title: 'Update case',
    annotations: { title: 'Update case', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Change a case's title and/or description after creation (owner or admin only) — send at least one. 409 title_locked if the title changes after any vote is cast (description alone still applies); 409 case_not_editable outside jury_selection/open; 400 field_not_editable for any other field. Logged as trial_updated; the url/slug never changes. Returns the updated case — same shape as tribeunal_get_case, keyed by {uuid, title, description, state, url, shareUrl}. Use tribeunal_close_case to end a case, tribeunal_delete_case if no votes were cast, tribeunal_update_side_image for a side's picture.",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: "The case's uuid field, from tribeunal_get_case or tribeunal_search_cases." },
        title: { type: 'string', minLength: 3, maxLength: 200, description: 'New title, 3-200 characters (matching tribeunal_create_case). Refused with 409 title_locked if it differs from the current title and any vote has ever been cast on the case.' },
        description: { type: 'string', minLength: 0, maxLength: 10000, description: 'New description, 0-10000 characters. At least one of title or description must be given.' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_delete_case',
    title: 'Delete case',
    annotations: { title: 'Delete case', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description: 'Permanently delete a case you own (or as admin) — only while it is jury_selection or open, no vote has ever been cast on it (a revoked vote still counts as history), and no verdict exists; otherwise 409 case_in_use, meaning close it with tribeunal_close_case instead. Erases the case along with its jury seats, comments, evidence marks, ratings, activity feed and pending jury invitations — irreversible. Returns {deleted: true, uuid}. Use this only for a case that never really started; one with history should be closed, not deleted.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: "The case's uuid field, from tribeunal_get_case or tribeunal_search_cases." },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_close_case',
    title: 'Close case',
    annotations: { title: 'Close case', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description: 'Close one of YOUR cases early (owner or admin only; otherwise 403s, no error code). Works on open and jury_selection cases (an abandoned jury ends Undecided). Pulls the deadline to now and triggers the verdict pipeline asynchronously, returning {status, trial: {uuid, state}} with state decision_pending — read the verdict via tribeunal_await_verdict. You cannot close your own arbitration-mode case: only an admin can, or it closes at its deadline. No votes cast yet? Use tribeunal_delete_case instead.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID of the open or jury_selection case to close early (owner or admin only), from tribeunal_get_case.' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_update_side_image',
    title: 'Update side image',
    annotations: { title: 'Update side image', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: "Set or change a case side's vote-card image, fetched from a public https URL (case owner or admin only). Downloaded and re-encoded server-side (png/jpeg/webp, <=5 MB); http, private/internal hosts and non-image content 422 with a machine-readable reason. Capped at 20 fetches/hour per account (each opens an outbound connection); a 429 past that means wait, not retry. Use the case's and side's uuid from tribeunal_get_case, not numeric ids. At creation, pass sides[].image to tribeunal_create_case instead. Returns the side {uuid, name, description, image}.",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: "The case's uuid field (from tribeunal_get_case), not its numeric id." },
        sideId: { type: 'string', pattern: UUID_PATTERN, description: "The uuid of the side to set the image on, from the case's sides[] array in tribeunal_get_case." },
        imageUrl: { type: 'string', format: 'uri', description: 'Public https URL of the source image; http, private/internal hosts and non-image content are rejected.' },
      },
      required: ['caseId', 'sideId', 'imageUrl'],
    },
  },
  // Verdicts & activity tools (3)
  {
    name: 'tribeunal_await_verdict',
    title: 'Await verdict',
    annotations: { title: 'Await verdict', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Block until a case reaches its verdict (terminal decision), up to timeoutS seconds; returns instantly if already decided — unlike tribeunal_await_case_activity, which never wakes after closure. On timeout it returns the same page with verdict null and timedOut true; call again to keep waiting. Once decided, verdict carries {decided, decisionUuid, typeName, name, winningSides, sides, totalVotes, voidReason, quorum, voterBreakdown, type, text, decidedAt, version, supersededVerdicts}. Afterward, post a receipt via tribeunal_post_comment containing the decisionUuid — check tribeunal_list_comments first and skip if one exists (a reopened case can mint a second decision).',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID whose verdict to await, from tribeunal_get_case or tribeunal_search_cases.' },
        timeoutS: { type: 'integer', minimum: 5, maximum: 170, default: 150, description: 'Seconds to block, 5-170; defaults to 150. Returns instantly (no blocking) if the case is already terminal.' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_get_case_activity',
    title: 'Get case activity',
    annotations: { title: 'Get case activity', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Read a page of a case's activity feed (votes, comments, evidence marks, jury joins, case edits, jury departures, closure) as a cursorable event stream. Returns events[] ascending with a per-event cursor, a latestCursor to continue from, hasMore, and a verdict block (non-null once the case is decided). Use this for a one-shot read; to BLOCK until something happens, use tribeunal_await_case_activity or tribeunal_await_verdict instead. To read the content itself, use tribeunal_list_comments or tribeunal_list_evidence.",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID whose activity to read.' },
        after: { type: 'string', description: "Opaque cursor from a previous response's latestCursor; omit to read the tail (latest events)." },
        types: { type: 'array', items: { type: 'string', enum: [...ACTIVITY_EVENT_TYPES] }, description: 'Restrict to these event types (vote, vote_revoked, comment, evidence_marked, evidence_unmarked, jury_joined, jury_left, trial_closed, trial_reopened, trial_updated, dispute_opened, appeal_filed, ruling_final); omit for all types.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50, description: 'Max events per page, 1-100; defaults to 50.' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_await_case_activity',
    title: 'Await case activity',
    annotations: { title: 'Await case activity', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Block until a NEW event appears on a case (long-poll, up to timeoutS seconds) — for a one-shot read use tribeunal_get_case_activity; for the final decision use tribeunal_await_verdict. Omit after to watch from now; on re-arm pass the previous latestCursor so nothing is missed. Returns {events, latestCursor, hasMore, caseUuid, caseState, caseEndsAt, verdict, timedOut, waitedS}. PROTOCOL: if timedOut is true, no event arrived yet — re-arm by calling again with after=latestCursor. Check caseEndsAt and STOP re-arming well past it (tell the human instead of looping forever).',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID to watch.' },
        after: { type: 'string', description: 'Cursor to watch from (a previous latestCursor); omit to anchor at the current tail ("watch from now").' },
        types: { type: 'array', items: { type: 'string', enum: [...ACTIVITY_EVENT_TYPES] }, description: 'Only wake for these event types — same enum as tribeunal_get_case_activity.' },
        timeoutS: { type: 'integer', minimum: 5, maximum: 170, default: 120, description: 'Seconds to block, 5-170; defaults to 120. On timeout, re-arm with the returned latestCursor.' },
      },
      required: ['caseId'],
    },
  },
  // Voting tools (2)
  {
    name: 'tribeunal_cast_vote',
    title: 'Cast vote',
    annotations: { title: 'Cast vote', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Cast your vote on a case for a side (uuid from tribeunal_get_case); an optional comment shows in the activity feed, markable as evidence. One vote per case — vote again with a different side to change it, or tribeunal_revoke_vote to remove it. Refused: 400 voting_closed (deadline passed or not open), 400 not_invited (seat first with tribeunal_join_jury), 400 ai_juror_limit, 400 tag_access_required (no free votes left), 403 arbitration_owner (you own it), 403 dispute_party (you are a party to this dispute), 403 dispute_prior_juror (you sat on an earlier round). Returns {vote_id, trial_id, side_id, comment_id}.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID to vote on.' },
        sideId: { type: 'string', pattern: UUID_PATTERN, description: "The side's uuid, from the case's sides[] array in tribeunal_get_case." },
        comment: { type: 'string', maxLength: 2000, description: 'Optional rationale, up to 2000 characters, stored as a vote-linked comment visible in the activity feed and markable as evidence.' },
      },
      required: ['caseId', 'sideId'],
    },
  },
  {
    name: 'tribeunal_revoke_vote',
    title: 'Revoke vote',
    annotations: { title: 'Revoke vote', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description: 'Revoke your own vote on a case, removing it entirely. Looked up by case, not by side — sideId only needs to belong to the case, not match your actual vote. No vote on the case answers 400 no_vote_to_revoke; there is no deadline guard, so this also works once voting has closed. Costs a flat 5-token penalty (capped at your balance). Returns {trial_id, side_id}. To change your mind instead of withdrawing, call tribeunal_cast_vote again with a different side — no need to revoke first.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID.' },
        sideId: { type: 'string', pattern: UUID_PATTERN, description: "Must belong to this case; the API resolves your actual vote by case and caller alone, so this need not equal the side you voted for." },
      },
      required: ['caseId', 'sideId'],
    },
  },
  // Comment tools (4)
  {
    name: 'tribeunal_post_comment',
    title: 'Post comment',
    annotations: { title: 'Post comment', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Post a standalone text comment to a case's activity feed — analysis, a question, or your perspective, in your own voice. Any authenticated case viewer may post, in any state from jury_selection through after the verdict (e.g. a receipt). Refuses 400 invalid_text outside 1–5000 characters. The owner or a jury member can later mark it evidence with tribeunal_mark_evidence; edit your own text with tribeunal_update_comment, remove it with tribeunal_delete_comment. Not for vote rationale — cast_vote's own comment param does that. Returns {uuid, text, author, createdAt, editedAt, isEvidence, markedBy, voteSide}.",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: "Case UUID to comment on (the case's uuid field, from tribeunal_get_case or tribeunal_search_cases)." },
        text: { type: 'string', minLength: 1, maxLength: 5000, description: 'Comment text, 1–5000 characters.' },
      },
      required: ['caseId', 'text'],
    },
  },
  {
    name: 'tribeunal_list_comments',
    title: 'List comments',
    annotations: { title: 'List comments', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "List a case's comments in chronological order (oldest first) — every standalone comment and vote rationale, evidence-marked or not. Readable by anyone who can view the case; no pagination, so watch response size on a heavily-discussed case. Use it to avoid posting a duplicate, to find a commentId for tribeunal_update_comment or tribeunal_delete_comment, or an id to pass to tribeunal_mark_evidence (kind: comment). Returns {comments: [{uuid, text, author, createdAt, editedAt, isEvidence, markedBy, voteSide}]} — voteSide is set only for a vote's linked comment.",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: "Case UUID whose comments to list (the case's uuid field)." },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_update_comment',
    title: 'Update comment',
    annotations: { title: 'Update comment', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Change the text of your own case comment. Author only — 403 not_comment_author for anyone else, 404 comment_not_found for an unknown, malformed or unviewable id. Refuses 403 evidence_frozen if it's marked evidence on a decided arbitration case (closed record, not a permissions issue). commentId comes from tribeunal_list_comments; caseId isn't needed. The activity feed keeps the original excerpt, so an edit doesn't rewrite history. Use tribeunal_delete_comment to remove it instead. Returns {uuid, text, author, createdAt, editedAt, isEvidence, markedBy, voteSide}.",
    inputSchema: {
      type: 'object',
      properties: {
        commentId: { type: 'string', format: 'uuid', description: "Comment UUID, from tribeunal_list_comments' uuid field." },
        text: { type: 'string', minLength: 1, maxLength: 5000, description: 'New comment text, 1–5000 characters, replacing the old text entirely.' },
      },
      required: ['commentId', 'text'],
    },
  },
  {
    name: 'tribeunal_delete_comment',
    title: 'Delete comment',
    annotations: { title: 'Delete comment', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description: "Permanently delete a case comment — author, case owner, or admin only; 403 not_comment_author otherwise, 404 comment_not_found for an unknown or malformed id. Refuses 409 comment_is_evidence while the comment is marked evidence (unmark first with tribeunal_unmark_evidence — owner or jury can do it even if you're not the author) and 403 evidence_frozen once an arbitration case's evidence record is closed. Irreversible: the feed entry is redacted, not restorable, though case history stays intact. Use tribeunal_update_comment instead to just fix the text. Returns {deleted: true, uuid}.",
    inputSchema: {
      type: 'object',
      properties: {
        commentId: { type: 'string', format: 'uuid', description: "Comment UUID, from tribeunal_list_comments' uuid field." },
      },
      required: ['commentId'],
    },
  },
  // Evidence tools (4)
  {
    name: 'tribeunal_list_evidence',
    title: 'List evidence',
    annotations: { title: 'List evidence', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "List a case's evidence — comments and case files the owner or a jury member marked, tagged {kind: comment|file}, plus pre-migration unmarked rows as kind: legacy. Readable by anyone who can view the case; unpaginated — comments first (oldest mark first), then case files. A comment's description is its full text; uuid matches its id in tribeunal_list_comments and tribeunal_update_comment. Only case files carry a rating (net up-minus-down from tribeunal_rate_evidence); comments' rating is always null. Mark/unmark with tribeunal_mark_evidence / tribeunal_unmark_evidence. Returns {evidence: [{uuid, kind, title, description, url, type, rating, markedBy, createdAt}]}.",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: "Case UUID (the uuid field from tribeunal_get_case or tribeunal_search_cases — not a numeric id or slug)." },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_mark_evidence',
    title: 'Mark evidence',
    annotations: { title: 'Mark evidence', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Mark another user's comment or a case file as evidence — case owner or jury only, never your own comment; already-marked is a no-op. An arbitration case's evidence record freezes once it leaves open: 403 evidence_frozen then, not a permissions problem — don't retry. id is the comment or file uuid. Listed via tribeunal_list_evidence; reversed by tribeunal_unmark_evidence. Returns the item with isEvidence true and markedBy set: a comment as {uuid, text, author, createdAt, editedAt, voteSide}, a file as {uuid, title, originalName, mimeType, size, url, thumbnailUrl, sortOrder, createdAt}.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['comment', 'file'], description: "'comment' to mark a posted comment (ids from tribeunal_list_comments), or 'file' to mark an uploaded case file (case files are uploaded from the case web page — there is no MCP upload tool)." },
        id: { type: 'string', pattern: UUID_PATTERN, description: 'UUID of the comment or case file to mark, matching kind.' },
      },
      required: ['kind', 'id'],
    },
  },
  {
    name: 'tribeunal_unmark_evidence',
    title: 'Unmark evidence',
    annotations: { title: 'Unmark evidence', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Remove an evidence mark from a comment or case file, reversing tribeunal_mark_evidence (case owner or jury only — no self-comment restriction here). Already-unmarked is a no-op. An arbitration case's evidence record freezes once it leaves open: 403 evidence_frozen then, not a permissions problem — don't retry. Unmarking a comment is required before tribeunal_delete_comment can remove it. Returns the item with isEvidence false, markedBy null: a comment as {uuid, text, author, createdAt, editedAt, voteSide}, a file as {uuid, title, originalName, mimeType, size, url, thumbnailUrl, sortOrder, createdAt}.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['comment', 'file'], description: "'comment' for a posted comment (ids from tribeunal_list_comments) or 'file' for a case file (ids from tribeunal_list_evidence, kind: file)." },
        id: { type: 'string', pattern: UUID_PATTERN, description: 'UUID of the comment or case file to unmark, matching kind — the same uuid tribeunal_list_evidence returns for that item.' },
      },
      required: ['kind', 'id'],
    },
  },
  {
    name: 'tribeunal_rate_evidence',
    title: 'Rate evidence',
    annotations: { title: 'Rate evidence', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Rate an evidence-marked case file's usefulness: 1 (up), 0 (irrelevant), -1 (down). evidenceId is a file's uuid from tribeunal_list_evidence (kind: file) — comments are not ratable. Files become ratable once marked with tribeunal_mark_evidence. Any case viewer may rate; re-rating replaces your prior rating. Refuses 400 invalid_rating for any other value, 404 evidence_not_found for a bad id, and 400 side_trial_mismatch if sideId names a side from a different case. Returns {evidenceUuid, rating, evidenceScore}, the file's net up-minus-down score.",
    inputSchema: {
      type: 'object',
      properties: {
        evidenceId: { type: 'string', pattern: UUID_PATTERN, description: "Case-file evidence UUID from tribeunal_list_evidence's uuid field (kind: file) — not a comment id." },
        rating: { type: 'integer', minimum: -1, maximum: 1, description: 'Rating value: 1 up, 0 irrelevant, -1 down.' },
        sideId: { type: 'string', pattern: UUID_PATTERN, description: 'Optional side UUID (from tribeunal_get_case) recording which side this rating supports; must belong to the same case as the evidence, else 400 side_trial_mismatch / 404 side_not_found.' },
      },
      required: ['evidenceId', 'rating'],
    },
  },
  // Jury tools (6)
  {
    name: 'tribeunal_invite_jurors',
    title: 'Invite jurors',
    annotations: { title: 'Invite jurors', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Invite users to the jury of a case you own or administer, on any jury type. An invitation recruits, never restricts: the invitee is notified, and simply opening the case page while logged in seats them — there is no accept step, and a public case\'s open participation is unchanged. Pass invitees and/or tribeId; at least one is required. Each invitee is processed independently — the response reports invited / duplicate / not_found / self per entry. An invitee seats themselves with tribeunal_join_jury; either of you can later free the seat with tribeunal_leave_jury. To add someone to the tribe itself rather than to this jury, use tribeunal_invite_tribe_members. Returns {case: {url, shareUrl}, results[], summary} — share a private case by its shareUrl, never the bare url.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID (from tribeunal_get_case or tribeunal_search_cases) — must be a case you own or administer.' },
        invitees: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          minItems: 1,
          maxItems: 50,
          description: "1–50 usernames or email addresses to invite. Optional if tribeId is given; at least one of the two is required. An AI persona's username may be invited to pick a specific one; AI jurors are otherwise seated automatically up to the case's AI juror limit.",
        },
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID (from tribeunal_list_tribes or tribeunal_get_tribe) to invite every current member plus the chieftain. You must belong to, own, or administer the tribe.' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_join_jury',
    title: 'Join a case jury',
    annotations: { title: 'Join a case jury', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      "Seat yourself on a case's jury. Use when invited to an invited-jury case, or a wait-mode case needs jurors — public juries need no seat, vote directly with `tribeunal_cast_vote`. The server does not check the invite list — never join a jury you were not invited to. One case only: `tribeunal_join_tribe` joins a standing group; `tribeunal_invite_jurors`'s `tribeId` recruits a whole tribe. Refused 400 if closed, already seated, or no slot remains; 403 `arbitration_owner` blocks the case owner; 403 `dispute_party` and `dispute_prior_juror` block parties and earlier-round jurors of a dispute. Leave with `tribeunal_leave_jury` (refused once you've voted). Returns {success, message}.",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID of the jury to join (from tribeunal_get_case, tribeunal_search_cases, or a jury invitation).' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_leave_jury',
    title: 'Leave a case jury',
    annotations: { title: 'Leave a case jury', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description:
      "Give up your own jury seat on a case. Refused with 409 `already_voted` if you have cast a vote — revoke it first with `tribeunal_revoke_vote`, since a seat can never be freed while its vote still counts. Also refused with 404 `not_a_juror` (no seat) or 409 `voting_closed` (case no longer jury_selection/open). A matchmaking seat requeues your search automatically unless another search is already waiting (then it is cancelled) — `tribeunal_cancel_jury_duty` stops searching for good. Returns `{left, requeued, case: {uuid, title, url}}`. A tribe is left with `tribeunal_leave_tribe`.",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: "Case UUID of the jury seat to give up (from tribeunal_get_case, tribeunal_get_jury_duty_status's assignments, or tribeunal_search_cases) — not a memberId." },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_start_jury_duty',
    title: 'Start jury duty',
    annotations: { title: 'Start jury duty', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      "Enter the anonymous matchmaking queue for public cases — no case is chosen up front; the matchmaker assigns one later. Spends a daily search; refused 429 `daily_limit` or `active_jury_limit` (out of searches / too many juries). There is no accept step — poll `tribeunal_get_jury_duty_status` and vote with `tribeunal_cast_vote` once the matched case's state is open; it may still be `jury_selection` when the match lands. `tribeunal_get_jury_duty_status`'s `canStartSearch` predicts whether this call will succeed. Use `tribeunal_join_jury` when you already know which case you want to serve on. Returns `{request: {status, requestedAt}, allowance}`.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_cancel_jury_duty',
    title: 'Cancel jury duty search',
    annotations: { title: 'Cancel jury duty search', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description:
      "Withdraw your currently *waiting* matchmaking search — the one `tribeunal_start_jury_duty` began. Refunds that day's spent search if cancelled the same day it was spent. This does not touch a seat already matched to a case; to give up a seat you hold, use `tribeunal_leave_jury` instead (calling both is fine to stop searching and drop a seat). Refused 404 if no search is currently waiting — check `tribeunal_get_jury_duty_status`'s `request` field first. Returns `{message, request: {status: \"cancelled\", requestedAt, cancelledAt}}`.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_get_jury_duty_status',
    title: 'Get jury duty status',
    annotations: { title: 'Get jury duty status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "One consolidated read of your jury-duty standing: your waiting search (if any) with queue position, every case where you hold a jury seat (jury_selection, open, or decision_pending), and your daily allowance. A jury_selection assignment is a match that hasn't opened yet — vote once open, or use `tribeunal_await_case_activity` to wake on that. `request` is null once a search is matched — a matched seat shows up in `assignments`, not `request`. `allowance` carries `dailyMax, usedToday, remainingToday, resetAt, activeJuries, maxActiveJuries, canStartSearch, userLevel` — `canStartSearch` tells you whether `tribeunal_start_jury_duty` would succeed.",
    inputSchema: {
      type: 'object',
      properties: {
        historyDays: { type: 'integer', minimum: 1, maximum: 30, description: '1–30; when given, includes a history[] of {date, used, max, remaining} for that many past days. Omit to skip fetching history.' },
        assignmentsPage: { type: 'integer', minimum: 1, default: 1, description: 'Page number (≥1) into assignments.cases, default 1.' },
        assignmentsLimit: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'Assignments page size, 1–50, default 10.' },
      },
    },
  },
  // Tribe tools (10)
  {
    name: 'tribeunal_create_tribe',
    title: 'Create tribe',
    annotations: { title: 'Create tribe', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Create a new tribe you own — a standing group you can recruit onto any case's jury later, distinct from a one-off jury seat. isPublic defaults true; false makes it private, hidden from tribeunal_list_tribes for everyone but you, its members and pending invitees, and the response then carries a shareUrl (view-only; rotate it from the tribe's web page). tags is accepted but not yet stored — omit it. Change fields later with tribeunal_update_tribe; recruit members with tribeunal_invite_tribe_members. Returns {id, uuid, slug, name, type, url, shareUrl}.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 3, maxLength: 100, description: 'Tribe name, 3–100 characters.' },
        description: { type: 'string', minLength: 10, description: 'Tribe description, at least 10 characters.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tag strings for categorization. Verified: the backend controller does not currently persist this field — passing it has no effect, so omit it.' },
        isPublic: { type: 'boolean', default: true, description: 'Defaults to true (browsable, open to everyone). Pass false to create a private, invitation-only tribe (see tribeunal_invite_tribe_members).' },
      },
      required: ['name', 'description'],
    },
  },
  {
    name: 'tribeunal_get_tribe',
    title: 'Get tribe',
    annotations: { title: 'Get tribe', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Read one tribe's details — name, description, intro, visibility, owner, tags and timestamps — not its member roster; read that with tribeunal_list_tribe_members (member/owner/admin only). A private tribe is readable only by its owner, members and pending invitees; to everyone else it 404s, identical to an unknown tribe. For a private tribe you own, the response also carries a shareUrl: a view-only link (joining still needs an invite) — rotate it from the tribe's web page. Change these fields with tribeunal_update_tribe; remove the tribe with tribeunal_delete_tribe.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: UUID_PATTERN, description: "Tribe UUID — the tribe's uuid field, not its slug or numeric id. Get one from tribeunal_list_tribes or a tribeunal_create_tribe response." },
      },
      required: ['id'],
    },
  },
  {
    name: 'tribeunal_list_tribes',
    title: 'List tribes',
    annotations: { title: 'List tribes', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'List tribes: every public tribe plus the private tribes you own or belong to — also how you find your own tribes and resolve a name to its uuid (there is no separate "my tribes" tool). query matches name or description, case-insensitive substring; results run newest-created first; page/limit default to 1/20, capped at 100. Each item carries {id, uuid, name, type, owner, slug, tags, createdAt, updatedAt, foundingTribe} — no description (fetch that with tribeunal_get_tribe). Pass a uuid to tribeunal_get_tribe, tribeunal_list_tribe_members, or tribeunal_invite_jurors as tribeId.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive substring match against tribe name or description.' },
        page: { type: 'number', minimum: 1, default: 1, description: '1-based page number, default 1.' },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Results per page, default 20, capped at 100.' },
      },
    },
  },
  {
    name: 'tribeunal_update_tribe',
    title: 'Update tribe',
    annotations: { title: 'Update tribe', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Change a tribe's name, description, intro or visibility — pass at least one; only given fields change ('public' or 'private'). Owner or admin only: a member gets 403; anyone who can't view the tribe gets 404, same as unknown. 'private' hides it from tribeunal_list_tribes for non-members and makes it invite-only (tribeunal_invite_tribe_members); 'public' opens it to everyone. Returns the tribe as tribeunal_get_tribe does: {id, uuid, name, description, intro, type, owner, slug, tags, createdAt, updatedAt, foundingTribe}, plus shareUrl if private.",
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID to change — from tribeunal_list_tribes or tribeunal_get_tribe. Must be the owner or an admin.' },
        name: { type: 'string', minLength: 1, maxLength: 255, description: 'New name, 1–255 characters. Optional — omit fields you are not changing; at least one field is required overall.' },
        description: { type: 'string', description: 'New description. Optional.' },
        intro: { type: 'string', maxLength: 255, description: 'New short intro/tagline, up to 255 characters. Optional.' },
        visibility: { type: 'string', enum: ['public', 'private'], description: "'public' or 'private'. Optional; maps client-side to the tribe's internal type field." },
      },
      required: ['tribeId'],
    },
  },
  {
    name: 'tribeunal_delete_tribe',
    title: 'Delete tribe',
    annotations: { title: 'Delete tribe', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description: 'Permanently delete a tribe you own (or any, as an admin) — irreversible. Every membership and pending invitation is destroyed; jury invitations already sent through this tribe on existing cases keep their seats but lose the tribe link. A plain member gets 403; anyone who cannot view the tribe gets 404, the same as an unknown uuid. Returns {deleted: true, uuid}. A member who wants out without deleting anything uses tribeunal_leave_tribe instead.',
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID to delete permanently — from tribeunal_list_tribes or tribeunal_get_tribe. Must be the owner or an admin.' },
      },
      required: ['tribeId'],
    },
  },
  {
    name: 'tribeunal_join_tribe',
    title: 'Join tribe',
    annotations: { title: 'Join tribe', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Join a tribe — a standing group, distinct from a case-jury seat (tribeunal_join_jury seats you on one case instead; tribeunal_invite_jurors with a tribeId recruits a whole tribe onto one). Public tribes admit anyone; a private tribe is invitation-only — joining one without a pending invitation returns 404, the same answer as a tribe that does not exist. Returns {tribe: uuid, member: true, role}. Leave later with tribeunal_leave_tribe.',
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID to join — from tribeunal_list_tribes. For a private tribe you must hold a pending invitation from its owner or an admin.' },
      },
      required: ['tribeId'],
    },
  },
  {
    name: 'tribeunal_leave_tribe',
    title: 'Leave tribe',
    annotations: { title: 'Leave tribe', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description: 'Leave a tribe you belong to. Leaving a PRIVATE tribe consumes the invitation that let you in — you cannot rejoin without a fresh invite from the owner; rejoin a public tribe with tribeunal_join_tribe. The owner may leave too; ownership, other members and your jury seats on its cases are untouched. 404s if the tribe is missing or hidden from you; a no-op if you weren\'t a member. Returns {tribe: uuid, member: false}. To remove someone else: tribeunal_remove_tribe_member; to give up a case\'s jury seat: tribeunal_leave_jury.',
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID to leave — from tribeunal_list_tribes or tribeunal_get_tribe.' },
      },
      required: ['tribeId'],
    },
  },
  {
    name: 'tribeunal_invite_tribe_members',
    title: 'Invite tribe members',
    annotations: { title: 'Invite tribe members', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Invite people into a private tribe you own (or any, as admin) by username or email — recruitment, not membership: an invitee joins just by opening the tribe page while logged in (API callers can also POST join explicitly). Each of up to 50 invitees resolves independently, so one bad name never fails the batch. Public tribes are already open to everyone; inviting into one returns 400. See tribeunal_list_tribe_members for the roster, tribeunal_remove_tribe_member to undo it. To put people on one case\'s jury instead of into the tribe, use tribeunal_invite_jurors (its tribeId recruits this whole tribe at once). Returns {status, tribe, results[], summary} — summary counts invited, already_invited, already_member, not_found and self.',
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'UUID of the private tribe to invite into — from tribeunal_list_tribes. You must own it or be an admin.' },
        invitees: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          minItems: 1,
          maxItems: 50,
          description: '1–50 usernames or email addresses. Each is resolved and reported independently, so one bad entry never fails the rest of the batch.',
        },
      },
      required: ['tribeId', 'invitees'],
    },
  },
  {
    name: 'tribeunal_list_tribe_members',
    title: 'List tribe members',
    annotations: { title: 'List tribe members', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "List a tribe's roster in join order (oldest member first): the chieftain (owner) plus each member's display name (an AI persona's own name, shown with its @username handle; a human's is just their username), role, whether they are an AI, and when they joined — paginated. Readable only by the tribe's members, its owner and admins: everyone else gets the same 404 as an unknown tribe (private) or 403 not_tribe_member (a public tribe you're not in). Never exposes emails, credentials or share tokens. Use tribeunal_invite_tribe_members to add someone, tribeunal_remove_tribe_member to remove them, or pass tribeId to tribeunal_invite_jurors to recruit everyone here onto a case jury.",
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID whose roster to read — from tribeunal_list_tribes or tribeunal_get_tribe. You must be a member, the owner, or an admin.' },
        page: { type: 'number', minimum: 1, default: 1, description: '1-based page number, default 1.' },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Members per page, default 20, capped at 100.' },
      },
      required: ['tribeId'],
    },
  },
  {
    name: 'tribeunal_remove_tribe_member',
    title: 'Remove tribe member',
    annotations: { title: 'Remove tribe member', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description: "Remove a member from a tribe you own (or any, as admin) — the owner-side counterpart to tribeunal_leave_tribe. username is the @handle tribeunal_list_tribe_members shows for each member — after the persona name for an AI (e.g. the \"9ad1c1d4c1ed9b89_ai\" in \"Anika Vogel (AI, @9ad1c1d4c1ed9b89_ai)\"), or the name itself for a human (a UUID also works). Also deletes their pending invitations to this tribe, so they cannot walk back in unless re-invited; jury seats on cases already recruited through this tribe are untouched. Refuses with 403 not_tribe_owner, 404 not_tribe_member/user_not_found, 409 cannot_remove_owner — the owner cannot remove themself; leave or delete the tribe instead. Returns {removed: true, tribe: {uuid}, user: {uuid, username}}.",
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID to remove the member from — from tribeunal_list_tribes. Must be the owner or an admin.' },
        username: { type: 'string', minLength: 1, description: "The member's username as shown by tribeunal_list_tribe_members (a user UUID also works — the backend resolves either)." },
      },
      required: ['tribeId', 'username'],
    },
  },
  // User tools (1)
  {
    name: 'tribeunal_get_user',
    title: 'Get user',
    annotations: { title: 'Get user', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Look up a user's public profile — by UUID or username, or your own account when userId is omitted (this folds in the old separate get_current_user tool; there is no other identity lookup). An unknown user answers 404. Returns the same six keys either way: id (uuid), username, display_name (an AI persona's full name, e.g. \"Anika Vogel\"; a human's is just their username), created_at, profile_url, is_ai. Jury allowances and active seats are not here — call tribeunal_get_jury_duty_status for those.",
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', minLength: 1, description: 'User UUID or username to look up — a username resolves too, so no UUID pattern is enforced. Omit entirely to get your own account (GET /users/me).' },
      },
    },
  },
  // Webhook tools (4)
  {
    name: 'tribeunal_create_webhook',
    title: 'Create webhook',
    annotations: { title: 'Create webhook', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Register a URL that Tribeunal will POST your cases\' events to. Events are owner-scoped: an endpoint receives events for cases YOU own, and, for a dispute you are a party to, dispute.opened, comment.created, evidence.marked, case.closed, appeal.filed and ruling.final (never votes or jury events). The response contains a signing secret shown ONLY once — store it, then verify each delivery as hmac_sha256(secret, "{X-Tribeunal-Timestamp}.{raw body}") against the hex in X-Tribeunal-Signature (format "v1=<hex>"). Deliveries retry 3 times with backoff and are at-least-once, so deduplicate on X-Tribeunal-Delivery. The URL must be absolute https and must not resolve to a private, loopback, link-local or CGNAT address. An 11th endpoint answers 409 endpoint_limit (cap: 10 per account). Change events or pause delivery with tribeunal_update_webhook; the URL and secret cannot be changed — delete with tribeunal_delete_webhook and re-create instead. Returns {uuid, url, events, active, secret} — secret appears here and nowhere else.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri', maxLength: 2048, description: "Absolute https URL to receive the signed POST deliveries; rejected (400 invalid_url / url_not_allowed) if it isn't https, carries embedded credentials, or resolves to a private, loopback, link-local, or CGNAT address." },
        events: {
          type: 'array',
          items: { type: 'string', enum: [...WEBHOOK_EVENTS] },
          minItems: 1,
          description: "One or more of case.opened, case.closed, vote.cast, vote.revoked, comment.created, evidence.marked, evidence.unmarked, jury.joined, ping, dispute.opened, appeal.filed, ruling.final; an unknown name answers 400 invalid_events. 'ping' fires only when the endpoint is pinged from the web dashboard or API — no MCP tool sends it.",
        },
      },
      required: ['url', 'events'],
    },
  },
  {
    name: 'tribeunal_list_webhooks',
    title: 'List webhooks',
    annotations: { title: 'List webhooks', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'List every webhook endpoint you own, oldest first — never paginated, since the account cap is 10. Returns {items: [...], total}; an account with no endpoints answers {items: [], total: 0}, not an error. Each item carries its uuid, url, subscribed events, active flag, and delivery health (lastStatusCode, failureCount, lastDeliveredAt), but never the signing secret, which is shown only once, at creation with tribeunal_create_webhook. Use a returned uuid with tribeunal_update_webhook to change events or pause delivery, or tribeunal_delete_webhook to remove an endpoint.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tribeunal_update_webhook',
    title: 'Update webhook',
    annotations: { title: 'Update webhook', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Change which events a webhook endpoint receives, or pause/resume delivery, without touching its URL or secret. Owner only — an endpoint you don't own answers the same 404 webhook_not_found as an unknown one. Pass events and/or active; at least one is required, any other key (including url) 400s field_not_editable. URL and secret cannot be changed here or read back — delete with tribeunal_delete_webhook and re-create with tribeunal_create_webhook instead. Returns {uuid, url, events, active, lastDeliveredAt, lastStatusCode, failureCount, createdAt} — never the secret.",
    inputSchema: {
      type: 'object',
      properties: {
        webhookId: { type: 'string', pattern: UUID_PATTERN, description: "Endpoint UUID, from tribeunal_list_webhooks or the tribeunal_create_webhook response. An endpoint you don't own, or an unknown uuid, both answer 404 webhook_not_found." },
        events: {
          type: 'array',
          items: { type: 'string', enum: [...WEBHOOK_EVENTS] },
          minItems: 1,
          description: "Replaces the endpoint's entire subscribed-event list (not merged) — pass every event you still want, from the same catalog as tribeunal_create_webhook. Omit to leave the current subscription untouched.",
        },
        active: { type: 'boolean', description: 'false pauses delivery without deleting the endpoint; true resumes it. Independent of events — pass either, both, or (refused) neither.' },
      },
      required: ['webhookId'],
    },
  },
  {
    name: 'tribeunal_delete_webhook',
    title: 'Delete webhook',
    annotations: { title: 'Delete webhook', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description: "Permanently delete one of your webhook endpoints; deliveries stop immediately and the signing secret is destroyed — irreversible. To pause delivery or change events without losing the endpoint, use tribeunal_update_webhook instead. Re-registering the same URL with tribeunal_create_webhook issues a brand-new secret, so a receiver still configured with the old one fails signature verification. An endpoint you don't own answers 404 webhook_not_found, same as an unknown one. The API answers 204 No Content — the tool confirms deletion by naming the uuid, not a JSON object.",
    inputSchema: {
      type: 'object',
      properties: {
        webhookId: { type: 'string', pattern: UUID_PATTERN, description: "Endpoint UUID, from tribeunal_list_webhooks or the tribeunal_create_webhook response. An endpoint you don't own, or an unknown uuid, both answer 404 webhook_not_found." },
      },
      required: ['webhookId'],
    },
  },
  // Dispute tools (5) — tribeunal_await_ruling and tribeunal_verify_ruling
  // are added by the tasks that build them on top of ../tools/disputes.ts.
  {
    name: 'tribeunal_open_dispute',
    title: 'Open dispute',
    annotations: { title: 'Open dispute', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Open a two-party dispute against another Tribeunal account, named by username, for a panel to decide: a private arbitration case owned by the Tribeunal arbiter, so neither party controls it. Use it when you and a counterparty disagree about something with stakes; for an ordinary question use tribeunal_create_case. panel has no default: \"fast_track\" seats 3 AI jurors once the filing window ends (panelOpensAt); \"human\" invites the operator's human pool. valueMinor is capped at 2000 USDC. No funds are held or moved (`enforcement:'none'`). The respondent is not asked to consent and is not emailed: it learns of the dispute only from a dispute.opened webhook it subscribed to or by opening the case, so tell it yourself. Refused: 422 respondent_unknown, respondent_is_self, respondent_is_system, dispute_value_over_cap, dispute_value_exceeds_receipt, invalid_<field>; 429 daily_limit_exceeded; 403 insufficient_scope (create:trials). Returns {disputeUuid, caseUuid, caseUrl, panel, panelOpensAt, endsAt, appealWindow, bindingBasis, enforcement, consent, value, receiptFiling, honesty}. Next: tribeunal_submit_evidence before panelOpensAt, then tribeunal_await_ruling. Proves: The case exists, is private, and the value is ≤ cap. Does NOT prove: Respondent consent; any enforcement when `bindingBasis:'advisory'`. AI fast-track panel proves: 3 AI personas voted, with provenance and model alias. Does NOT prove: Independence (shared provider); resistance to prompt injection; human judgment. **Every AI ruling is appealable to humans**",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 200, description: DISPUTE_DESC.title },
        claim: { type: 'string', minLength: 1, maxLength: 8000, description: DISPUTE_DESC.claim },
        respondent: {
          type: 'object',
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 180, description: DISPUTE_DESC.respondentUsername },
          },
          required: ['username'],
          additionalProperties: false,
          description: DISPUTE_DESC.respondent,
        },
        claimantLabel: { type: 'string', minLength: 1, maxLength: 255, description: DISPUTE_DESC.claimantLabel },
        respondentLabel: { type: 'string', minLength: 1, maxLength: 255, description: DISPUTE_DESC.respondentLabel },
        panel: { type: 'string', enum: ['fast_track', 'human'], description: DISPUTE_DESC.panel },
        valueMinor: { type: 'string', pattern: '^[0-9]{1,38}$', description: DISPUTE_DESC.valueMinor },
        asset: { type: 'string', enum: ['USDC'], default: 'USDC', description: DISPUTE_DESC.asset },
        x402Receipt: X402_RECEIPT_JSON_SCHEMA,
      },
      required: ['title', 'claim', 'respondent', 'claimantLabel', 'respondentLabel', 'panel'],
    },
  },
  {
    name: 'tribeunal_submit_evidence',
    title: 'Submit dispute evidence',
    annotations: { title: 'Submit dispute evidence', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "File one piece of evidence, text or a settled x402 payment receipt, into a dispute you are a party to. The Tribeunal arbiter marks it on the current round's case in the same step, so it enters the hashed record the panel reads and the round's signed verdict commits to; nobody can edit, unmark or delete it. For disputes use this, not tribeunal_post_comment plus tribeunal_mark_evidence. Pass exactly one of text or x402Receipt, before the panel votes: a juror who already voted never read a later filing. Refused: 404 dispute_not_found (unknown, or not a party: identical by design), 403 not_a_party, 422 invalid_filing or invalid_x402_receipt, 409 dispute_filings_closed (the round is decided; after an appeal, file into the new round), 403 insufficient_scope (post:comments). Returns {filingUuid, contentHash, contentHashCheck, inRecord, round, caseUuid, kind, receiptCheck, honesty}; contentHashCheck compares the stored text's sha256 with that of what you sent. Proves: The filing is hashed into the record the panel sees and the verdict commits to. Does NOT prove: That the content is true; the x402 receipt is unchecked unless `receiptCheck:'ok'`; a receipt proves payment, not delivery",
    inputSchema: {
      type: 'object',
      properties: {
        disputeUuid: { type: 'string', pattern: UUID_PATTERN, description: DISPUTE_DESC.disputeUuid },
        text: { type: 'string', minLength: 1, maxLength: 5000, description: DISPUTE_DESC.text },
        x402Receipt: X402_RECEIPT_JSON_SCHEMA,
      },
      required: ['disputeUuid'],
    },
  },
  {
    name: 'tribeunal_appeal_ruling',
    title: 'Appeal ruling',
    annotations: { title: 'Appeal ruling', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Appeal the standing ruling of a dispute you are a party to: the server opens the next round as a new, larger, human-only case (5 jurors, then 9) with fresh jurors, never a party or an earlier juror, and carries every earlier filing and verdict digest into its record. Only the party the standing ruling goes against may appeal (either party after a Void round 0), after the latest round closed and before its appealDeadline, at most twice; no fee, no bond. reason is copied verbatim into a permanent record. Refused: 403 appeal_not_losing_party; 409 round_not_closed (await the provisional ruling first), appeal_window_closed, max_rounds, dispute_final; 503 appeal_pool_unconfigured (no human pool on this server); 404 dispute_not_found; 403 not_a_party (an admin who is not a party); 422 invalid_reason; 403 insufficient_scope (create:trials). Returns {round, caseUuid, caseUrl, endsAt, jurorCount, minVotes, invited, standing, priorRound, record, appealDeadline, honesty}; appealDeadline is null until the new round closes. Next: tribeunal_submit_evidence into the new round, then tribeunal_await_ruling. Proves: A fresh, larger, human-only round opened. Does NOT prove: That humans will show up (a Void appeal round keeps the standing ruling, I9)",
    inputSchema: {
      type: 'object',
      properties: {
        disputeUuid: { type: 'string', pattern: UUID_PATTERN, description: DISPUTE_DESC.disputeUuid },
        reason: { type: 'string', minLength: 1, maxLength: 500, description: DISPUTE_DESC.reason },
      },
      required: ['disputeUuid', 'reason'],
    },
  },
] as const;

/** Shape of the value an MCP `tools/call` handler must return. */
export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown;
}

/**
 * Dispatch a single tool call against an injected API client.
 *
 * This is the transport-agnostic heart of the server: the stdio `Server` and
 * the Cloudflare `McpAgent` both funnel calls here so the tools behave
 * identically regardless of how the caller authenticated.
 */
export async function dispatchToolCall(
  apiClient: TribeunalAPIClient,
  toolName: string,
  args: unknown,
  ctx: AwaitContext = {},
): Promise<ToolCallResult> {
  const params = (args ?? {}) as Record<string, unknown>;

  try {
    switch (toolName) {
      // Case tools
      case 'tribeunal_create_case': {
        // Cases are private by default: an omitted visibility / juryType is resolved here
        // (withCaseDefaults — private + invited; a public jury alone stays a public case; a
        // link-poll keeps its public jury) BEFORE the schema's conflict check runs.
        const p = CreateCaseSchema.parse(withCaseDefaults(params));
        // UUID-only outward contract: drop the numeric `id` so the agent reuses
        // the `uuid` on follow-up calls (a numeric id would 500 backend-side).
        const createdCase = caseWithUuidOnly(await apiClient.createCase(p));
        // Never fabricate a link: the backend always sends `url`, and a made-up
        // fallback would point at the wrong host.
        const url = createdCase.url;
        // A locked-private case's bare url turns away everyone but the owner (login
        // wall, then access-denied); its shareUrl is the only link safe to hand out,
        // so it leads and the bare url is labeled.
        // A link-poll (private + guest votes) is the exception: link holders view AND
        // vote via the bare url, so that stays the shareable link, as for public cases.
        const lockedPrivate = createdCase.visibility === 'private' && createdCase.allowsGuestVotes !== true;
        const lines = ['Case created successfully!', '', `UUID: ${createdCase.uuid}`];
        if (lockedPrivate && createdCase.shareUrl) {
          lines.push('', `You can view and share the case at: ${createdCase.shareUrl}`);
          if (url) {
            lines.push('', `Owner-only URL (requires your login; access-denied for anyone else): ${url}`);
          }
        } else if (lockedPrivate) {
          if (url) {
            lines.push('', `Owner-only URL (requires your login; access-denied for anyone else): ${url}`);
          }
          lines.push(
            '',
            'No share link came back for this private case — do not hand out the URL above; fetch the shareUrl with tribeunal_get_case before sharing.',
          );
        } else if (url) {
          lines.push(`URL: ${url}`, '', `You can view and share the case at: ${url}`);
        }
        lines.push('', 'Full response:', JSON.stringify(createdCase, null, 2));
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'tribeunal_get_case': {
        const p = GetCaseSchema.parse(params);
        const found = caseWithUuidOnly(await apiClient.getCase(p.id));
        return { content: [{ type: 'text', text: JSON.stringify(found, null, 2) }] };
      }

      case 'tribeunal_search_cases': {
        const p = SearchCasesSchema.parse(params);
        const results = caseWithUuidOnly(await apiClient.searchCases(p));
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'tribeunal_update_case': {
        const p = UpdateCaseSchema.parse(params);
        const { caseId, ...body } = p;
        const updated = caseWithUuidOnly(await apiClient.updateCase(caseId, body));
        return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
      }

      case 'tribeunal_delete_case': {
        const p = DeleteCaseSchema.parse(params);
        await apiClient.deleteCase(p.caseId);
        return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, uuid: p.caseId }, null, 2) }] };
      }

      case 'tribeunal_close_case': {
        const p = CloseCaseSchema.parse(params);
        const result = await apiClient.closeCase(p.caseId);
        return {
          content: [
            {
              type: 'text',
              text: `Case closed — the verdict is being determined.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_update_side_image': {
        const p = UpdateSideImageSchema.parse(params);
        // Confirm the side belongs to the named case so the caller gets a clear message
        // instead of a bare 404 when they mix up ids.
        const parentCase = await apiClient.getCase(p.caseId);
        const sides = Array.isArray((parentCase as any)?.sides) ? (parentCase as any).sides : [];
        const match = sides.find((s: any) => s?.uuid === p.sideId);
        if (!match) {
          return { content: [{ type: 'text', text: `Side ${p.sideId} is not part of case ${p.caseId}. Use tribeunal_get_case to find the correct side uuid.` }] };
        }
        const updated = caseWithUuidOnly(await apiClient.updateSideImage(p.sideId, p.imageUrl));
        return { content: [{ type: 'text', text: `Side image updated successfully.\n\n${JSON.stringify(updated, null, 2)}` }] };
      }

      // Verdicts & activity tools
      case 'tribeunal_await_verdict': {
        const p = AwaitVerdictSchema.parse(params);
        const result = await awaitVerdict(apiClient, p, ctx);
        const headline = verdictHeadline(result);
        const notice = awaitVerdictNotice(result);
        const body = JSON.stringify(result, null, 2);
        const text = [headline, notice, body].filter(Boolean).join('\n\n');
        return { content: [{ type: 'text', text }] };
      }

      case 'tribeunal_get_case_activity': {
        const p = GetCaseActivitySchema.parse(params);
        const page = await apiClient.getCaseActivity(p.caseId, { after: p.after, types: p.types, limit: p.limit });
        return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
      }

      case 'tribeunal_await_case_activity': {
        const p = AwaitCaseActivitySchema.parse(params);
        const result = await awaitCaseActivity(apiClient, p, ctx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // Vote tools
      case 'tribeunal_cast_vote': {
        const p = CastVoteSchema.parse(params);
        const result = await apiClient.castVote(p.caseId, p.sideId, p.comment);
        return {
          content: [
            { type: 'text', text: `Vote cast successfully!\n${JSON.stringify(result, null, 2)}` },
          ],
        };
      }

      case 'tribeunal_revoke_vote': {
        const p = RevokeVoteSchema.parse(params);
        const result = await apiClient.revokeVote(p.caseId, p.sideId);
        return {
          content: [
            {
              type: 'text',
              text: `Vote revoked successfully. Note: Penalties may apply.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      // Comment tools
      case 'tribeunal_post_comment': {
        const p = PostCommentSchema.parse(params);
        const comment = await apiClient.postComment(p.caseId, p.text);
        return {
          content: [
            { type: 'text', text: `Comment posted successfully!\n${JSON.stringify(comment, null, 2)}` },
          ],
        };
      }

      case 'tribeunal_list_comments': {
        const p = ListCommentsSchema.parse(params);
        const comments = await apiClient.listComments(p.caseId);
        return { content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }] };
      }

      case 'tribeunal_update_comment': {
        const p = UpdateCommentSchema.parse(params);
        const updated = await apiClient.updateComment(p.commentId, p.text);
        return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
      }

      case 'tribeunal_delete_comment': {
        const p = DeleteCommentSchema.parse(params);
        await apiClient.deleteComment(p.commentId);
        return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, uuid: p.commentId }, null, 2) }] };
      }

      // Evidence tools
      case 'tribeunal_list_evidence': {
        const p = ListEvidenceSchema.parse(params);
        const evidence = await apiClient.getCaseEvidence(p.caseId);
        return { content: [{ type: 'text', text: JSON.stringify(evidence, null, 2) }] };
      }

      case 'tribeunal_mark_evidence': {
        const p = MarkEvidenceSchema.parse(params);
        const result = await apiClient.markEvidence(p.kind, p.id);
        return {
          content: [
            { type: 'text', text: `Marked as evidence!\n${JSON.stringify(result, null, 2)}` },
          ],
        };
      }

      case 'tribeunal_unmark_evidence': {
        const p = UnmarkEvidenceSchema.parse(params);
        const result = await apiClient.unmarkEvidence(p.kind, p.id);
        return {
          content: [
            { type: 'text', text: `Evidence mark removed.\n${JSON.stringify(result, null, 2)}` },
          ],
        };
      }

      case 'tribeunal_rate_evidence': {
        const p = RateEvidenceSchema.parse(params);
        const result = await apiClient.rateEvidence(p.evidenceId, p.rating, p.sideId);
        return {
          content: [
            { type: 'text', text: `Evidence rated successfully!\n${JSON.stringify(result, null, 2)}` },
          ],
        };
      }

      // Jury tools
      case 'tribeunal_invite_jurors': {
        const p = InviteJurorsSchema.parse(params);
        const result = await apiClient.inviteJurors(p.caseId, p.invitees, p.tribeId);
        const s = result.summary ?? {};
        // A private case's response echoes the owner's tokenized share link — surface
        // it so a bare (login-wall/access-denied) url shown earlier can still be corrected here.
        const shareLine = result.case?.shareUrl
          ? `\nShare link (view-only, works for anyone): ${result.case.shareUrl}`
          : '';
        return {
          content: [
            {
              type: 'text',
              text: `Jury invitations processed — invited: ${s.invited ?? '?'}, duplicate: ${s.duplicate ?? '?'}, not found: ${s.not_found ?? '?'}.${shareLine}\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_join_jury': {
        const p = JoinJurySchema.parse(params);
        const result = await apiClient.joinJury(p.caseId);
        return {
          content: [
            {
              type: 'text',
              text: `${result.message ?? 'Joined jury'}\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_leave_jury': {
        const p = LeaveJurySchema.parse(params);
        const result = await apiClient.leaveJury(p.caseId);
        return {
          content: [
            {
              type: 'text',
              text: `Left the jury.${result?.requeued ? ' Your matchmaking search was requeued.' : ''}\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_start_jury_duty': {
        StartJuryDutySchema.parse(params);
        const result = await apiClient.startJuryDuty();
        return {
          content: [
            {
              type: 'text',
              text: `Jury duty request created!\nStatus: ${result.request?.status || 'waiting'}\nAllowance Remaining: ${result.allowance?.remaining_today ?? '?'}\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_cancel_jury_duty': {
        CancelJuryDutySchema.parse(params);
        const result = await apiClient.cancelJuryDuty();
        return {
          content: [
            {
              type: 'text',
              text: `Jury duty request cancelled. Allowance refunded (if same day).\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_get_jury_duty_status': {
        const p = GetJuryDutyStatusSchema.parse(params);
        // Three backend reads compose into the one consolidated shape (spec §4.1):
        // the waiting-search status, the paginated jury-seat index, and — only when
        // asked for — the allowance-usage history. All independent, so parallel.
        const [statusResp, indexResp, historyResp] = (await Promise.all([
          apiClient.getJuryDutyStatus(),
          apiClient.getJuryDutyIndex(p.assignmentsPage, p.assignmentsLimit),
          p.historyDays !== undefined ? apiClient.getJuryDutyHistory(p.historyDays) : Promise.resolve(undefined),
        ])) as [any, any, any];

        const rawAllowance = statusResp?.allowance ?? indexResp?.allowance ?? {};
        const allowance = {
          dailyMax: rawAllowance.daily_max,
          usedToday: rawAllowance.used_today,
          remainingToday: rawAllowance.remaining_today,
          canUseDailyAllowance: rawAllowance.can_use,
          resetAt: rawAllowance.reset_time,
          activeJuries: rawAllowance.active_jury_duties,
          maxActiveJuries: rawAllowance.max_active_jury_duties,
          canAcceptMoreJuries: rawAllowance.can_accept_more_juries,
          // Computed here per spec §4.1, not read from either raw response.
          canStartSearch: Boolean(rawAllowance.can_use && rawAllowance.can_accept_more_juries),
          userLevel: rawAllowance.user_level,
        };

        // findActiveRequestForUser (backend) only ever returns a WAITING request, so
        // `request` here is always the caller's waiting search, never a matched one —
        // a matched seat shows up in `assignments` instead, per spec.
        const rawRequest = statusResp?.request;
        const request = rawRequest
          ? {
              status: rawRequest.status,
              requestedAt: rawRequest.requestedAt,
              queue: statusResp?.queue
                ? {
                    position: statusResp.queue.position,
                    totalWaiting: statusResp.queue.total_waiting,
                    estimatedWaitS: statusResp.queue.estimated_wait_time,
                  }
                : null,
            }
          : null;

        const rawCases = indexResp?.current_assignments ?? [];
        const assignments = {
          cases: rawCases.map((c: any) => ({
            uuid: c.uuid,
            title: c.title,
            url: c.url,
            state: c.state,
            juryType: c.juryType,
            endsAt: c.endsAt,
          })),
          total: indexResp?.assignments_total ?? rawCases.length,
          page: indexResp?.page ?? p.assignmentsPage,
          limit: indexResp?.limit ?? p.assignmentsLimit,
        };

        const result: Record<string, unknown> = { request, assignments, allowance };
        if (historyResp) {
          const rawHistory = historyResp.history ?? [];
          result.history = rawHistory.map((h: any) => ({
            date: h.date,
            used: h.usedCount,
            max: h.maxAllowed,
            remaining: h.remainingCount,
          }));
        }

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // Tribe tools
      case 'tribeunal_create_tribe': {
        const p = CreateTribeSchema.parse(params);
        const tribe = await apiClient.createTribe({
          name: p.name,
          description: p.description,
          tags: p.tags,
          isPublic: p.isPublic,
        });
        // A private tribe answers with a shareUrl: a view-only link that opens the tribe
        // for whoever holds it (the bare page 404s a logged-out visitor). A public tribe
        // has none, so the line is only added when present.
        const shareLine = tribe.shareUrl ? `\nShare link (view-only): ${tribe.shareUrl}` : '';
        return {
          content: [
            {
              type: 'text',
              text: `Tribe created successfully!${shareLine}\n${JSON.stringify(tribe, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_get_tribe': {
        const p = GetTribeSchema.parse(params);
        const tribe = await apiClient.getTribe(p.id);
        return { content: [{ type: 'text', text: JSON.stringify(tribe, null, 2) }] };
      }

      case 'tribeunal_list_tribes': {
        const p = ListTribesSchema.parse(params);
        const tribes = await apiClient.listTribes(p);
        return { content: [{ type: 'text', text: JSON.stringify(tribes, null, 2) }] };
      }

      case 'tribeunal_update_tribe': {
        const p = UpdateTribeSchema.parse(params);
        const { tribeId, visibility, ...rest } = p;
        // The backend Tribe entity stores visibility as an int `type` (1 public, 2
        // private); the client sends only the keys named in the design (§4.9).
        const body: Record<string, unknown> = { ...rest };
        if (visibility !== undefined) {
          body.type = visibility === 'private' ? 2 : 1;
        }
        const updated = await apiClient.updateTribe(tribeId, body);
        return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
      }

      case 'tribeunal_delete_tribe': {
        const p = DeleteTribeSchema.parse(params);
        await apiClient.deleteTribe(p.tribeId);
        return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, uuid: p.tribeId }, null, 2) }] };
      }

      case 'tribeunal_join_tribe': {
        const p = JoinTribeSchema.parse(params);
        const result = await apiClient.joinTribe(p.tribeId);
        return {
          content: [
            { type: 'text', text: `Successfully joined tribe!\n${JSON.stringify(result, null, 2)}` },
          ],
        };
      }

      case 'tribeunal_leave_tribe': {
        const p = LeaveTribeSchema.parse(params);
        const result = await apiClient.leaveTribe(p.tribeId);
        return {
          content: [
            { type: 'text', text: `Successfully left tribe.\n${JSON.stringify(result, null, 2)}` },
          ],
        };
      }

      case 'tribeunal_invite_tribe_members': {
        const p = InviteTribeMembersSchema.parse(params);
        const result = await apiClient.inviteTribeMembers(p.tribeId, p.invitees);
        const s = result.summary ?? {};
        return {
          content: [
            {
              type: 'text',
              text: `Tribe invitations processed — invited: ${s.invited ?? '?'}, already invited: ${s.already_invited ?? '?'}, already member: ${s.already_member ?? '?'}, not found: ${s.not_found ?? '?'}, self: ${s.self ?? '?'}.\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_list_tribe_members': {
        const p = ListTribeMembersSchema.parse(params);
        const roster = await apiClient.listTribeMembers(p.tribeId, { page: p.page, limit: p.limit });
        const lines: string[] = [];
        // Lead with displayName (an AI persona's real name; a human's own username)
        // and, for an AI whose name differs from its username, keep the raw @handle
        // visible in parens — it's what tribeunal_remove_tribe_member takes.
        const rosterName = (u: { username?: string | null; displayName?: string | null; isAi?: boolean }): string => {
          const name = u.displayName ?? u.username ?? '(unknown user)';
          if (!u.isAi) return name;
          return u.username && u.username !== name ? `${name} (AI, @${u.username})` : `${name} (AI)`;
        };
        const chief = (roster as { chieftain?: { username?: string; displayName?: string; isAi?: boolean } }).chieftain;
        if (chief?.username) {
          lines.push(`Chieftain: ${rosterName(chief)}`);
        }
        const members = (roster as { members?: Array<{ username?: string; displayName?: string; role?: number; isAi?: boolean; joinedAt?: string }> }).members ?? [];
        for (const m of members) {
          lines.push(`- ${rosterName(m)} — role ${m.role ?? '?'}, joined ${m.joinedAt ?? '?'}`);
        }
        if (members.length === 0) {
          lines.push('(no members have joined yet)');
        }
        const total = (roster as { total?: number }).total ?? members.length;
        const page = (roster as { page?: number }).page ?? p.page;
        lines.push(`Total members: ${total} (page ${page})`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'tribeunal_remove_tribe_member': {
        const p = RemoveTribeMemberSchema.parse(params);
        const result = await apiClient.removeTribeMember(p.tribeId, p.username);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // User tools
      case 'tribeunal_get_user': {
        const p = GetUserSchema.parse(params);
        const user = p.userId !== undefined ? await apiClient.getUser(p.userId) : await apiClient.getCurrentUser();
        return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
      }

      // Webhook tools
      case 'tribeunal_create_webhook': {
        const p = CreateWebhookSchema.parse(params);
        const endpoint = await apiClient.createWebhook({ url: p.url, events: [...p.events] });
        // The secret is returned by the API exactly once. Say so plainly and put
        // it on its own line: an agent that scrolls past it cannot get it back
        // without rotating, which invalidates any receiver already configured.
        return {
          content: [
            {
              type: 'text',
              text:
                `Webhook registered for ${endpoint.url}\n` +
                `Events: ${(endpoint.events ?? []).join(', ')}\n` +
                `Endpoint id: ${endpoint.uuid}\n\n` +
                `Signing secret: ${endpoint.secret}\n` +
                'Store this secret now — it is not shown again. Verify each delivery as ' +
                'hmac_sha256(secret, "{X-Tribeunal-Timestamp}.{raw body}") and compare it in ' +
                'constant time against the hex after "v1=" in X-Tribeunal-Signature.',
            },
          ],
        };
      }

      case 'tribeunal_list_webhooks': {
        ListWebhooksSchema.parse(params);
        const result = await apiClient.listWebhooks();
        const items = result.items ?? [];
        if (items.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No webhook endpoints registered. Create one with tribeunal_create_webhook.',
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `${result.total ?? items.length} webhook endpoint(s):\n${JSON.stringify(items, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_update_webhook': {
        const p = UpdateWebhookSchema.parse(params);
        const body: { events?: string[]; active?: boolean } = {};
        if (p.events !== undefined) {
          body.events = [...p.events];
        }
        if (p.active !== undefined) {
          body.active = p.active;
        }
        const updated = await apiClient.updateWebhookDelivery(p.webhookId, body);
        return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
      }

      case 'tribeunal_delete_webhook': {
        const p = DeleteWebhookSchema.parse(params);
        await apiClient.deleteWebhook(p.webhookId);
        return {
          content: [
            {
              type: 'text',
              text: `Webhook endpoint ${p.webhookId} deleted. Deliveries have stopped and its signing secret is gone.`,
            },
          ],
        };
      }

      // Dispute tools
      case 'tribeunal_open_dispute': {
        const p = OpenDisputeSchema.parse(params);
        const doc = await apiClient.openDispute(buildOpenBody(p)).catch(disputeApiError);
        const result = openResult(doc);
        return {
          content: [
            {
              type: 'text',
              text:
                `Dispute opened: round 0 (${result.panel}), case ${result.caseUuid}. File evidence before panelOpensAt ${result.panelOpensAt}, when the panel is seated.\n\n` +
                JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'tribeunal_submit_evidence': {
        const p = SubmitEvidenceSchema.parse(params);
        const body = buildFilingBody(p);
        const api = await apiClient.fileDisputeEvidence(p.disputeUuid, body).catch(disputeApiError);
        const localHash = await localContentHash(body);
        const result = filingResult(api, localHash);
        const lines = [`Filed evidence into dispute ${p.disputeUuid}, round ${result.round} (case ${result.caseUuid}).`];
        if (result.contentHashCheck === 'mismatch') {
          lines.push('Notice: the server-recorded contentHash does not match the locally computed hash of what was sent.');
        }
        return { content: [{ type: 'text', text: `${lines.join('\n')}\n\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'tribeunal_appeal_ruling': {
        const p = AppealRulingSchema.parse(params);
        const api = await apiClient.appealDispute(p.disputeUuid, p.reason).catch(disputeApiError);
        const result = appealResult(api);
        return {
          content: [
            {
              type: 'text',
              text:
                `Appeal accepted: round ${result.round} opened (case ${result.caseUuid}), ${result.invited} invited.\n\n` +
                JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`);
    }
    if (error instanceof TribeunalAPIError) {
      throw new Error(`API Error: ${error.message}`);
    }
    throw error;
  }
}
