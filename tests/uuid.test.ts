import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isUuid, caseWithUuidOnly } from '../src/tools/uuid.js';
import { dispatchToolCall } from '../src/core/tools.js';
import type { TribeunalAPIClient } from '../src/client/api-client.js';

const CASE_UUID = '8415a252-5e41-4db6-bd5d-ee5b5ad95dd4';

test('isUuid accepts canonical UUIDs and rejects ids/slugs/names', () => {
  assert.equal(isUuid(CASE_UUID), true);
  assert.equal(isUuid('1f1800c7-bbbc-6948-87d1-05d5ce19da45'), true); // v6-style
  assert.equal(isUuid('878'), false);
  assert.equal(isUuid('Ship-The-Redesign'), false);
  assert.equal(isUuid(878), false);
  assert.equal(isUuid(undefined), false);
});

test('caseWithUuidOnly drops the numeric top-level id and side ids, keeps uuid', () => {
  const out = caseWithUuidOnly({
    id: '878',
    uuid: CASE_UUID,
    title: 'x',
    owner: { id: '1f008d76-2402-670a-98d0-c185963810d9', username: 'pententon' },
    sides: [
      { id: '1771', uuid: 'side-uuid-1', name: 'A' },
      { id: '1772', uuid: 'side-uuid-2', name: 'B' },
    ],
  });

  assert.equal('id' in out, false);
  assert.equal(out.uuid, CASE_UUID);
  // owner.id is itself a UUID identifier and must be preserved.
  assert.equal((out.owner as { id: string }).id, '1f008d76-2402-670a-98d0-c185963810d9');
  for (const s of out.sides as Array<Record<string, unknown>>) {
    assert.equal('id' in s, false);
    assert.ok(typeof s.uuid === 'string');
  }
});

test('caseWithUuidOnly maps over a list (search results) and passes non-objects through', () => {
  const list = caseWithUuidOnly([{ id: '1', uuid: 'u1' }, { id: '2', uuid: 'u2' }]);
  assert.deepEqual(list, [{ uuid: 'u1' }, { uuid: 'u2' }]);
  assert.equal(caseWithUuidOnly('plain'), 'plain');
  // Keeps id when there is no sibling uuid (don't strip the only identifier).
  assert.deepEqual(caseWithUuidOnly({ id: '9' }), { id: '9' });
});

test('tribeunal_get_case output exposes uuid and omits the numeric id', async () => {
  const client = {
    getCase: async () => ({
      id: '878',
      uuid: CASE_UUID,
      title: 'Ship vs Hold',
      sides: [{ id: '1771', uuid: 'side-uuid-1', name: 'Ship' }],
    }),
  } as unknown as TribeunalAPIClient;

  const r = await dispatchToolCall(client, 'tribeunal_get_case', { id: CASE_UUID });
  const text = Array.isArray(r.content) && r.content[0]?.type === 'text' ? r.content[0].text : '';
  const parsed = JSON.parse(text);

  assert.equal(parsed.uuid, CASE_UUID);
  assert.equal('id' in parsed, false);
  assert.equal('id' in parsed.sides[0], false);
  assert.equal(parsed.sides[0].uuid, 'side-uuid-1');
});
