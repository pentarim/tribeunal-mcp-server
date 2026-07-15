import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall } from '../src/core/tools.js';
import { CloseCaseSchema } from '../src/tools/cases.js';
import type { TribeunalAPIClient } from '../src/client/api-client.js';

const CASE_UUID = '8415a252-5e41-4db6-bd5d-ee5b5ad95dd4';

/** Fake client that records the closeCase arg and returns a canned backend body. */
function fakeClient(record: { caseId?: string }, result: unknown): TribeunalAPIClient {
  return {
    closeCase: async (caseId: string) => {
      record.caseId = caseId;
      return result;
    },
  } as unknown as TribeunalAPIClient;
}

test('tribeunal_close_case dispatches to closeCase and returns a text result', async () => {
  const record: { caseId?: string } = {};
  const client = fakeClient(record, {
    status: 'success',
    trial: { uuid: 'abc', state: 'decision_pending' },
    message: 'Case closed — the verdict is being determined',
  });

  const r = await dispatchToolCall(client, 'tribeunal_close_case', { caseId: CASE_UUID });

  assert.equal(record.caseId, CASE_UUID);
  assert.ok(Array.isArray(r.content) && r.content[0]?.type === 'text');
  assert.match(r.content[0].text, /verdict is being determined/);
});

test('tribeunal_close_case rejects a non-UUID caseId with a validation error', async () => {
  const client = fakeClient({}, { status: 'success' });
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_close_case', { caseId: '878' }),
    /Invalid parameters/,
  );
});

test('tribeunal_close_case rejects a missing caseId with a validation error', async () => {
  const client = fakeClient({}, { status: 'success' });
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_close_case', {}),
    /Invalid parameters/,
  );
});

test('CloseCaseSchema requires a caseId UUID', () => {
  assert.throws(() => CloseCaseSchema.parse({}));
  assert.throws(() => CloseCaseSchema.parse({ caseId: 'x' }));
  assert.throws(() => CloseCaseSchema.parse({ caseId: '878' }));
  assert.deepEqual(CloseCaseSchema.parse({ caseId: CASE_UUID }), { caseId: CASE_UUID });
});
