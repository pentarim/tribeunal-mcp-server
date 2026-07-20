import { z } from 'zod';
import { caseUuid } from './uuid.js';

// Case schemas — the single, canonical vocabulary advertised by the server.
// Case identifiers are UUIDs only (see ./uuid.ts): a numeric id or slug is
// rejected here rather than 500-ing backend-side.

export const SearchCasesSchema = z.object({
  query: z.string().optional().describe('Search cases by title or description'),
  status: z.enum(['init', 'open', 'closed', 'expired', 'suspended']).optional().describe('Filter by case status (open = accepting votes)'),
  type: z.enum(['case', 'advice', 'poll']).optional().describe('Filter by case type — case (binding jury decision), advice (input for the creator), poll (opinion gathering)'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  page: z.number().min(1).default(1).describe('Page number for pagination'),
  limit: z.number().min(1).max(100).default(20).describe('Number of cases to return per page'),
});

export const GetCaseSchema = z.object({
  id: caseUuid('Case UUID (the case\'s `uuid` field)'),
});

export const CreateCaseSchema = z.object({
  title: z.string().min(3).max(200).describe('Case title — the question or statement to be decided'),
  description: z.string().min(10).describe('Context, background, and criteria for the case'),
  type: z.enum(['case', 'advice', 'poll']).describe('Case type — case (binding jury decision), advice (input for the creator), or poll (opinion gathering)'),
  juryType: z.enum(['public', 'invited']).default('public').describe('Who can participate — public (anyone) or invited only'),
  visibility: z.enum(['public', 'private']).default('public').describe('Case visibility — public (anyone can find and read it) or private (only you, your invited jurors and admins). A private case must use an invited jury; omit juryType and it is set to invited automatically. One exception: set allowsGuestVotes on a private case and it becomes a link-poll — still absent from every listing, search and feed, but readable and votable by anyone you send the link to — which takes a public jury instead.'),
  sides: z.array(z.object({
    name: z.string().describe('Option/choice name'),
    description: z.string().optional().describe('Optional description for this choice'),
  })).min(2).max(10).describe('The choices/options voters pick between (2-10)'),
  caseLength: z.number().min(60).max(2592000).default(86400).describe('Voting duration in seconds (min: 1 minute, max: 30 days, default: 1 day)'),
  maxAiJurorPercentage: z.number().int().min(0).max(100).optional().describe('Maximum percentage of jurors that may be AI personas (0 = none allowed, 100 = all; default 50)'),
  jurorCount: z.number().int().min(2).max(100).optional().describe('Number of jurors the case asks for (2-100, default 12). It gates opening only when openImmediately is false, where the case waits until this many jurors have joined. For a small invited panel, set this to the number of people you invite.'),
  openImmediately: z.boolean().optional().describe('Open the case for voting straight away (default true). Invited jurors are still invited and can view, join and vote while it is already open. Set false to hold the case in jury selection until jurorCount jurors have joined, and only then open it.'),
  allowsGuestVotes: z.boolean().optional().describe('Let visitors without a Tribeunal account vote on this case (default false). Guest votes count in full — they enter the tallies, percentages and the verdict exactly like a registered juror\'s. Requires a public jury; visibility may be either, and pairing it with visibility "private" makes a link-poll: unlisted everywhere, but votable by whoever holds the link. Guests are deduplicated per browser, so a returning visitor changes their vote rather than adding one, but someone determined can still vote again from another browser — enable it where reach matters more than strict one-person-one-vote.'),
  tags: z.array(z.string()).max(4).optional().describe('Up to 4 tags for categorization'),
}).superRefine((data, ctx) => {
  // A private case is normally visible only to its owner, invited jurors and admins, so
  // it must run an invited jury. The exception is the link-poll: a private case that
  // allows anonymous voting is deliberately open to whoever holds its link, and that
  // audience needs a public jury to vote at all. The handler pre-coerces an omitted
  // juryType, so reaching here with a mismatch means the caller asked for it explicitly.
  const isLinkPoll = data.visibility === 'private'
    && data.allowsGuestVotes === true
    && data.juryType === 'public';

  if (data.visibility === 'private' && data.juryType !== 'invited' && !isLinkPoll) {
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
  if (data.allowsGuestVotes === true && data.juryType !== 'public') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allowsGuestVotes'],
      message: 'Anonymous voting requires a public jury.',
    });
  }
});

export const ListEvidenceSchema = z.object({
  caseId: caseUuid('Case UUID to get evidence for'),
});

export const CloseCaseSchema = z.object({
  caseId: caseUuid('Case UUID of the open case to close early (you must be the case owner, or an admin)'),
});
