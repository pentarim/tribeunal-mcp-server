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
      };
    },
  } as unknown as TribeunalAPIClient;
}

const baseArgs = {
  title: 'A matter to decide right away',
  description: 'Context long enough to pass validation.',
  type: 'case' as const,
  sides: [{ name: 'Yes' }, { name: 'No' }],
};

test('openImmediately true is forwarded verbatim to createCase', async () => {
  const record: { data?: Record<string, unknown> } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_create_case', {
    ...baseArgs,
    openImmediately: true,
  });

  assert.equal(record.data?.openImmediately, true);
});

test('openImmediately false is forwarded verbatim to createCase', async () => {
  const record: { data?: Record<string, unknown> } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_create_case', {
    ...baseArgs,
    juryType: 'invited',
    openImmediately: false,
  });

  assert.equal(record.data?.openImmediately, false);
});

test('omitting openImmediately sends no field, so the backend default (true) applies', async () => {
  const record: { data?: Record<string, unknown> } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_create_case', { ...baseArgs });

  assert.ok(record.data !== undefined);
  assert.equal('openImmediately' in (record.data as Record<string, unknown>), false);
});

test('CreateCaseSchema rejects a non-boolean openImmediately', () => {
  assert.throws(() => CreateCaseSchema.parse({
    ...baseArgs,
    openImmediately: 'yes',
  }));
});
