import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall, TOOL_DEFINITIONS } from '../src/core/tools.js';
import { GetUserSchema } from '../src/tools/users.js';
import { type TribeunalAPIClient } from '../src/client/api-client.js';

function fakeClient(record: { getUserArg?: string; currentUserCalled?: boolean } = {}): TribeunalAPIClient {
  return {
    getUser: async (id: string) => {
      record.getUserArg = id;
      return { id: 'target-uuid', username: id, created_at: '2026-01-01T00:00:00+00:00', profile_url: '/u/target', is_ai: false };
    },
    getCurrentUser: async () => {
      record.currentUserCalled = true;
      return { id: 'me-uuid', username: 'testuser', created_at: '2026-01-01T00:00:00+00:00', profile_url: '/u/testuser', is_ai: false };
    },
  } as unknown as TribeunalAPIClient;
}

// --- composition: no id -> getCurrentUser; id -> getUser ------------------------

test('get_user with no userId dispatches to getCurrentUser', async () => {
  const record: { getUserArg?: string; currentUserCalled?: boolean } = {};
  const result = await dispatchToolCall(fakeClient(record), 'tribeunal_get_user', {});

  assert.equal(record.currentUserCalled, true);
  assert.equal(record.getUserArg, undefined, 'getUser must not be called when userId is omitted');
  const parsed = JSON.parse(result.content[0].text as string);
  assert.equal(parsed.username, 'testuser');
});

test('get_user with a UUID userId dispatches to getUser', async () => {
  const record: { getUserArg?: string; currentUserCalled?: boolean } = {};
  const id = '8415a252-5e41-4db6-bd5d-ee5b5ad95dd4';
  await dispatchToolCall(fakeClient(record), 'tribeunal_get_user', { userId: id });

  assert.equal(record.getUserArg, id);
  assert.equal(record.currentUserCalled, undefined);
});

test('get_user with a username userId also dispatches to getUser (no UUID pattern is enforced)', async () => {
  const record: { getUserArg?: string; currentUserCalled?: boolean } = {};
  const result = await dispatchToolCall(fakeClient(record), 'tribeunal_get_user', { userId: 'alice' });

  assert.equal(record.getUserArg, 'alice');
  const parsed = JSON.parse(result.content[0].text as string);
  assert.equal(parsed.username, 'alice');
});

// --- zod ---------------------------------------------------------------------

test('GetUserSchema accepts omission and a bare username, and rejects an empty string', () => {
  assert.deepEqual(GetUserSchema.parse({}), {});
  assert.equal(GetUserSchema.parse({ userId: 'alice' }).userId, 'alice');
  assert.throws(() => GetUserSchema.parse({ userId: '' }));
});

test('get_user does not advertise a UUID pattern on userId', () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === 'tribeunal_get_user');
  assert.ok(def);
  const prop = (def!.inputSchema as { properties: Record<string, { pattern?: string }> }).properties.userId;
  assert.equal(prop?.pattern, undefined, 'userId accepts a username too, so it must not carry a UUID pattern');
});

// --- catalog wiring -----------------------------------------------------------

test('get_user is advertised as read-only and idempotent, with userId optional', () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === 'tribeunal_get_user');
  assert.ok(def);
  const a = def!.annotations as { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  assert.equal(a.readOnlyHint, true);
  assert.equal(a.destructiveHint, false);
  assert.equal(a.idempotentHint, true);

  const schema = def!.inputSchema as { required?: readonly string[] };
  assert.deepEqual([...(schema.required ?? [])], [], 'userId must be optional');
});

test('get_user description explains it is also the current-user tool', () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === 'tribeunal_get_user');
  assert.match(def!.description, /own account|your own/i);
});

test('get_user description documents the display_name key and its AI-vs-human rule', () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === 'tribeunal_get_user');
  assert.match(def!.description, /display_name/);
  assert.match(def!.description, /persona/i, 'must say display_name is the AI persona name, not the raw username');
});
