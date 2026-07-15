import { z } from 'zod';
import { caseUuid, sideUuid } from './uuid.js';

// Voting & evidence schemas (case vocabulary). Case and side identifiers are
// UUIDs only (see ./uuid.ts) — the backend resolves both by `uuid`.

export const CastVoteSchema = z.object({
  caseId: caseUuid('Case UUID to vote on'),
  sideId: sideUuid('Side UUID to vote for (a side\'s `uuid` from get_case)'),
  comment: z.string().max(2000).optional().describe('Optional short rationale, stored as a vote-linked comment (shown in the case activity feed; markable as evidence by the owner/jury)'),
});

export const RevokeVoteSchema = z.object({
  caseId: caseUuid('Case UUID'),
  sideId: sideUuid("Side UUID whose vote to revoke (the API resolves the caller's vote by user+case)"),
});

export const GetVoteStatsSchema = z.object({
  caseId: caseUuid('Case UUID to get voting statistics for'),
});

export const RateEvidenceSchema = z.object({
  evidenceId: z.string().describe('Case-file evidence ID to rate (file evidence only; comments are not ratable)'),
  rating: z.number().int().min(-1).max(1).describe('Rating: 1 (up), 0 (irrelevant), or -1 (down)'),
  sideId: sideUuid('Optional side UUID this rating relates to').optional(),
});
