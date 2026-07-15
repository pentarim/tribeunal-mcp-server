import { z } from 'zod';
import { caseUuid } from './uuid.js';

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

// Jury invitations (case owner)
export const InviteJurorsSchema = z.object({
  caseId: caseUuid('Case UUID (you must be the case owner, or an admin)'),
  invitees: z.array(z.string().min(1)).min(1).max(50)
    .describe('Usernames or email addresses to invite to the jury (1-50)'),
});
