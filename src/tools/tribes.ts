import { z } from 'zod';

import { tribeUuid } from './uuid.js';

// Schema definitions
export const ListTribesSchema = z.object({
  query: z.string().optional().describe('Search query for tribe name or description'),
  page: z.number().min(1).default(1).describe('Page number for pagination'),
  limit: z.number().min(1).max(100).default(20).describe('Number of results per page'),
});

// Every tribe identifier is a UUID: the backend resolves tribes by their uuid
// column only, so a slug or the numeric `id` can never match and simply 404s.
// Rejecting here says WHICH field to use instead of returning a bare not-found.
export const GetTribeSchema = z.object({
  id: tribeUuid('Tribe UUID (the tribe\'s uuid field, not its slug or numeric id)'),
});

// Parameters for the tribeunal_list_tribe_members tool. The roster is member-only,
// so tribeId is a UUID just like every other tribe identifier; page/limit mirror the
// backend's clamp ([1,100]).
export const ListTribeMembersSchema = z.object({
  tribeId: tribeUuid('Tribe UUID whose member roster to read (you must be a member, the owner, or an admin)'),
  page: z.number().min(1).default(1).describe('Page number for pagination'),
  limit: z.number().min(1).max(100).default(20).describe('Number of members per page'),
});

export const JoinTribeSchema = z.object({
  tribeId: tribeUuid('Tribe UUID to join'),
});

export const LeaveTribeSchema = z.object({
  tribeId: tribeUuid('Tribe UUID to leave'),
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
