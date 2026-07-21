import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall } from '../src/core/tools.js';
import { SetSideImageSchema } from '../src/tools/sides.js';
import { CreateCaseSchema } from '../src/tools/cases.js';
import { TribeunalAPIClient } from '../src/client/api-client.js';
import type { TribeunalAPIClient as TribeunalAPIClientType } from '../src/client/api-client.js';

const CASE_UUID = '8415a252-5e41-4db6-bd5d-ee5b5ad95dd4';
const SIDE_UUID = '1b9d3c2a-4e5f-4a1b-9c3d-2e5f4a1b9c3d';
const OTHER_SIDE_UUID = '2c8e4d3b-5f6a-4b2c-8d4e-3f6a4b2c8d4e';
const IMAGE_URL = 'https://example.com/side.png';

/** Fake client that records getCase/setSideImage calls and returns canned bodies. */
function fakeClient(
  record: { setSideImageArgs?: [string, string] },
  opts: { caseSides: Array<{ uuid: string; name: string }> },
): TribeunalAPIClientType {
  return {
    getCase: async () => ({ uuid: CASE_UUID, sides: opts.caseSides }),
    setSideImage: async (sideId: string, imageUrl: string) => {
      record.setSideImageArgs = [sideId, imageUrl];
      return { uuid: SIDE_UUID, name: 'Yes', imageUrl };
    },
  } as unknown as TribeunalAPIClientType;
}

test('tribeunal_set_side_image dispatches to setSideImage when the side belongs to the case', async () => {
  const record: { setSideImageArgs?: [string, string] } = {};
  const client = fakeClient(record, {
    caseSides: [
      { uuid: SIDE_UUID, name: 'Yes' },
      { uuid: OTHER_SIDE_UUID, name: 'No' },
    ],
  });

  const r = await dispatchToolCall(client, 'tribeunal_set_side_image', {
    caseId: CASE_UUID,
    sideId: SIDE_UUID,
    imageUrl: IMAGE_URL,
  });

  assert.deepEqual(record.setSideImageArgs, [SIDE_UUID, IMAGE_URL]);
  assert.ok(Array.isArray(r.content) && r.content[0]?.type === 'text');
  assert.match(r.content[0].text, /successfully/i);
});

test('tribeunal_set_side_image refuses a sideId that is not part of the named case', async () => {
  const record: { setSideImageArgs?: [string, string] } = {};
  const client = fakeClient(record, {
    caseSides: [{ uuid: OTHER_SIDE_UUID, name: 'No' }],
  });

  const r = await dispatchToolCall(client, 'tribeunal_set_side_image', {
    caseId: CASE_UUID,
    sideId: SIDE_UUID,
    imageUrl: IMAGE_URL,
  });

  assert.equal(record.setSideImageArgs, undefined, 'setSideImage must not be called for a mismatched side');
  assert.ok(Array.isArray(r.content) && r.content[0]?.type === 'text');
  assert.match(r.content[0].text, /not part of case/);
});

test('SetSideImageSchema rejects an http imageUrl', () => {
  assert.throws(() => SetSideImageSchema.parse({
    caseId: CASE_UUID,
    sideId: SIDE_UUID,
    imageUrl: 'http://example.com/side.png',
  }));
});

test('SetSideImageSchema rejects a non-UUID caseId or sideId', () => {
  assert.throws(() => SetSideImageSchema.parse({ caseId: '878', sideId: SIDE_UUID, imageUrl: IMAGE_URL }));
  assert.throws(() => SetSideImageSchema.parse({ caseId: CASE_UUID, sideId: '878', imageUrl: IMAGE_URL }));
});

test('SetSideImageSchema accepts a valid https imageUrl and UUIDs', () => {
  assert.deepEqual(
    SetSideImageSchema.parse({ caseId: CASE_UUID, sideId: SIDE_UUID, imageUrl: IMAGE_URL }),
    { caseId: CASE_UUID, sideId: SIDE_UUID, imageUrl: IMAGE_URL },
  );
});

const baseCreateCaseArgs = {
  title: 'A case with side images',
  description: 'Context long enough to pass validation.',
  type: 'case' as const,
};

test('CreateCaseSchema accepts a side with a valid https image', () => {
  assert.doesNotThrow(() => CreateCaseSchema.parse({
    ...baseCreateCaseArgs,
    sides: [
      { name: 'Yes', image: IMAGE_URL },
      { name: 'No' },
    ],
  }));
});

test('CreateCaseSchema rejects a side with an http image', () => {
  assert.throws(() => CreateCaseSchema.parse({
    ...baseCreateCaseArgs,
    sides: [
      { name: 'Yes', image: 'http://example.com/side.png' },
      { name: 'No' },
    ],
  }));
});

test('TribeunalAPIClient.createCase maps sides[].image to the backend imageUrl field', async () => {
  const client = new TribeunalAPIClient({ baseURL: 'https://tribeunal.test/api' });
  const record: { url?: string; body?: any } = {};
  // Stub the underlying axios instance's post so we can inspect the outgoing body
  // without a live HTTP call — no axios-mocking helper exists in this repo yet.
  (client as any).client.post = async (url: string, body: any) => {
    record.url = url;
    record.body = body;
    return { data: { uuid: 'new-uuid' } };
  };

  await client.createCase({
    title: 'A case with side images',
    description: 'Context long enough to pass validation.',
    type: 'case',
    juryType: 'public',
    sides: [
      { name: 'Yes', image: IMAGE_URL },
      { name: 'No' },
    ],
  });

  assert.equal(record.url, '/cases');
  assert.deepEqual(record.body.sides, [
    { name: 'Yes', imageUrl: IMAGE_URL },
    { name: 'No' },
  ]);
});
