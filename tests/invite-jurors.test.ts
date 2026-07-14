import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall } from '../src/core/tools.js';
import { InviteJurorsSchema } from '../src/tools/jury-duty.js';
import type { TribeunalAPIClient } from '../src/client/api-client.js';

/** Fake client that records the inviteJurors args and returns a canned backend body. */
function fakeClient(record: { caseId?: string; invitees?: string[] }, result: unknown): TribeunalAPIClient {
  return {
    inviteJurors: async (caseId: string, invitees: string[]) => {
      record.caseId = caseId;
      record.invitees = invitees;
      return result;
    },
  } as unknown as TribeunalAPIClient;
}

test('tribeunal_invite_jurors dispatches to inviteJurors and returns a text result', async () => {
  const record: { caseId?: string; invitees?: string[] } = {};
  const client = fakeClient(record, {
    status: 'success',
    case: { uuid: 'abc', state: 'init', juryType: 'invited' },
    results: [
      { contact: 'bob', outcome: 'invited', username: 'bob', isExternalEmail: false },
      { contact: 'alice', outcome: 'invited', username: 'alice', isExternalEmail: false },
      { contact: 'carol', outcome: 'duplicate', username: 'carol', isExternalEmail: false },
      { contact: 'nobody@example.com', outcome: 'not_found', username: null, isExternalEmail: true },
    ],
    summary: { invited: 2, duplicate: 1, not_found: 1 },
  });

  const r = await dispatchToolCall(client, 'tribeunal_invite_jurors', {
    caseId: 'abc',
    invitees: ['bob', 'alice', 'carol', 'nobody@example.com'],
  });

  assert.equal(record.caseId, 'abc');
  assert.deepEqual(record.invitees, ['bob', 'alice', 'carol', 'nobody@example.com']);
  assert.ok(Array.isArray(r.content) && r.content[0]?.type === 'text');
  assert.match(r.content[0].text, /invited: 2/);
  assert.match(r.content[0].text, /duplicate: 1/);
  assert.match(r.content[0].text, /not found: 1/);
});

test('tribeunal_invite_jurors rejects a missing caseId with a validation error', async () => {
  const client = fakeClient({}, { status: 'success' });
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_invite_jurors', { invitees: ['bob'] }),
    /Invalid parameters/,
  );
});

test('tribeunal_invite_jurors rejects an empty invitees array with a validation error', async () => {
  const client = fakeClient({}, { status: 'success' });
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_invite_jurors', { caseId: 'abc', invitees: [] }),
    /Invalid parameters/,
  );
});

test('InviteJurorsSchema requires caseId and a non-empty invitees array', () => {
  assert.throws(() => InviteJurorsSchema.parse({}));
  assert.throws(() => InviteJurorsSchema.parse({ caseId: 'x', invitees: [] }));
  assert.throws(() => InviteJurorsSchema.parse({ caseId: 'x', invitees: [''] }));
  assert.throws(() => InviteJurorsSchema.parse({ caseId: 'x', invitees: Array.from({ length: 51 }, (_, i) => `u${i}`) }));
  assert.deepEqual(InviteJurorsSchema.parse({ caseId: 'x', invitees: ['bob'] }), { caseId: 'x', invitees: ['bob'] });
});
