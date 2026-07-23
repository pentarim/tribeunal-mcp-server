import { z } from 'zod';
import { TribeunalAPIClient, TribeunalAPIError } from '../client/api-client.js';
import { UUID_PATTERN, caseWithUuidOnly } from '../tools/uuid.js';

// Case schemas
import {
  SearchCasesSchema,
  GetCaseSchema,
  CreateCaseSchema,
  CloseCaseSchema,
  ListEvidenceSchema,
} from '../tools/cases.js';

// Voting & evidence schemas
import {
  CastVoteSchema,
  RevokeVoteSchema,
  GetVoteStatsSchema,
  RateEvidenceSchema,
} from '../tools/votes.js';

// Comment & evidence-mark schemas
import {
  PostCommentSchema,
  ListCommentsSchema,
  MarkEvidenceSchema,
} from '../tools/comments.js';

import {
  ListTribesSchema,
  GetTribeSchema,
  JoinTribeSchema,
  LeaveTribeSchema,
  CreateTribeSchema,
  InviteTribeMembersSchema,
} from '../tools/tribes.js';

import {
  GetUserSchema,
} from '../tools/users.js';

import {
  JuryDutyAcceptSchema,
  JuryDutyRejectSchema,
  JuryDutyHistorySchema,
  InviteJurorsSchema,
} from '../tools/jury-duty.js';

import { SetSideImageSchema } from '../tools/sides.js';

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
 * The canonical list of tool definitions advertised via `tools/list`.
 *
 * A single "case" vocabulary: every tool maps directly to a Tribeunal API
 * operation. The stdio server and the Cloudflare worker advertise the SAME
 * set so behaviour is identical regardless of how the caller authenticated.
 */
export const TOOL_DEFINITIONS = [
  // Case tools
  {
    name: 'tribeunal_create_case',
    title: 'Create case',
    annotations: { title: 'Create case', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Create a new case on Tribeunal for community decision-making (case = jury decides, advice = creator decides, poll = opinion gathering). Use this directly when the user wants to start, decide, settle, or put something to a vote and no specific existing case is referenced — do NOT search first. Set visibility to "private" to keep a case visible only to you, your invited jurors and admins (a private case runs an invited jury). Add allowsGuestVotes to a private case to make a link-poll instead: unlisted everywhere, but readable and votable by anyone you send the link to. A private case answers with a shareUrl — a view-only link (no voting/joining) you can send to anyone; rotate it from the case web page to revoke every old link at once.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 200, description: 'Case title — the question or statement to be decided' },
        description: { type: 'string', minLength: 10, description: 'Context, background, and criteria for the case' },
        type: { type: 'string', enum: ['case', 'advice', 'poll'], description: 'Case type — case (binding jury decision), advice (input for the creator), or poll (opinion gathering)' },
        juryType: { type: 'string', enum: ['public', 'invited'], default: 'public', description: 'Who can participate — public (anyone) or invited only' },
        visibility: { type: 'string', enum: ['public', 'private'], default: 'public', description: 'Case visibility — public (anyone can find and read it) or private (only you, your invited jurors and admins). A private case must use an invited jury; omit juryType and it is set to invited automatically. One exception: set allowsGuestVotes on a private case and it becomes a link-poll — still absent from every listing, search and feed, but readable and votable by anyone you send the link to — which takes a public jury instead.' },
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
          description: 'The choices/options voters pick between (2-10)',
        },
        caseLength: { type: 'number', minimum: 60, maximum: 2592000, default: 86400, description: 'Voting duration in seconds (min: 1 minute, max: 30 days, default: 1 day)' },
        maxAiJurorPercentage: { type: 'integer', minimum: 0, maximum: 100, description: 'Maximum percentage of jurors that may be AI personas (0 = none allowed, 100 = all; default 50)' },
        jurorCount: { type: 'integer', minimum: 2, maximum: 100, description: 'Number of jurors the case asks for (2-100, default 12). It gates opening only when openImmediately is false, where the case waits until this many jurors have joined. For a small invited panel, set this to the number of people you invite.' },
        openImmediately: { type: 'boolean', description: 'Open the case for voting straight away (default true). Invited jurors are still invited and can view, join and vote while it is already open. Set false to hold the case in jury selection until jurorCount jurors have joined, and only then open it.' },
        allowsGuestVotes: { type: 'boolean', description: 'Let visitors without a Tribeunal account vote on this case (default false). Guest votes count in full — they enter the tallies, percentages and the verdict exactly like a registered juror\'s. Requires a public jury; visibility may be either, and pairing it with visibility "private" makes a link-poll: unlisted everywhere, but votable by whoever holds the link. Guests are deduplicated per browser, so a returning visitor changes their vote rather than adding one, but someone determined can still vote again from another browser — enable it where reach matters more than strict one-person-one-vote.' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Up to 4 tags for categorization' },
      },
      required: ['title', 'description', 'type', 'sides'],
    },
  },
  {
    name: 'tribeunal_search_cases',
    title: 'Search cases',
    annotations: { title: 'Search cases', readOnlyHint: true, openWorldHint: false },
    description: 'Find existing cases on Tribeunal by query, status, type, or tags. Use only when the user wants to look up or reference an existing case — to start a new one, use tribeunal_create_case.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for case title or description' },
        status: { type: 'string', enum: ['init', 'open', 'closed', 'expired', 'suspended'], description: 'Case status filter (open = accepting votes)' },
        type: { type: 'string', enum: ['case', 'advice', 'poll'], description: 'Case type filter' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        page: { type: 'number', minimum: 1, default: 1, description: 'Page number for pagination' },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Number of results per page' },
      },
    },
  },
  {
    name: 'tribeunal_get_case',
    title: 'Get case',
    annotations: { title: 'Get case', readOnlyHint: true, openWorldHint: false },
    description: 'Get detailed information about a specific case. For a private case you own, the response includes a shareUrl: a view-only link (no voting/joining) you can send to anyone; rotate it from the case web page to revoke old links.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID (the case uuid, not the numeric id)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tribeunal_close_case',
    title: 'Close case',
    annotations: { title: 'Close case', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description:
      'Close one of YOUR open cases early (case owner or admin only). Pulls the voting deadline to now and triggers the verdict pipeline; the case must currently be open, and the decision is determined asynchronously. Follow up with tribeunal_await_verdict to read the outcome.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID of the open case to close early (owner or admin only)' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_set_side_image',
    title: 'Set side image',
    annotations: { title: 'Set side image', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    description: 'Set or replace the image shown on a case side\'s vote card, fetched from a public https URL. Owner-only. The image is downloaded and re-encoded server-side (png/jpeg/webp, <= 5 MB); http URLs, private/internal hosts and non-images are rejected. Use the case\'s and side\'s `uuid` fields (from tribeunal_get_case), not numeric ids.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID the side belongs to (the case\'s uuid field)' },
        sideId: { type: 'string', pattern: UUID_PATTERN, description: 'Side UUID to set the image on (the side\'s uuid field)' },
        imageUrl: { type: 'string', format: 'uri', description: 'Public https URL of the image (png/jpeg/webp, <= 5 MB)' },
      },
      required: ['caseId', 'sideId', 'imageUrl'],
    },
  },
  {
    name: 'tribeunal_list_evidence',
    title: 'List evidence',
    annotations: { title: 'List evidence', readOnlyHint: true, openWorldHint: false },
    description: "Get a case's marked evidence — comments and case files the owner/jury marked as evidence (kind: comment|file)",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID to get evidence for' },
      },
      required: ['caseId'],
    },
  },
  // Voting tools
  {
    name: 'tribeunal_cast_vote',
    title: 'Cast vote',
    annotations: { title: 'Cast vote', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Cast a vote on a case for a specific side/option, optionally with a short comment explaining your reasoning (shown in the case activity feed)',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID to vote on' },
        sideId: { type: 'string', pattern: UUID_PATTERN, description: 'Side UUID to vote for (a side uuid from get_case)' },
        comment: { type: 'string', maxLength: 2000, description: 'Optional short rationale, stored as a vote-linked comment (markable as evidence by the owner/jury)' },
      },
      required: ['caseId', 'sideId'],
    },
  },
  {
    name: 'tribeunal_revoke_vote',
    title: 'Revoke vote',
    annotations: { title: 'Revoke vote', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Revoke a previously cast vote (penalties may apply)',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID' },
        sideId: { type: 'string', pattern: UUID_PATTERN, description: "Side UUID whose vote to revoke (the API resolves the caller's vote by user+case)" },
      },
      required: ['caseId', 'sideId'],
    },
  },
  {
    name: 'tribeunal_get_vote_stats',
    title: 'Get vote stats',
    annotations: { title: 'Get vote stats', readOnlyHint: true, openWorldHint: false },
    description: 'Get real-time voting statistics for a case',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID to get voting statistics for' },
      },
      required: ['caseId'],
    },
  },
  // Comment & evidence-mark tools
  {
    name: 'tribeunal_post_comment',
    title: 'Post comment',
    annotations: { title: 'Post comment', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Post a comment on a case — e.g. your analysis or perspective, in your own voice. Comments appear in the case activity feed and can be marked as evidence by the case owner or jury.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID to comment on' },
        text: { type: 'string', minLength: 1, maxLength: 5000, description: 'Comment text (1-5000 chars)' },
      },
      required: ['caseId', 'text'],
    },
  },
  {
    name: 'tribeunal_list_comments',
    title: 'List comments',
    annotations: { title: 'List comments', readOnlyHint: true, openWorldHint: false },
    description: "List a case's comments — use it to avoid posting duplicates and to find comment ids for evidence marking",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID to list comments for' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_mark_evidence',
    title: 'Mark comment as evidence',
    annotations: { title: 'Mark comment as evidence', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "Mark another user's comment or a case file as evidence (case owner or jury members only; you cannot mark your own comment)",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['comment', 'file'], description: "What to mark: 'comment' or 'file' (case file)" },
        id: { type: 'string', description: 'UUID of the comment or case file' },
      },
      required: ['kind', 'id'],
    },
  },
  {
    name: 'tribeunal_unmark_evidence',
    title: 'Unmark evidence',
    annotations: { title: 'Unmark evidence', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Remove an evidence mark from a comment or case file (case owner or jury members only)',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['comment', 'file'], description: "What to unmark: 'comment' or 'file' (case file)" },
        id: { type: 'string', description: 'UUID of the comment or case file' },
      },
      required: ['kind', 'id'],
    },
  },
  {
    name: 'tribeunal_rate_evidence',
    title: 'Rate evidence',
    annotations: { title: 'Rate evidence', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Rate case-file evidence: 1 (up), 0 (irrelevant), or -1 (down). File-evidence ids only — comments are not ratable.',
    inputSchema: {
      type: 'object',
      properties: {
        evidenceId: { type: 'string', description: 'Case-file evidence ID to rate' },
        rating: { type: 'integer', enum: [-1, 0, 1], description: 'Rating: 1 (up), 0 (irrelevant), or -1 (down)' },
        sideId: { type: 'string', pattern: UUID_PATTERN, description: 'Optional side UUID this rating relates to' },
      },
      required: ['evidenceId', 'rating'],
    },
  },
  // Activity feed & agent-await tools
  {
    name: 'tribeunal_get_case_activity',
    title: 'Get case activity',
    annotations: { title: 'Get case activity', readOnlyHint: true, openWorldHint: false },
    description:
      "Read a page of a case's activity feed (votes, comments, evidence marks, jury joins, closure) as a cursorable event stream. Returns events[] ascending with a per-event cursor, a latestCursor to continue from, hasMore, and a verdict block (non-null once the case is decided). Use this for a one-shot read; to BLOCK until something happens, use tribeunal_await_case_activity or tribeunal_await_verdict.",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID whose activity to read' },
        after: { type: 'string', description: 'Opaque cursor from a previous response; omit for the tail (latest events)' },
        types: { type: 'array', items: { type: 'string', enum: ['vote', 'vote_revoked', 'comment', 'evidence_marked', 'evidence_unmarked', 'jury_joined', 'trial_closed'] }, description: 'Restrict to these event types' },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 50, description: 'Max events (1-100, default 50)' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_await_case_activity',
    title: 'Await case activity',
    annotations: { title: 'Await case activity', readOnlyHint: true, openWorldHint: false },
    description:
      "Block until a NEW event appears on a case (long-poll, up to timeoutS seconds). Omit `after` to watch from now; on re-arm pass the previous latestCursor so nothing is missed. Returns {events, latestCursor, timedOut, waitedS, ...}. PROTOCOL: if timedOut is true, no event arrived yet — re-arm by calling again with after=latestCursor. Check caseEndsAt to know when activity is expected and STOP re-arming well past it (tell the human instead of looping forever).",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID to watch' },
        after: { type: 'string', description: 'Cursor to watch from; omit to anchor at the current tail ("watch from now")' },
        types: { type: 'array', items: { type: 'string', enum: ['vote', 'vote_revoked', 'comment', 'evidence_marked', 'evidence_unmarked', 'jury_joined', 'trial_closed'] }, description: 'Only wake for these event types' },
        timeoutS: { type: 'integer', minimum: 5, maximum: 170, default: 120, description: 'Seconds to block (5-170). On timeout, re-arm with the returned latestCursor.' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'tribeunal_await_verdict',
    title: 'Await verdict',
    annotations: { title: 'Await verdict', readOnlyHint: true, openWorldHint: false },
    description:
      "Block until a case reaches its VERDICT (terminal decision), up to timeoutS seconds — returns INSTANTLY if the case is already decided (unlike a cursor-await, which would hang forever after closure). Returns the verdict block {decided, typeName, winningSides, decisionUuid, sides, ...}. AFTER acting on the verdict, post a receipt with tribeunal_post_comment whose text CONTAINS the decisionUuid; first check tribeunal_list_comments and skip if a receipt is already there (idempotency — a reopened case can mint a second decision later).",
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID whose verdict to await' },
        timeoutS: { type: 'integer', minimum: 5, maximum: 170, default: 150, description: 'Seconds to block (5-170); instant if already terminal' },
      },
      required: ['caseId'],
    },
  },
  // Tribe tools
  {
    name: 'tribeunal_list_tribes',
    title: 'List tribes',
    annotations: { title: 'List tribes', readOnlyHint: true, openWorldHint: false },
    description: 'Browse available tribes on Tribeunal. Private tribes appear only to their owner and members.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for tribe name or description' },
        page: { type: 'number', minimum: 1, default: 1, description: 'Page number for pagination' },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Number of results per page' },
      },
    },
  },
  {
    name: 'tribeunal_get_tribe',
    title: 'Get tribe',
    annotations: { title: 'Get tribe', readOnlyHint: true, openWorldHint: false },
    description: 'Get a tribe: name, description, visibility, owner, tags and timestamps. The member roster is NOT included — it was removed because it exposed each member\'s credentials. A private tribe is only readable by its owner, its members and anyone holding a pending invitation; to everyone else it returns 404, the same answer as a tribe that does not exist. For a private tribe you own, the response includes a shareUrl: a view-only link (joining still needs an invite) you can send to anyone; rotate it from the tribe web page to revoke old links.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID (the tribe\'s uuid field, not its slug or numeric id)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tribeunal_join_tribe',
    title: 'Join tribe',
    annotations: { title: 'Join tribe', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Join a tribe. Private tribes are invitation-only: joining one without a pending invitation returns 404, the same answer as a tribe that does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID to join (the tribe\'s uuid field, not its slug or numeric id)' },
      },
      required: ['tribeId'],
    },
  },
  {
    name: 'tribeunal_leave_tribe',
    title: 'Leave tribe',
    annotations: { title: 'Leave tribe', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Leave a tribe you are currently a member of. Leaving a private tribe does not delete the invitation that let you in, so you may rejoin.',
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID to leave (the tribe\'s uuid field, not its slug or numeric id)' },
      },
      required: ['tribeId'],
    },
  },
  {
    name: 'tribeunal_create_tribe',
    title: 'Create tribe',
    annotations: { title: 'Create tribe', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Create a new interest-based tribe. Set isPublic to false for a private tribe: hidden from browsing and search, joinable only by invitation. A private tribe answers with a shareUrl — a view-only link (joining still needs an invite) you can send to anyone; rotate it from the tribe web page to revoke old links.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 3, maxLength: 100, description: 'Tribe name' },
        description: { type: 'string', minLength: 10, description: 'Tribe description' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        isPublic: { type: 'boolean', default: true, description: 'Whether the tribe is publicly visible. False creates a private, invitation-only tribe.' },
      },
      required: ['name', 'description'],
    },
  },
  {
    name: 'tribeunal_invite_tribe_members',
    title: 'Invite tribe members',
    annotations: { title: 'Invite tribe members', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Invite people into a PRIVATE tribe you own (or any, as an admin), by username or email. Each invitee is resolved independently and reported back with its own outcome — invited / already_invited / already_member / not_found / self — so an unresolvable name does not fail the batch. Each invitee may then view and join the tribe. Public tribes are already open to everyone, so inviting into one returns 400.',
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', pattern: UUID_PATTERN, description: 'Tribe UUID to invite people into (the tribe\'s uuid field, not its slug or numeric id) — private tribes only' },
        invitees: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 50,
          description: 'Usernames or email addresses to invite (maximum 50 per call)',
        },
      },
      required: ['tribeId', 'invitees'],
    },
  },
  // User tools
  {
    name: 'tribeunal_get_user',
    title: 'Get user',
    annotations: { title: 'Get user', readOnlyHint: true, openWorldHint: false },
    description: 'Get public profile information for a specific user',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'User ID or username' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tribeunal_get_current_user',
    title: 'Get current user',
    annotations: { title: 'Get current user', readOnlyHint: true, openWorldHint: false },
    description: 'Get profile information for the currently authenticated user',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  // Jury Duty tools
  {
    name: 'tribeunal_jury_duty_status',
    title: 'Jury duty status',
    annotations: { title: 'Jury duty status', readOnlyHint: true, openWorldHint: false },
    description: 'Get current jury duty request status, queue position, and whether user has an active search or assignment',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_jury_duty_allowance',
    title: 'Jury duty allowance',
    annotations: { title: 'Jury duty allowance', readOnlyHint: true, openWorldHint: false },
    description: 'Get daily jury duty allowance info — how many requests used/remaining today, active jury count vs limit, and reset time',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_jury_duty_dashboard',
    title: 'Jury duty dashboard',
    annotations: { title: 'Jury duty dashboard', readOnlyHint: true, openWorldHint: false },
    description: 'Get jury duty dashboard with current case assignments (cases to vote on), allowance info, and active request status. Best tool for finding cases assigned to you.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_jury_duty_start',
    title: 'Start jury duty session',
    annotations: { title: 'Start jury duty session', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Start a jury duty search — join the matchmaking queue to be assigned to a case needing jurors. Consumes 1 daily allowance.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_jury_duty_cancel',
    title: 'Cancel jury duty session',
    annotations: { title: 'Cancel jury duty session', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Cancel an active jury duty search request. Refunds daily allowance if cancelled on the same day.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_jury_duty_accept',
    title: 'Accept jury invitation',
    annotations: { title: 'Accept jury invitation', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Accept a jury duty assignment to serve on a specific case',
    inputSchema: {
      type: 'object',
      properties: {
        memberId: { type: 'string', description: 'Member ID from the jury assignment' },
      },
      required: ['memberId'],
    },
  },
  {
    name: 'tribeunal_jury_duty_reject',
    title: 'Decline jury invitation',
    annotations: { title: 'Decline jury invitation', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Reject a jury duty assignment and return to the queue for a different case',
    inputSchema: {
      type: 'object',
      properties: {
        memberId: { type: 'string', description: 'Member ID from the jury assignment' },
      },
      required: ['memberId'],
    },
  },
  {
    name: 'tribeunal_jury_duty_history',
    title: 'Jury duty history',
    annotations: { title: 'Jury duty history', readOnlyHint: true, openWorldHint: false },
    description: 'Get jury duty allowance usage history for the past N days (default 7, max 30)',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', minimum: 1, maximum: 30, default: 7, description: 'Number of days of history to retrieve' },
      },
    },
  },
  {
    name: 'tribeunal_invite_jurors',
    title: 'Invite jurors',
    annotations: { title: 'Invite jurors', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description:
      'Invite users to the jury of a case you own (owner or admin only). Works on any case regardless of jury type — an invitation is recruitment, not restriction: on a public-jury case it notifies the invitee and its accept link seats them as a normal juror, and it never restricts the open participation a public case already grants everyone. Accepts usernames or email addresses; each invitee is processed independently — the response reports invited / duplicate / not_found per entry.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', pattern: UUID_PATTERN, description: 'Case UUID (owner or admin only)' },
        invitees: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 50,
                    description: 'Usernames or email addresses to invite (1-50)' },
      },
      required: ['caseId', 'invitees'],
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
        // A private case must run an invited jury, so an omitted juryType is coerced here
        // BEFORE zod's .default('public') would force a rejecting public/private conflict.
        // A private case that allows anonymous voting is the exception — it is a link-poll
        // and needs the public jury its link holders vote on, so leave that one alone.
        if (params.visibility === 'private' && params.juryType === undefined) {
          params.juryType = params.allowsGuestVotes === true ? 'public' : 'invited';
        }
        const p = CreateCaseSchema.parse(params);
        // UUID-only outward contract: drop the numeric `id` so the agent reuses
        // the `uuid` on follow-up calls (a numeric id would 500 backend-side).
        const createdCase = caseWithUuidOnly(await apiClient.createCase(p));
        const url = createdCase.url || `https://tribeunal.test/cases/${createdCase.slug}`;
        // A private case answers with a shareUrl: a view-only link that opens the case
        // for whoever holds it, where the bare url would 404 a logged-out visitor. Share
        // that instead of the plain url; a public case has none, so fall back to url.
        const shareUrl = createdCase.shareUrl || url;
        return {
          content: [
            {
              type: 'text',
              text: `Case created successfully!

UUID: ${createdCase.uuid}
URL: ${url}

You can view and share the case at: ${shareUrl}

Full response:
${JSON.stringify(createdCase, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_search_cases': {
        const p = SearchCasesSchema.parse(params);
        const results = caseWithUuidOnly(await apiClient.searchCases(p));
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'tribeunal_get_case': {
        const p = GetCaseSchema.parse(params);
        const found = caseWithUuidOnly(await apiClient.getCase(p.id));
        return { content: [{ type: 'text', text: JSON.stringify(found, null, 2) }] };
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

      case 'tribeunal_set_side_image': {
        const p = SetSideImageSchema.parse(params);
        // Confirm the side belongs to the named case so the caller gets a clear message
        // instead of a bare 404 when they mix up ids.
        const parentCase = await apiClient.getCase(p.caseId);
        const sides = Array.isArray((parentCase as any)?.sides) ? (parentCase as any).sides : [];
        const match = sides.find((s: any) => s?.uuid === p.sideId);
        if (!match) {
          return { content: [{ type: 'text', text: `Side ${p.sideId} is not part of case ${p.caseId}. Use tribeunal_get_case to find the correct side uuid.` }] };
        }
        const updated = caseWithUuidOnly(await apiClient.setSideImage(p.sideId, p.imageUrl));
        return { content: [{ type: 'text', text: `Side image set successfully.\n\n${JSON.stringify(updated, null, 2)}` }] };
      }

      case 'tribeunal_list_evidence': {
        const p = ListEvidenceSchema.parse(params);
        const evidence = await apiClient.getCaseEvidence(p.caseId);
        return { content: [{ type: 'text', text: JSON.stringify(evidence, null, 2) }] };
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

      case 'tribeunal_get_vote_stats': {
        const p = GetVoteStatsSchema.parse(params);
        const stats = await apiClient.getVoteStats(p.caseId);
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }

      // Comment & evidence-mark tools
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

      // Activity feed & agent-await tools
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

      case 'tribeunal_await_verdict': {
        const p = AwaitVerdictSchema.parse(params);
        const result = await awaitVerdict(apiClient, p, ctx);
        const headline = verdictHeadline(result);
        const notice = awaitVerdictNotice(result);
        const body = JSON.stringify(result, null, 2);
        const text = [headline, notice, body].filter(Boolean).join('\n\n');
        return { content: [{ type: 'text', text }] };
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
        const p = MarkEvidenceSchema.parse(params);
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

      // Tribe tools
      case 'tribeunal_list_tribes': {
        const p = ListTribesSchema.parse(params);
        const tribes = await apiClient.listTribes(p);
        return { content: [{ type: 'text', text: JSON.stringify(tribes, null, 2) }] };
      }

      case 'tribeunal_get_tribe': {
        const p = GetTribeSchema.parse(params);
        const tribe = await apiClient.getTribe(p.id);
        return { content: [{ type: 'text', text: JSON.stringify(tribe, null, 2) }] };
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

      // User tools
      case 'tribeunal_get_user': {
        const p = GetUserSchema.parse(params);
        const user = await apiClient.getUser(p.id);
        return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
      }

      case 'tribeunal_get_current_user': {
        const user = await apiClient.getCurrentUser();
        return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
      }

      // Jury Duty tools
      case 'tribeunal_jury_duty_status': {
        const status = await apiClient.getJuryDutyStatus();
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      }

      case 'tribeunal_jury_duty_allowance': {
        const allowance = await apiClient.getJuryDutyAllowance();
        return {
          content: [
            {
              type: 'text',
              text: `Jury Duty Allowance:\nDaily: ${allowance.allowance?.used_today ?? '?'}/${allowance.allowance?.daily_max ?? '?'} used (${allowance.allowance?.remaining_today ?? '?'} remaining)\nActive Juries: ${allowance.allowance?.active_jury_duties ?? '?'}/${allowance.allowance?.max_active_jury_duties ?? '?'}\nCan Start: ${allowance.allowance?.can_use ? 'Yes' : 'No'}\nResets: ${allowance.allowance?.reset_time ?? 'midnight'}\n\n${JSON.stringify(allowance, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_jury_duty_dashboard': {
        const dashboard = await apiClient.getJuryDutyDashboard();
        const assignments = dashboard.current_assignments || [];
        const total = dashboard.assignments_total || 0;
        return {
          content: [
            {
              type: 'text',
              text: `Jury Duty Dashboard:\nTotal Assignments: ${total}\nShowing: ${assignments.length} recent assignments\nActive Request: ${dashboard.active_request ? 'Yes (status: ' + dashboard.active_request.status + ')' : 'None'}\n\nAllowance:\n  Daily: ${dashboard.allowance?.used_today ?? '?'}/${dashboard.allowance?.daily_max ?? '?'} (${dashboard.allowance?.remaining_today ?? '?'} remaining)\n  Active Juries: ${dashboard.allowance?.active_jury_duties ?? '?'}/${dashboard.allowance?.max_active_jury_duties ?? '?'}\n\n${JSON.stringify(dashboard, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_jury_duty_start': {
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

      case 'tribeunal_jury_duty_cancel': {
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

      case 'tribeunal_jury_duty_accept': {
        const p = JuryDutyAcceptSchema.parse(params);
        const result = await apiClient.acceptJuryDuty(p.memberId);
        return {
          content: [
            {
              type: 'text',
              text: `Jury duty accepted! You are now serving on this case.\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_jury_duty_reject': {
        const p = JuryDutyRejectSchema.parse(params);
        const result = await apiClient.rejectJuryDuty(p.memberId);
        return {
          content: [
            {
              type: 'text',
              text: `Jury duty rejected. Searching for another case...\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_jury_duty_history': {
        const p = JuryDutyHistorySchema.parse(params);
        const history = await apiClient.getJuryDutyHistory(p.days);
        return { content: [{ type: 'text', text: JSON.stringify(history, null, 2) }] };
      }

      case 'tribeunal_invite_jurors': {
        const p = InviteJurorsSchema.parse(params);
        const result = await apiClient.inviteJurors(p.caseId, p.invitees);
        const s = result.summary ?? {};
        return {
          content: [
            {
              type: 'text',
              text: `Jury invitations processed — invited: ${s.invited ?? '?'}, duplicate: ${s.duplicate ?? '?'}, not found: ${s.not_found ?? '?'}.\n\n${JSON.stringify(result, null, 2)}`,
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
