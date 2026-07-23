import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall } from '../src/core/tools.js';
import type { TribeunalAPIClient } from '../src/client/api-client.js';

const CASE_UUID = '8415a252-5e41-4db6-bd5d-ee5b5ad95dd4';
const TRIBE_UUID = '1f1865f4-c8b0-6f04-b4da-4ff89bc016a0';
const CASE_SHARE = 'https://tribeunal.test/cases/slug?share=' + 'c'.repeat(64);
const TRIBE_SHARE = 'https://tribeunal.test/tribes/slug?share=' + 'd'.repeat(64);

function textOf(r: { content?: unknown }): string {
  return Array.isArray(r.content) && r.content[0]?.type === 'text' ? r.content[0].text : '';
}

test('get_case passes an owner shareUrl straight through, keeping the uuid-only contract', async () => {
  const client = {
    getCase: async () => ({ id: '878', uuid: CASE_UUID, title: 'X', shareUrl: CASE_SHARE, sides: [] }),
  } as unknown as TribeunalAPIClient;

  const r = await dispatchToolCall(client, 'tribeunal_get_case', { id: CASE_UUID });
  const parsed = JSON.parse(textOf(r));

  assert.equal(parsed.shareUrl, CASE_SHARE, 'the owner shareUrl survives the passthrough');
  assert.equal('id' in parsed, false, 'the numeric id is still stripped');
});

test('get_tribe passes an owner shareUrl straight through', async () => {
  const client = {
    getTribe: async () => ({ uuid: TRIBE_UUID, name: 'T', type: 2, shareUrl: TRIBE_SHARE }),
  } as unknown as TribeunalAPIClient;

  const r = await dispatchToolCall(client, 'tribeunal_get_tribe', { id: TRIBE_UUID });
  const parsed = JSON.parse(textOf(r));

  assert.equal(parsed.shareUrl, TRIBE_SHARE, 'the owner shareUrl survives the passthrough');
});
