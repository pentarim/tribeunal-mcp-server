import { z } from 'zod';

// Decision-focused schema definitions
export const FindActiveDecisionsSchema = z.object({
  query: z.string().optional().describe('Search for decisions by topic, title, or description'),
  status: z.enum(['init', 'open', 'closed', 'expired', 'suspended']).optional().describe('Decision status - open for active decisions requiring input'),
  decisionType: z.enum(['case', 'advice', 'poll']).optional().describe('Decision type - case (binding jury decision), advice (input for final decider), poll (opinion gathering)'),
  tags: z.array(z.string()).optional().describe('Filter by decision categories or topics'),
  page: z.number().min(1).default(1).describe('Page number for pagination'),
  limit: z.number().min(1).max(100).default(20).describe('Number of decisions to return per page'),
});

// Alias for backward compatibility
export const SearchTrialsSchema = FindActiveDecisionsSchema;

export const GetDecisionStatusSchema = z.object({
  id: z.string().describe('Decision ID or UUID to check status, progress, and current results'),
});

// Alias for backward compatibility
export const GetTrialSchema = GetDecisionStatusSchema;

export const StartDecisionProcessSchema = z.object({
  title: z.string().min(3).max(200).describe('Clear decision question or statement'),
  description: z.string().min(10).describe('Context, background, and criteria for making this decision'),
  decisionType: z.enum(['case', 'advice', 'poll']).describe('Decision binding level - case (binding community decision), advice (input for final decider), poll (opinion gathering)'),
  participationType: z.enum(['public', 'invited']).default('public').describe('Who can participate - open to everyone or specific invitees only'),
  options: z.array(z.object({
    name: z.string().describe('Option or choice name'),
    description: z.string().optional().describe('Details about this option and its implications'),
  })).min(2).max(10).describe('Available options/choices for decision makers to select from'),
  timeframe: z.number().min(60).max(2592000).default(86400).describe('Decision deadline in seconds (min: 1 minute, max: 30 days, default: 1 day)'),
  consensusRequired: z.enum(['any_majority', 'simple_majority', 'qualified_majority', 'unanimous']).default('simple_majority').describe('Consensus threshold needed to finalize the decision'),
  categories: z.array(z.string()).optional().describe('Decision categories for organization and findability'),
  stakeholders: z.array(z.string()).optional().describe('Specific people to invite for stakeholder input (emails or usernames)'),
  template: z.enum(['business_choice', 'technical_decision', 'policy_vote', 'priority_ranking', 'emergency_decision', 'custom']).default('custom').describe('Pre-configured decision template with relevant prompts and options'),
});

// Alias for backward compatibility
export const CreateTrialSchema = z.object({
  title: z.string().min(3).max(200).describe('Trial title'),
  description: z.string().min(10).describe('Detailed description of the trial'),
  type: z.enum(['case', 'advice', 'poll']).describe('Type of trial - case (jury decides), advice (creator decides), or poll'),
  juryType: z.enum(['public', 'invited']).default('public').describe('Who can participate - public or invited only'),
  sides: z.array(z.object({
    name: z.string().describe('Option/choice name'),
    description: z.string().optional().describe('Optional description for this choice'),
  })).min(2).max(10).describe('Available choices/options for voting'),
  trialLength: z.number().min(60).max(2592000).default(86400).describe('Duration in seconds (min: 1 minute, max: 30 days, default: 1 day)'),
  decisionRequirement: z.enum(['any_majority', 'simple_majority', 'qualified_majority', 'unanimous']).default('simple_majority').describe('Voting threshold required for decision'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  invitedUsers: z.array(z.string()).optional().describe('Usernames or emails to invite (for invited jury type)'),
});

export const GatherEvidenceSchema = z.object({
  decisionId: z.string().describe('Decision ID to gather all supporting evidence, arguments, and data for'),
});

// Alias for backward compatibility
export const ListEvidenceSchema = z.object({
  trialId: z.string().describe('Trial ID to get evidence for'),
});