import { z } from 'zod';

// High-level decision workflow schemas
export const QuickYesNoSchema = z.object({
  question: z.string().min(10).describe('Clear yes/no question for quick community input'),
  context: z.string().optional().describe('Background context to help decision makers understand the situation'),
  urgency: z.enum(['low', 'medium', 'high', 'critical']).default('medium').describe('Urgency level affecting timeline and notifications'),
  stakeholders: z.array(z.string()).optional().describe('Specific people to notify about this decision (emails or usernames)'),
  categories: z.array(z.string()).optional().describe('Categories for organization'),
});

export const CompareOptionsSchema = z.object({
  decision: z.string().min(10).describe('What decision needs to be made'),
  options: z.array(z.object({
    name: z.string().describe('Option name'),
    description: z.string().describe('Detailed description of this option'),
    pros: z.array(z.string()).optional().describe('Advantages of this option'),
    cons: z.array(z.string()).optional().describe('Disadvantages of this option'),
  })).min(2).max(5).describe('Options to compare (2-5 options recommended for clear comparison)'),
  criteria: z.array(z.string()).optional().describe('Evaluation criteria for comparing options (e.g., cost, time, risk)'),
  timeframe: z.number().default(172800).describe('Decision timeframe in seconds (default: 2 days for thorough comparison)'),
  stakeholders: z.array(z.string()).optional().describe('Key stakeholders to involve in comparison'),
});

export const SeekExpertOpinionSchema = z.object({
  topic: z.string().describe('Topic or domain requiring expert input'),
  question: z.string().describe('Specific question for experts to address'),
  context: z.string().describe('Background information and why expert opinion is needed'),
  expertiseAreas: z.array(z.string()).describe('Required areas of expertise or knowledge'),
  urgency: z.enum(['low', 'medium', 'high']).default('medium').describe('How quickly expert input is needed'),
});

export const PollStakeholdersSchema = z.object({
  topic: z.string().describe('Topic or issue to poll stakeholders about'),
  question: z.string().describe('Specific question or decision point'),
  stakeholderGroups: z.array(z.string()).describe('Specific groups or individuals to poll (emails, usernames, or group names)'),
  options: z.array(z.object({
    name: z.string().describe('Option name'),
    description: z.string().optional().describe('Option details'),
  })).min(2).describe('Available response options'),
  anonymous: z.boolean().default(false).describe('Whether responses should be anonymous'),
  deadline: z.number().default(259200).describe('Response deadline in seconds (default: 3 days)'),
});

export const ConsensusBuilderSchema = z.object({
  initiative: z.string().describe('Initiative or change requiring consensus'),
  description: z.string().describe('Detailed description of what consensus is needed for'),
  stakeholderGroups: z.array(z.string()).describe('Groups that need to agree'),
  consensusThreshold: z.enum(['simple_majority', 'qualified_majority', 'unanimous']).default('qualified_majority').describe('Level of agreement required'),
  phases: z.array(z.object({
    name: z.string().describe('Phase name'),
    description: z.string().describe('What happens in this phase'),
    duration: z.number().describe('Phase duration in seconds'),
  })).optional().describe('Optional: break consensus building into phases'),
});

// Decision analysis schemas
export const AnalyzeReadinessSchema = z.object({
  decisionId: z.string().describe('Decision ID to analyze for readiness'),
  criteria: z.array(z.string()).optional().describe('Specific readiness criteria to check'),
});

export const PredictOutcomeSchema = z.object({
  decisionId: z.string().describe('Decision ID to predict likely outcome based on current data'),
  includeConfidence: z.boolean().default(true).describe('Include confidence level in prediction'),
});

export const IdentifyBiasSchema = z.object({
  decisionId: z.string().describe('Decision ID to analyze for potential bias in evidence or participation'),
  biasTypes: z.array(z.enum(['selection', 'confirmation', 'availability', 'anchoring', 'participation'])).optional().describe('Specific bias types to check for'),
});

export const FindSimilarDecisionsSchema = z.object({
  topic: z.string().describe('Topic or keywords to find similar past decisions'),
  decisionType: z.enum(['case', 'advice', 'poll']).optional().describe('Filter by decision type'),
  timeframe: z.enum(['week', 'month', 'quarter', 'year', 'all']).default('year').describe('How far back to search'),
  includeOutcomes: z.boolean().default(true).describe('Include decision outcomes and effectiveness'),
});

export const CalculateConfidenceSchema = z.object({
  decisionId: z.string().describe('Decision ID to calculate confidence score for'),
  factors: z.array(z.enum(['participation_rate', 'evidence_quality', 'expert_involvement', 'consensus_level', 'time_adequacy'])).optional().describe('Specific confidence factors to evaluate'),
});

// Workflow automation schemas
export const ScheduleReminderSchema = z.object({
  decisionId: z.string().describe('Decision ID to set reminders for'),
  reminderType: z.enum(['deadline_approaching', 'low_participation', 'consensus_reached', 'custom']).describe('Type of reminder to schedule'),
  timing: z.number().describe('When to send reminder (seconds before deadline or absolute timestamp)'),
  recipients: z.array(z.string()).optional().describe('Specific recipients for reminder (if not all stakeholders)'),
  message: z.string().optional().describe('Custom reminder message'),
});

export const EscalateDeadlockSchema = z.object({
  decisionId: z.string().describe('Stalled decision ID to escalate'),
  reason: z.string().describe('Why escalation is needed (deadlock, low participation, etc.)'),
  escalationType: z.enum(['expert_review', 'extended_timeline', 'stakeholder_expansion', 'mediation']).describe('Type of escalation to apply'),
  newStakeholders: z.array(z.string()).optional().describe('Additional stakeholders to involve in escalation'),
});

export const ImplementOutcomeSchema = z.object({
  decisionId: z.string().describe('Completed decision ID to implement'),
  actionItems: z.array(z.object({
    task: z.string().describe('Specific action to take'),
    assignee: z.string().optional().describe('Who is responsible'),
    deadline: z.number().optional().describe('Completion deadline timestamp'),
  })).describe('Action items to implement the decision'),
  trackingMethod: z.enum(['manual', 'automated', 'milestone']).default('manual').describe('How to track implementation progress'),
});

export const TrackImplementationSchema = z.object({
  decisionId: z.string().describe('Decision ID to track implementation for'),
  includeProgress: z.boolean().default(true).describe('Include progress details and completion status'),
  includeBlockers: z.boolean().default(true).describe('Include any implementation blockers or issues'),
});