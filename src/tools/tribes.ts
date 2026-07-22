import { z } from 'zod';

import { tribeUuid } from './uuid.js';

// Schema definitions
export const ListTribesSchema = z.object({
  query: z.string().optional().describe('Search query for tribe name or description'),
  page: z.number().min(1).default(1).describe('Page number for pagination'),
  limit: z.number().min(1).max(100).default(20).describe('Number of results per page'),
});

export const GetTribeSchema = z.object({
  id: z.string().describe('Tribe ID or slug'),
});

export const JoinTribeSchema = z.object({
  tribeId: z.string().describe('Tribe ID to join'),
});

export const LeaveTribeSchema = z.object({
  tribeId: z.string().describe('Tribe ID to leave'),
});

export const CreateTribeSchema = z.object({
  name: z.string().min(3).max(100).describe('Tribe name'),
  description: z.string().min(10).describe('Tribe description'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  isPublic: z
    .boolean()
    .default(true)
    .describe('Whether the tribe is publicly visible. Private tribes are hidden from browsing and search, and can only be joined by invitation.'),
});

// Parameters for the tribeunal_invite_tribe_members tool.
export const InviteTribeMembersSchema = z.object({
  tribeId: tribeUuid('Tribe UUID to invite people into — private tribes only'),
  invitees: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .describe('Usernames or email addresses to invite (maximum 50 per call)'),
});
