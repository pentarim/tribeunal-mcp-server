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
  visibility: z.enum(['public', 'private']).default('public').describe('Case visibility — public (anyone can find and read it) or private (only you, your invited jurors and admins). A private case must use an invited jury; omit juryType and it is set to invited automatically.'),
  sides: z.array(z.object({
    name: z.string().describe('Option/choice name'),
    description: z.string().optional().describe('Optional description for this choice'),
  })).min(2).max(10).describe('The choices/options voters pick between (2-10)'),
  caseLength: z.number().min(60).max(2592000).default(86400).describe('Voting duration in seconds (min: 1 minute, max: 30 days, default: 1 day)'),
  maxAiJurorPercentage: z.number().int().min(0).max(100).optional().describe('Maximum percentage of jurors that may be AI personas (0 = none allowed, 100 = all; default 50)'),
  tags: z.array(z.string()).max(4).optional().describe('Up to 4 tags for categorization'),
}).superRefine((data, ctx) => {
  // A private case is only visible to its owner, invited jurors and admins, so it must
  // run an invited jury. The handler pre-coerces an omitted juryType to 'invited', so
  // reaching here with private + public means the caller explicitly asked for both.
  if (data.visibility === 'private' && data.juryType !== 'invited') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['juryType'],
      message: 'A private case must use an invited jury (set juryType to "invited").',
    });
  }
});

export const ListEvidenceSchema = z.object({
  caseId: caseUuid('Case UUID to get evidence for'),
});

export const CloseCaseSchema = z.object({
  caseId: caseUuid('Case UUID of the open case to close early (you must be the case owner, or an admin)'),
});
