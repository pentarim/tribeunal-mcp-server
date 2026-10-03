import { z } from 'zod';
import { caseUuid } from './uuid.js';

// Case schemas — the single, canonical vocabulary advertised by the server.
// Case identifiers are UUIDs only (see ./uuid.ts): a numeric id or slug is
// rejected here rather than 500-ing backend-side.

export const SearchCasesSchema = z.object({
  query: z.string().optional().describe('Matches case title or description, case-insensitive substring.'),
  status: z.enum(['init', 'jury_selection', 'open', 'closed', 'expired', 'suspended']).optional().describe('Exact state filter; "open" also includes jury_selection (a case still assembling its jury); "closed" is the closed state alone.'),
  type: z.enum(['case', 'advice', 'poll']).optional().describe('case, advice or poll.'),
  tags: z.array(z.string()).optional().describe('Case must carry at least one of these tag names.'),
  page: z.number().min(1).default(1).describe('1-based page number; defaults to 1.'),
  limit: z.number().min(1).max(100).default(20).describe('Results per page; defaults to 20, hard-capped at 100.'),
});

export const GetCaseSchema = z.object({
  id: caseUuid('The case\'s uuid field (from tribeunal_search_cases, tribeunal_create_case, or a case URL) — not its numeric id.'),
});

/**
 * Cases are private by default. The one place that turns an omitted visibility / juryType
 * into a concrete pair — the same rule the backend applies in App\Service\TrialDefaults:
 *   - visibility omitted → private, unless the caller asked for a public jury ("public
 *     jury" has always meant a public case, anonymous voting or not).
 *   - juryType omitted   → follows the visibility: invited on a private case, public on a
 *     public case or a link-poll (private + allowsGuestVotes).
 * Explicit values pass through untouched, so a conflict still reaches the schema's check.
 */
export function withCaseDefaults<T extends { visibility?: unknown; juryType?: unknown; allowsGuestVotes?: unknown }>(params: T): T {
  const wantsGuests = params.allowsGuestVotes === true;
  const visibility = params.visibility === undefined
    ? (params.juryType === 'public' ? 'public' : 'private')
    : params.visibility;
  const juryType = params.juryType === undefined
    ? (visibility === 'private' && !wantsGuests ? 'invited' : 'public')
    : params.juryType;
  return { ...params, visibility, juryType };
}

export const CreateCaseSchema = z.object({
  title: z.string().min(3).max(200).describe('The question or statement to be decided (3-200 characters).'),
  description: z.string().min(10).describe('Context, background and decision criteria (at least 10 characters).'),
  type: z.enum(['case', 'advice', 'poll']).describe('case (a jury decision), advice (input for the creator) or poll (opinion gathering) — changes only how the result reads, not the voting mechanics.'),
  juryType: z.enum(['public', 'invited']).optional().describe('public (anyone) or invited (named jurors only). Omitted, it follows visibility: invited on a private case, public on a public case or a link-poll.'),
  visibility: z.enum(['public', 'private']).optional().describe('private (default: only you, invited jurors and admins) or public (anyone can find and read it). Pairing private with allowsGuestVotes makes a link-poll instead.'),
  sides: z.array(z.object({
    name: z.string().describe('Option/choice name'),
    description: z.string().optional().describe('Optional description for this choice'),
    image: z.string().url().refine((u) => u.startsWith('https://'), { message: 'Side image URL must use https.' }).optional().describe('Optional https image URL for this choice — fetched and re-encoded server-side (png/jpeg/webp, <= 5 MB). Shown on the choice\'s vote card.'),
  })).min(2).max(10).describe('2-10 choices voters pick between; each needs a name and may carry a description and an https image URL, fetched and re-encoded server-side (png/jpeg/webp, <=5 MB) for its vote card.'),
  caseLength: z.number().min(60).max(2592000).default(86400).describe('Voting duration in seconds, 60 to 2,592,000 (30 days); defaults to 86400 (1 day).'),
  maxAiJurorPercentage: z.number().int().min(0).max(100).optional().describe('0-100; caps the share of jurors the platform may auto-seat as AI personas. Defaults to 50; set 0 for an all-human panel.'),
  jurorCount: z.number().int().min(2).max(100).optional().describe('2-100 jurors requested; defaults to 12. Only gates opening when openImmediately is false, holding the case in jury_selection until this many have joined.'),
  openImmediately: z.boolean().optional().describe('Defaults to true: opens for voting right away, with invited jurors free to join/vote while already open. Set false to wait in jury_selection until jurorCount jurors join.'),
  allowsGuestVotes: z.boolean().optional().describe('Defaults to false. Lets visitors with no account vote, full-weight and deduplicated per browser via a signed cookie. Requires a public jury — pairing it with a private case makes a link-poll.'),
  arbitrationMode: z.boolean().optional().describe('Bind this case to arbitration rules, for a verdict someone outside the case has to rely on (default false). You cannot vote on, join the jury of, or close early a case you created in this mode — an admin closes it, or it closes at its deadline; evidence marks freeze once it closes so the record it was decided on stops moving; and the early-vote and decisive-vote reward multipliers are switched off, so timing your vote no longer multiplies your payout. Requires minVotes of at least 2 (omit it and 3 is used) and cannot be combined with allowsGuestVotes. Use it when the case settles something with stakes — a dispute, a payout, a contract term — rather than gathering opinion.'),
  decisionRequirement: z.enum(['any', 'simple', 'qualified', 'unanimous']).optional().describe('The weakest outcome this case will accept as a verdict (default "any"). "any" takes whatever the tally gives, down to a plurality. "simple" needs at least half, "qualified" at least 66%, "unanimous" every vote on one side. A case that reaches a stronger result than required still reports the stronger one. On any value other than "any", missing the requirement closes the case with a Void verdict carrying voidReason "requirement_not_met"; an "any" case that merely ties stays Undecided.'),
  minVotes: z.number().int().min(0).max(100).optional().describe('Fewest votes this case needs before it can reach a verdict (0-100, default 0 = no minimum). Close it with fewer and it ends with a Void verdict carrying voidReason "quorum_not_met" rather than deciding on a turnout of one or two.'),
  tags: z.array(z.string()).max(4).optional().describe('Up to 4 category tags.'),
}).superRefine((data, ctx) => {
  // A private case is normally visible only to its owner, invited jurors and admins, so
  // it must run an invited jury. The exception is the link-poll: a private case that
  // allows anonymous voting is deliberately open to whoever holds its link, and that
  // audience needs a public jury to vote at all. withCaseDefaults fills an omitted pair
  // (the handler applies it too), so a mismatch here means the caller asked for it explicitly.
  const { visibility, juryType } = withCaseDefaults(data);
  const isLinkPoll = visibility === 'private'
    && data.allowsGuestVotes === true
    && juryType === 'public';

  if (visibility === 'private' && juryType !== 'invited' && !isLinkPoll) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['juryType'],
      message: 'A private case must use an invited jury (set juryType to "invited"), unless it allows anonymous voting — set allowsGuestVotes to make it a link-poll with a public jury.',
    });
  }

  // Anonymous voting needs a jury anyone can join; a guest holds no seat on an invited
  // panel. Visibility is deliberately not part of this rule. Caught here so the caller
  // gets a named parameter and a reason instead of a bare 400 from the backend, which
  // enforces the same rule in an entity constraint and a DB CHECK.
  if (data.allowsGuestVotes === true && juryType !== 'public') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allowsGuestVotes'],
      message: 'Anonymous voting requires a public jury.',
    });
  }

  // A verdict an outside party is meant to rely on cannot rest on voters nobody can hold
  // to account, nor on a turnout of one. Caught here so the caller gets a named parameter
  // and a reason instead of a bare 400 from the backend, which enforces the same two rules
  // in an entity constraint and a DB CHECK.
  if (data.arbitrationMode === true) {
    if (data.allowsGuestVotes === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowsGuestVotes'],
        message: 'An arbitration case cannot allow anonymous voting — its voters must be accountable.',
      });
    }

    if (data.minVotes !== undefined && data.minVotes < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minVotes'],
        message: 'An arbitration case requires a quorum of at least 2 votes; omit minVotes to use 3.',
      });
    }
  }
});

export const ListEvidenceSchema = z.object({
  caseId: caseUuid('Case UUID (the uuid field from tribeunal_get_case or tribeunal_search_cases — not a numeric id or slug).'),
});

export const CloseCaseSchema = z.object({
  caseId: caseUuid('Case UUID of the open or jury_selection case to close early (owner or admin only), from tribeunal_get_case.'),
});

export const UpdateCaseSchema = z.object({
  caseId: caseUuid("The case's uuid field, from tribeunal_get_case or tribeunal_search_cases."),
  title: z.string().min(3).max(200).optional()
    .describe('New title, 3-200 characters (matching tribeunal_create_case). Refused with 409 title_locked if it differs from the current title and any vote has ever been cast on the case.'),
  description: z.string().min(0).max(10000).optional()
    .describe('New description, 0-10000 characters. At least one of title or description must be given.'),
}).refine((v) => v.title !== undefined || v.description !== undefined, {
  message: 'Provide title and/or description to update the case',
});

export const DeleteCaseSchema = z.object({
  caseId: caseUuid("The case's uuid field, from tribeunal_get_case or tribeunal_search_cases."),
});
