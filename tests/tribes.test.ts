import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall, TOOL_DEFINITIONS } from '../src/core/tools.js';
import { CreateTribeSchema, InviteTribeMembersSchema } from '../src/tools/tribes.js';
import type { TribeunalAPIClient } from '../src/client/api-client.js';

/** Fake client recording whatever the dispatcher hands the API layer. */
function fakeClient(record: {
  createData?: Record<string, unknown>;
  inviteArgs?: { tribeId: string; invitees: string[] };
  joinError?: Error;
}): TribeunalAPIClient {
  return {
    createTribe: async (data: Record<string, unknown>) => {
      record.createData = data;
      return { uuid: 'new-tribe-uuid', slug: 'new-tribe', name: data.name, type: data.isPublic === false ? 2 : 1 };
    },
    inviteTribeMembers: async (tribeId: string, invitees: string[]) => {
      record.inviteArgs = { tribeId, invitees };
      return {
        status: 'success',
        results: invitees.map((c) => ({ contact: c, outcome: 'invited' })),
        summary: { invited: invitees.length, already_invited: 0, already_member: 0, not_found: 0, self: 0 },
      };
    },
    joinTribe: async () => {
      if (record.joinError) throw record.joinError;
      return { tribe: 'x', member: true, role: 1 };
    },
  } as unknown as TribeunalAPIClient;
}

const baseTribe = {
  name: 'Deep Sea Welders',
  description: 'A community for people who weld, underwater.',
};

// --- isPublic round-trip -----------------------------------------------------

test('isPublic:false is forwarded to createTribe', async () => {
  const record: Record<string, never> = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_create_tribe', {
    ...baseTribe,
    isPublic: false,
  });

  assert.equal(
    (record as { createData?: Record<string, unknown> }).createData?.isPublic,
    false,
    'expected isPublic to reach the API client — the dispatcher used to drop it silently',
  );
});

test('isPublic defaults to true when omitted', async () => {
  const record: Record<string, never> = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_create_tribe', { ...baseTribe });

  assert.equal(
    (record as { createData?: Record<string, unknown> }).createData?.isPublic,
    true,
    'expected isPublic to default to a public tribe',
  );
});

test('create_tribe no longer advertises or accepts a membership fee', () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === 'tribeunal_create_tribe');
  assert.ok(def, 'create_tribe must still be advertised');
  const props = (def as { inputSchema: { properties: Record<string, unknown> } }).inputSchema.properties;
  assert.equal(props.membershipFee, undefined, 'membershipFee was never implemented anywhere');
  assert.equal(JSON.stringify(def).includes('requires tokens'), false);

  const parsed = CreateTribeSchema.parse({ ...baseTribe, membershipFee: 10 } as never);
  assert.equal((parsed as Record<string, unknown>).membershipFee, undefined);
});

// --- the invite tool ---------------------------------------------------------

test('invite_tribe_members forwards tribeId and invitees', async () => {
  const record: Record<string, never> = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_invite_tribe_members', {
    tribeId: 'tribe-uuid',
    invitees: ['alice', 'bob@example.com'],
  });

  const args = (record as { inviteArgs?: { tribeId: string; invitees: string[] } }).inviteArgs;
  assert.equal(args?.tribeId, 'tribe-uuid');
  assert.deepEqual(args?.invitees, ['alice', 'bob@example.com']);
});

test('invite_tribe_members is advertised with the spec parameter names', () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === 'tribeunal_invite_tribe_members');
  assert.ok(def, 'the invite tool must be advertised to clients');
  const schema = (def as { inputSchema: { properties: Record<string, unknown>; required: string[] } }).inputSchema;
  assert.ok(schema.properties.tribeId);
  assert.ok(schema.properties.invitees);
  assert.deepEqual(schema.required, ['tribeId', 'invitees']);
});

test('the batch cap matches the API (50)', () => {
  const invitees = Array.from({ length: 51 }, (_, i) => `cap${i}@example.invalid`);
  assert.throws(() => InviteTribeMembersSchema.parse({ tribeId: 't', invitees }));
  assert.doesNotThrow(() => InviteTribeMembersSchema.parse({ tribeId: 't', invitees: invitees.slice(0, 50) }));
});

test('an empty invitee list is rejected before any request', async () => {
  const record: Record<string, never> = {};
  await assert.rejects(
    () => dispatchToolCall(fakeClient(record), 'tribeunal_invite_tribe_members', { tribeId: 't', invitees: [] }),
    /Invalid parameters/,
  );
  assert.equal((record as { inviteArgs?: unknown }).inviteArgs, undefined);
});

// --- join surfacing ----------------------------------------------------------

test('a 404 from joining a private tribe surfaces to the caller', async () => {
  const record: { joinError?: Error } = { joinError: new Error('Tribe not found (404)') };
  await assert.rejects(
    () => dispatchToolCall(fakeClient(record as Record<string, never>), 'tribeunal_join_tribe', { tribeId: 'hidden' }),
    /not found/i,
  );
});

test('join_tribe documents the invitation-only rule rather than a token fee', () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === 'tribeunal_join_tribe');
  const description = (def as { description: string }).description;
  assert.match(description, /invitation/i);
  assert.equal(/membership fee|require tokens/i.test(description), false);
});
