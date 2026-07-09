import { z } from 'zod';

// Case schemas — the single, canonical vocabulary advertised by the server.

export const SearchCasesSchema = z.object({
  query: z.string().optional().describe('Search cases by title or description'),
  status: z.enum(['init', 'open', 'closed', 'expired', 'suspended']).optional().describe('Filter by case status (open = accepting votes)'),
  type: z.enum(['case', 'advice', 'poll']).optional().describe('Filter by case type — case (binding jury decision), advice (input for the creator), poll (opinion gathering)'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  page: z.number().min(1).default(1).describe('Page number for pagination'),
  limit: z.number().min(1).max(100).default(20).describe('Number of cases to return per page'),
});

export const GetCaseSchema = z.object({
  id: z.string().describe('Case ID or UUID'),
});

export const CreateCaseSchema = z.object({
  title: z.string().min(3).max(200).describe('Case title — the question or statement to be decided'),
  description: z.string().min(10).describe('Context, background, and criteria for the case'),
  type: z.enum(['case', 'advice', 'poll']).describe('Case type — case (binding jury decision), advice (input for the creator), or poll (opinion gathering)'),
  juryType: z.enum(['public', 'invited']).default('public').describe('Who can participate — public (anyone) or invited only'),
  sides: z.array(z.object({
    name: z.string().describe('Option/choice name'),
    description: z.string().optional().describe('Optional description for this choice'),
  })).min(2).max(10).describe('The choices/options voters pick between (2-10)'),
  caseLength: z.number().min(60).max(2592000).default(86400).describe('Voting duration in seconds (min: 1 minute, max: 30 days, default: 1 day)'),
  maxAiJurorPercentage: z.number().int().min(0).max(100).optional().describe('Maximum percentage of jurors that may be AI personas (0 = none allowed, 100 = all; default 50)'),
  tags: z.array(z.string()).max(4).optional().describe('Up to 4 tags for categorization'),
});

export const ListEvidenceSchema = z.object({
  caseId: z.string().describe('Case ID to get evidence for'),
});
