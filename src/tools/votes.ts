import { z } from 'zod';

// Voting & evidence schemas (case vocabulary).

export const CastVoteSchema = z.object({
  caseId: z.string().describe('Case ID to vote on'),
  sideId: z.string().describe('Side/option ID to vote for'),
  comment: z.string().max(2000).optional().describe('Optional short rationale, stored as a vote-linked comment (shown in the case activity feed; markable as evidence by the owner/jury)'),
});

export const RevokeVoteSchema = z.object({
  caseId: z.string().describe('Case ID'),
  sideId: z.string().describe("Side UUID whose vote to revoke (the API resolves the caller's vote by user+case)"),
});

export const GetVoteStatsSchema = z.object({
  caseId: z.string().describe('Case ID to get voting statistics for'),
});

export const RateEvidenceSchema = z.object({
  evidenceId: z.string().describe('Case-file evidence ID to rate (file evidence only; comments are not ratable)'),
  rating: z.number().int().min(-1).max(1).describe('Rating: 1 (up), 0 (irrelevant), or -1 (down)'),
  sideId: z.string().optional().describe('Optional side UUID this rating relates to'),
});
