import { z } from 'zod';
import { caseUuid, commentOrFileUuid } from './uuid.js';

// Comment & evidence-mark schemas. Evidence is no longer submitted directly:
// users post comments, and the case owner / jury members MARK a comment or a
// case file as evidence. Case identifiers are UUIDs only (see ./uuid.ts).

export const PostCommentSchema = z.object({
  caseId: caseUuid('Case UUID to comment on (the case\'s uuid field, from tribeunal_get_case or tribeunal_search_cases).'),
  text: z.string().min(1).max(5000).describe('Comment text, 1–5000 characters.'),
});

export const ListCommentsSchema = z.object({
  caseId: caseUuid('Case UUID whose comments to list (the case\'s uuid field).'),
});

export const MarkEvidenceSchema = z.object({
  kind: z.enum(['comment', 'file']).describe("'comment' to mark a posted comment (ids from tribeunal_list_comments), or 'file' to mark an uploaded case file (case files are attached when a case is created on the website; no tool uploads one)."),
  id: commentOrFileUuid('UUID of the comment or case file to mark, matching kind.'),
});

// Same shape as MarkEvidenceSchema (mark and unmark take the same params) but
// with its own descriptions: tribeunal_unmark_evidence's tool description
// deliberately differs from mark's (it names tribeunal_list_evidence and
// tribeunal_mark_evidence, not tribeunal_list_comments alone), so the two
// tools need separate zod schemas to keep their JSON Schema and zod
// descriptions identical per param.
export const UnmarkEvidenceSchema = z.object({
  kind: z.enum(['comment', 'file']).describe("'comment' for a posted comment (ids from tribeunal_list_comments) or 'file' for a case file (ids from tribeunal_list_evidence, kind: file)."),
  id: commentOrFileUuid('UUID of the comment or case file to unmark, matching kind — the same uuid tribeunal_list_evidence returns for that item.'),
});

export const UpdateCommentSchema = z.object({
  commentId: z.string().uuid().describe("Comment UUID, from tribeunal_list_comments' uuid field."),
  text: z.string().min(1).max(5000).describe('New comment text, 1–5000 characters, replacing the old text entirely.'),
});

export const DeleteCommentSchema = z.object({
  commentId: z.string().uuid().describe("Comment UUID, from tribeunal_list_comments' uuid field."),
});
