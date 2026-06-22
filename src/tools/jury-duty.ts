import { z } from 'zod';

// Jury Duty Status & Allowance
export const JuryDutyStatusSchema = z.object({});
export const JuryDutyAllowanceSchema = z.object({});
export const JuryDutyDashboardSchema = z.object({});

// Jury Duty Queue Management
export const JuryDutyStartSchema = z.object({});
export const JuryDutyCancelSchema = z.object({});

// Jury Duty Assignment Management
export const JuryDutyAcceptSchema = z.object({
  memberId: z.string().describe('Member ID from the jury assignment notification'),
});

export const JuryDutyRejectSchema = z.object({
  memberId: z.string().describe('Member ID from the jury assignment notification'),
});

// Jury Duty History
export const JuryDutyHistorySchema = z.object({
  days: z.number().min(1).max(30).default(7)
    .describe('Number of days of allowance history to retrieve'),
});
