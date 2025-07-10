import { z } from 'zod';

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
  isPublic: z.boolean().default(true).describe('Whether the tribe is publicly visible'),
  membershipFee: z.number().min(0).default(0).describe('Token fee required to join (0 for free)'),
});