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

function uuidMessage(kind: 'case' | 'side' | 'tribe'): string {
  return `Must be a ${kind} UUID (the ${kind}'s "uuid" field, e.g. 8415a252-5e41-4db6-bd5d-ee5b5ad95dd4) — not a numeric id, slug, or name.`;
}

/** A zod string constrained to the UUID form, carrying the given description. */
export function caseUuid(description: string) {
  return z.string().regex(UUID_RE, uuidMessage('case')).describe(description);
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
