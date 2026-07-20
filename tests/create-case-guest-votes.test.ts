import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall } from '../src/core/tools.js';
import { CreateCaseSchema } from '../src/tools/cases.js';
import { TOOL_DEFINITIONS } from '../src/core/tools.js';
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
        allowsGuestVotes: data.allowsGuestVotes,
      };
    },
  } as unknown as TribeunalAPIClient;
}

const baseArgs = {
  title: 'Should we let anyone vote on this',
  description: 'Context long enough to pass validation.',
  type: 'case' as const,
  sides: [{ name: 'Yes' }, { name: 'No' }],
};

test('allowsGuestVotes is forwarded verbatim to createCase', async () => {
  const record: { data?: Record<string, unknown> } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_create_case', {
    ...baseArgs,
    allowsGuestVotes: true,
  });

  assert.equal(record.data?.allowsGuestVotes, true);
});

test('omitting allowsGuestVotes leaves it out of the body entirely', async () => {
  const record: { data?: Record<string, unknown> } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_create_case', { ...baseArgs });

  // Absent, not false: the backend owns the default, and sending an explicit false
  // would make this client the source of truth for a policy it does not own.
  assert.ok(record.data !== undefined);
  assert.equal('allowsGuestVotes' in record.data!, false);
});

test('allowsGuestVotes false is forwarded when explicitly requested', async () => {
  const record: { data?: Record<string, unknown> } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_create_case', {
    ...baseArgs,
    allowsGuestVotes: false,
  });

  assert.equal(record.data?.allowsGuestVotes, false);
});

test('CreateCaseSchema rejects a non-boolean allowsGuestVotes', () => {
  assert.throws(() => CreateCaseSchema.parse({
    ...baseArgs,
    allowsGuestVotes: 'yes',
  }));
});

test('a non-boolean allowsGuestVotes never reaches the client', async () => {
  const record: { data?: Record<string, unknown> } = {};
  await assert.rejects(
    () => dispatchToolCall(fakeClient(record), 'tribeunal_create_case', {
      ...baseArgs,
      allowsGuestVotes: 'yes',
    }),
    /Invalid parameters/,
  );
  assert.equal(record.data, undefined);
});

test('allowsGuestVotes is rejected on an invited jury, whatever the visibility', () => {
  // A guest holds no seat on a closed panel. This is the half of the old rule that
  // survives — the public-visibility half is gone, since a private case may opt in.
  for (const visibility of ['public', 'private']) {
    assert.throws(
      () => CreateCaseSchema.parse({ ...baseArgs, visibility, juryType: 'invited', allowsGuestVotes: true }),
      undefined,
      `${visibility} + invited jury must still refuse anonymous voting`,
    );
  }
});

test('the hand-written tool definition advertises allowsGuestVotes as a boolean', () => {
  // The zod schema and TOOL_DEFINITIONS are maintained separately, so a param added to
  // one and forgotten in the other is invisible to callers reading the tool list.
  const createCase = TOOL_DEFINITIONS.find((t) => t.name === 'tribeunal_create_case');
  const property = (createCase?.inputSchema as { properties?: Record<string, { type?: string }> })
    ?.properties?.allowsGuestVotes;

  assert.ok(property, 'allowsGuestVotes must appear in TOOL_DEFINITIONS');
  assert.equal(property?.type, 'boolean');
});
