import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall } from '../src/core/tools.js';
import { CreateCaseSchema } from '../src/tools/cases.js';
import type { TribeunalAPIClient } from '../src/client/api-client.js';

/** Fake client that records the createCase arg and returns a canned created case. */
function fakeClient(record: { data?: Record<string, unknown> }): TribeunalAPIClient {
  return {
    createCase: async (data: Record<string, unknown>) => {
      record.data = data;
      return {
        uuid: 'new-uuid',
        slug: 'new-slug',
        url: 'https://tribeunal.test/cases/new-slug',
        visibility: data.visibility,
        juryType: data.juryType,
      };
    },
  } as unknown as TribeunalAPIClient;
}

const baseArgs = {
  title: 'A private matter to decide',
  description: 'Context long enough to pass validation.',
  type: 'case' as const,
  sides: [{ name: 'Yes' }, { name: 'No' }],
};

test('visibility is forwarded verbatim to createCase', async () => {
  const record: { data?: Record<string, unknown> } = {};
  const r = await dispatchToolCall(fakeClient(record), 'tribeunal_create_case', {
    ...baseArgs,
    visibility: 'private',
    juryType: 'invited',
  });

  assert.equal(record.data?.visibility, 'private');
  assert.ok(Array.isArray(r.content) && r.content[0]?.type === 'text');
});

test('private without a juryType coerces juryType to invited', async () => {
  const record: { data?: Record<string, unknown> } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_create_case', {
    ...baseArgs,
    visibility: 'private',
  });

  assert.equal(record.data?.visibility, 'private');
  assert.equal(record.data?.juryType, 'invited');
});

test('explicit private + public jury is rejected before reaching the client', async () => {
  const record: { data?: Record<string, unknown> } = {};
  await assert.rejects(
    () => dispatchToolCall(fakeClient(record), 'tribeunal_create_case', {
      ...baseArgs,
      visibility: 'private',
      juryType: 'public',
    }),
    /Invalid parameters/,
  );
  assert.equal(record.data, undefined);
});

test('omitting visibility defaults the body to public', async () => {
  const record: { data?: Record<string, unknown> } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_create_case', { ...baseArgs });

  assert.equal(record.data?.visibility, 'public');
  assert.equal(record.data?.juryType, 'public');
});

test('CreateCaseSchema rejects private + public directly', () => {
  assert.throws(() => CreateCaseSchema.parse({
    title: 'A private matter to decide',
    description: 'Context long enough to pass validation.',
    type: 'case',
    visibility: 'private',
    juryType: 'public',
    sides: [{ name: 'Yes' }, { name: 'No' }],
  }));
});
