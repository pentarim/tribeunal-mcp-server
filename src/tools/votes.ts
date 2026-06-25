import { z } from 'zod';

// Decision-focused schema definitions
export const ChooseOptionSchema = z.object({
  decisionId: z.string().describe('Decision ID to express your choice in'),
  optionId: z.string().describe('Option/choice ID you are selecting as your preference'),
  reasoning: z.string().optional().describe('Optional explanation for why you chose this option'),
});

// Alias for backward compatibility
export const CastVoteSchema = z.object({
  trialId: z.string().describe('Trial ID to vote on'),
  sideId: z.string().describe('Side/option ID to vote for'),
});

export const ChangeChoiceSchema = z.object({
  decisionId: z.string().describe('Decision ID where you want to change your choice'),
  choiceId: z.string().describe('Your current choice ID to revoke/change'),
});

// Alias for backward compatibility
export const RevokeVoteSchema = z.object({
  trialId: z.string().describe('Trial ID'),
  sideId: z.string().describe('Side UUID whose vote to revoke (the API resolves the caller\'s vote by user+trial)'),
});

export const CheckConsensusSchema = z.object({
  decisionId: z.string().describe('Decision ID to check current consensus, participation levels, and progress toward resolution'),
});

// Alias for backward compatibility
export const GetVoteStatsSchema = z.object({
  trialId: z.string().describe('Trial ID to get voting statistics for'),
});

export const ProvideSupportingInfoSchema = z.object({
  decisionId: z.string().describe('Decision ID to provide supporting information for'),
  content: z.string().describe('Supporting information, data, arguments, or evidence content'),
  infoType: z.enum(['text', 'link', 'image']).default('text').describe('Type of supporting information - text analysis, external link, or visual evidence'),
  supportsOption: z.string().optional().describe('Optional: which specific option this information supports'),
});

// Alias for backward compatibility
export const SubmitEvidenceSchema = z.object({
  trialId: z.string().describe('Trial ID to submit evidence for'),
  content: z.string().describe('Evidence content'),
  type: z.enum(['text', 'link', 'image']).default('text').describe('Type of evidence'),
  sideId: z.string().optional().describe('Optional side ID to support with this evidence'),
});

export const EvaluateInfoQualitySchema = z.object({
  infoId: z.string().describe('Supporting information ID to evaluate for quality and relevance'),
  qualityScore: z.number().min(1).max(5).describe('Quality rating from 1 (poor/irrelevant) to 5 (excellent/highly relevant)'),
});

// Alias for backward compatibility
export const RateEvidenceSchema = z.object({
  evidenceId: z.string().describe('Evidence ID to rate'),
  rating: z.number().int().min(-1).max(1).describe('Rating: 1 (up), 0 (irrelevant), or -1 (down)'),
  sideId: z.string().optional().describe('Optional side UUID this rating relates to'),
});