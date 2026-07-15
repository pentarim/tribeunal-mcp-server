import { z } from 'zod';
import { caseUuid } from './uuid.js';

// Comment & evidence-mark schemas. Evidence is no longer submitted directly:
// users post comments, and the case owner / jury members MARK a comment or a
// case file as evidence. Case identifiers are UUIDs only (see ./uuid.ts).

export const PostCommentSchema = z.object({
  caseId: caseUuid('Case UUID to comment on'),
  text: z.string().min(1).max(5000).describe('Comment text (1-5000 chars) — e.g. your analysis of the case, in your own voice'),
});

export const ListCommentsSchema = z.object({
  caseId: caseUuid('Case UUID to list comments for'),
});

export const MarkEvidenceSchema = z.object({
  kind: z.enum(['comment', 'file']).describe("What to (un)mark: 'comment' (a case comment) or 'file' (a case file)"),
  id: z.string().describe('UUID of the comment or case file'),
});
