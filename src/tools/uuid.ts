import { z } from 'zod';

// Case and side identifiers on Tribeunal are UUIDs. The backend resolves a case
// or side by its `uuid` column, so any non-UUID identifier (a numeric id, a
// slug, a name) is fed straight into a uuid-typed query and blows up as an
// opaque HTTP 500 instead of a clean 404. The MCP tools therefore accept UUIDs
// ONLY: a non-UUID is rejected here, at the tool boundary, with a message that
// tells the model to use the object's `uuid` field. See tools/*.ts and
// core/tools.ts for the call sites.

/** Canonical Tribeunal UUID form — mirrors the backend route requirement. */
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** JSON-Schema `pattern` string mirroring UUID_RE, for the advertised TOOL_DEFINITIONS. */
export const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function uuidMessage(kind: 'case' | 'side' | 'tribe' | 'webhook' | 'evidence' | 'dispute'): string {
  return `Must be a ${kind} UUID (the ${kind}'s "uuid" field, e.g. 8415a252-5e41-4db6-bd5d-ee5b5ad95dd4) — not a numeric id, slug, or name.`;
}

/** A zod string constrained to the UUID form, carrying the given description. */
export function caseUuid(description: string) {
  return z.string().regex(UUID_RE, uuidMessage('case')).describe(description);
}

/**
 * A zod string constrained to the UUID form, for a dispute identifier.
 * `dispute.id` is a uuid-typed column, so a case uuid or any other
 * non-dispute UUID reaches the dispute routes and 404s as `dispute_not_found`
 * rather than telling the model which field to use.
 */
export function disputeUuid(description: string) {
  return z.string().regex(UUID_RE, uuidMessage('dispute')).describe(description);
}

/** A zod string constrained to the UUID form, for a side identifier. */
export function sideUuid(description: string) {
  return z.string().regex(UUID_RE, uuidMessage('side')).describe(description);
}

/**
 * A zod string constrained to the UUID form, for a tribe identifier. `tribe.uuid`
 * is a uuid-typed column, so a slug or the numeric `id` that create_tribe/get_tribe
 * hand back reaches DBAL as a conversion error and returns an opaque HTTP 500.
 */
export function tribeUuid(description: string) {
  return z.string().regex(UUID_RE, uuidMessage('tribe')).describe(description);
}

/**
 * A zod string constrained to the UUID form, for a webhook endpoint identifier.
 * Webhook endpoints are keyed by a uuid primary key and are owner-scoped, so a
 * wrong-shaped id is indistinguishable from someone else's endpoint: both answer
 * 404. Rejecting here says which field to use instead of returning a bare
 * not-found the agent cannot act on.
 */
export function webhookUuid(description: string) {
  return z.string().regex(UUID_RE, uuidMessage('webhook')).describe(description);
}

/**
 * A zod string constrained to the UUID form, for a case-file evidence identifier.
 * `evidence.id` is a uuid-typed column (App\Entity\Evidence), so a non-UUID id
 * reaches Doctrine's `find()` and 500s instead of the documented 404
 * `evidence_not_found`. Used by `tribeunal_rate_evidence`'s `evidenceId`.
 */
export function evidenceUuid(description: string) {
  return z.string().regex(UUID_RE, uuidMessage('evidence')).describe(description);
}

/**
 * A zod string constrained to the UUID form, for the `id` param shared by
 * `tribeunal_mark_evidence` / `tribeunal_unmark_evidence`, which accepts either
 * a comment uuid (kind: 'comment') or a case-file/evidence uuid (kind: 'file').
 * Both backing columns are uuid-typed, so either kind 500s on a non-UUID id
 * without this guard.
 */
export function commentOrFileUuid(description: string) {
  return z
    .string()
    .regex(UUID_RE, 'Must be a UUID (the comment\'s or case file\'s "uuid" field, matching kind) — not a numeric id, slug, or name.')
    .describe(description);
}

/**
 * Present a case object (or a list of them) with the UUID as its ONLY
 * identifier: drops the numeric top-level `id` and each `sides[].id`, keeping
 * `uuid`. This stops an agent reusing the numeric `id` on a later tool call
 * (which would 500 backend-side). Only strips `id` when a sibling `uuid` is
 * present, so an object identified solely by `id` keeps it. Every other field
 * (e.g. `owner.id`, `juryInvites[].id`, which are already UUIDs) is untouched.
 * Non-object input passes through unchanged.
 */
export function caseWithUuidOnly<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => caseWithUuidOnly(item)) as unknown as T;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const obj = { ...(value as Record<string, unknown>) };
  if ('uuid' in obj && 'id' in obj) {
    delete obj.id;
  }
  if (Array.isArray(obj.sides)) {
    obj.sides = obj.sides.map((side) => {
      if (side && typeof side === 'object' && 'uuid' in side && 'id' in side) {
        const copy = { ...(side as Record<string, unknown>) };
        delete copy.id;
        return copy;
      }
      return side;
    });
  }
  return obj as unknown as T;
}
