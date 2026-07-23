import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall, TOOL_DEFINITIONS } from '../src/core/tools.js';
import type { TribeunalAPIClient } from '../src/client/api-client.js';

const CASE_SHARE = 'https://tribeunal.test/cases/priv-slug?share=' + 'a'.repeat(64);
const TRIBE_SHARE = 'https://tribeunal.test/tribes/priv-tribe?share=' + 'b'.repeat(64);

function caseClient(created: Record<string, unknown>): TribeunalAPIClient {
  return { createCase: async () => created } as unknown as TribeunalAPIClient;
}

function tribeClient(created: Record<string, unknown>): TribeunalAPIClient {
  return { createTribe: async () => created } as unknown as TribeunalAPIClient;
}

function textOf(r: { content?: unknown }): string {
  return Array.isArray(r.content) && r.content[0]?.type === 'text' ? r.content[0].text : '';
}

const caseArgs = {
  title: 'A private matter to decide',
  description: 'Context long enough to pass validation.',
  type: 'case' as const,
  sides: [{ name: 'Yes' }, { name: 'No' }],
};

test('create_case prints the shareUrl as the view-and-share link for a private case', async () => {
  const client = caseClient({
    uuid: 'new-uuid',
    slug: 'priv-slug',
    url: 'https://tribeunal.test/cases/priv-slug',
    shareUrl: CASE_SHARE,
    visibility: 'private',
  });

  const r = await dispatchToolCall(client, 'tribeunal_create_case', {
    ...caseArgs,
    visibility: 'private',
    juryType: 'invited',
  });
  const text = textOf(r);

  assert.ok(text.includes(CASE_SHARE), 'the tokenized share link must be printed');
  assert.ok(text.includes('view and share the case at: ' + CASE_SHARE), 'on the view-and-share line, not the plain url');
});

test('create_case falls back to the plain url when the response carries no shareUrl (public)', async () => {
  const url = 'https://tribeunal.test/cases/pub-slug';
  const client = caseClient({ uuid: 'u', slug: 'pub-slug', url, visibility: 'public' });

  const r = await dispatchToolCall(client, 'tribeunal_create_case', { ...caseArgs });
  const text = textOf(r);

  assert.ok(text.includes('view and share the case at: ' + url), 'the view-and-share line uses the plain url');
  assert.ok(!text.includes('?share='), 'a public case has no share link');
});

const tribeArgs = { name: 'Test Tribe', description: 'A description long enough to pass validation.' };

test('create_tribe adds a view-only share-link line for a private tribe', async () => {
  const client = tribeClient({ uuid: 't', slug: 'priv-tribe', name: 'Test Tribe', type: 2, shareUrl: TRIBE_SHARE });

  const r = await dispatchToolCall(client, 'tribeunal_create_tribe', { ...tribeArgs, isPublic: false });
  const text = textOf(r);

  assert.ok(text.includes(TRIBE_SHARE), 'the tribe share link must be printed');
});

test('create_tribe omits the share-link line for a public tribe', async () => {
  const client = tribeClient({ uuid: 't', slug: 'pub-tribe', name: 'Test Tribe', type: 1 });

  const r = await dispatchToolCall(client, 'tribeunal_create_tribe', { ...tribeArgs, isPublic: true });
  const text = textOf(r);

  assert.ok(!text.includes('?share='), 'a public tribe has no share link');
  assert.ok(!text.includes('Share link'), 'no share-link line for a public tribe');
});

test('the four case/tribe tool descriptions document share links', () => {
  for (const name of ['tribeunal_create_case', 'tribeunal_get_case', 'tribeunal_create_tribe', 'tribeunal_get_tribe']) {
    const def = TOOL_DEFINITIONS.find((d) => d.name === name) as { description: string } | undefined;
    assert.ok(def, `${name} must exist`);
    assert.ok(/share/i.test(def.description), `${name} description must mention share links`);
  }
});
