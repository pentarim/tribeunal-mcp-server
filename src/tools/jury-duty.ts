import { z } from 'zod';
import { caseUuid, tribeUuid } from './uuid.js';

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

// Jury invitations (case owner). Either an explicit invitees list or a tribeId
// (invite the whole tribe — every member plus the chieftain) is required; both may
// be given and are unioned, with the backend deduping. The refine enforces the
// at-least-one rule the endpoint returns `no_invitees` for.
export const InviteJurorsSchema = z.object({
  caseId: caseUuid('Case UUID (you must be the case owner, or an admin)'),
  invitees: z.array(z.string().min(1)).min(1).max(50).optional()
    .describe('Usernames or email addresses to invite to the jury (1-50)'),
  tribeId: tribeUuid('Optional tribe UUID: invite every current member plus the chieftain. You must be a member, the owner, or an admin of that tribe.').optional(),
}).refine((v) => (v.invitees !== undefined && v.invitees.length > 0) || v.tribeId !== undefined, {
  message: 'Provide invitees and/or a tribeId to invite jurors',
});
