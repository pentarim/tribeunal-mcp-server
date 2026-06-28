import { z } from 'zod';

// Voting & evidence schemas (case vocabulary).

export const CastVoteSchema = z.object({
  caseId: z.string().describe('Case ID to vote on'),
  sideId: z.string().describe('Side/option ID to vote for'),
});

export const RevokeVoteSchema = z.object({
  caseId: z.string().describe('Case ID'),
  sideId: z.string().describe("Side UUID whose vote to revoke (the API resolves the caller's vote by user+case)"),
});

export const GetVoteStatsSchema = z.object({
  caseId: z.string().describe('Case ID to get voting statistics for'),
});

export const SubmitEvidenceSchema = z.object({
  caseId: z.string().describe('Case ID to submit evidence for'),
  content: z.string().describe('Evidence content'),
  type: z.enum(['text', 'link', 'image']).default('text').describe('Type of evidence'),
  sideId: z.string().optional().describe('Optional side ID to support with this evidence'),
});

export const RateEvidenceSchema = z.object({
  evidenceId: z.string().describe('Evidence ID to rate'),
  rating: z.number().int().min(-1).max(1).describe('Rating: 1 (up), 0 (irrelevant), or -1 (down)'),
  sideId: z.string().optional().describe('Optional side UUID this rating relates to'),
});
