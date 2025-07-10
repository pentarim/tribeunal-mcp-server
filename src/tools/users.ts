import { z } from 'zod';

// Schema definitions
export const GetUserSchema = z.object({
  id: z.string().describe('User ID or username'),
});