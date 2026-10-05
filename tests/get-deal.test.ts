import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall, TOOL_DEFINITIONS } from '../src/core/tools.js';
import { DEAL_DESC, DEAL_HONESTY } from '../src/tools/deals.js';
import { TribeunalAPIClient, TribeunalAPIError } from '../src/client/api-client.js';

/**
 * tribeunal_get_deal: the one-shot read over GET /api/deals/{slug}. The
 * fixture is a trimmed copy of what the dev stack answered on 2026-10-05.
 */

const TOOL = 'tribeunal_get_deal';
const SLUG = 'vjhhjbqcjk27qfmd';
const SHARE = '2f82ea2fc2973b236711e1cb1876245caf3ca1e8c9c9751b65ae24a6ae6eea45';

const DEAL_200 = {
  slug: SLUG,
  status: 'awaiting_deposit',
  chain: {
    chainId: 31337,
    name: 'Anvil (local test network)',
    escrow: '0x5ef63bb64e47a7f2a89f29be670a7c859a1c8dca',
    arbitrator: '0x10d8fbdd4267f0be34a778766c8ec0e378715cb6',
    usdc: '0xb03b631256fc6b4d6fa359833fc65b3a128ad11b',
    explorerBase: null,
    testNetwork: true,
  },
  terms: {
    version: 'tribeunal-deal-terms/1',
    text: 'Tribeunal deal terms\nVersion: tribeunal-deal-terms/1\n',
    hash: '0x5d107dd09d30c29414e30d8f3804cb416eea660fe4275ed0514aa7c6889faf22',
    metaEvidenceUri: `https://tribeunal.test/deals/${SLUG}`,
  },
  deal: {
    payer: '0x2d41c9c4a03fbcae0188eb46f1c6fe1d80ee9e14',
    payee: '0x3579c74673ee708eb3452da0de7aec33b82cc829',
    amountMinor: '50000000',
    amount: '50',
    asset: 'USDC',
    decimals: 6,
    releaseAfter: 1791573420,
    fundBy: 1791487020,
    createdAt: 1790968636,
    panel: 'human',
    description: 'Logo design, three revisions.',
  },
  params: { feeMinor: '5000000', timeoutDays: 2, appealWindowSeconds: 300, maxRounds: 3 },
  live: { disputeCapMinor: '2000000000', bridge: { lastBlock: 1655, updatedAt: 1790968713, stale: false } },
  onchain: null,
  dispute: null,
  resolution: null,
  viewer: { isCreator: true },
  shareUrl: `https://tribeunal.test/deals/${SLUG}?share=${SHARE}`,
};

const BANNED = [
  /\b(enforc\w*|binding|guarantee\w*|final\w*)\b/i,
  /\b(protect\w*|safe\w*|secur\w*|insur\w*)\b/i,
  /Tribeunal (holds|keeps|stores|has) (your|the) money/i,
];

function assertClean(text: string, label: string): void {
  for (const re of BANNED) assert.ok(!re.test(text), `${label} matches ${re}: ${text}`);
}

function findTool() {
  return TOOL_DEFINITIONS.find((d) => d.name === TOOL);
}

function fakeClient(body: Record<string, unknown> = DEAL_200): { calls: unknown[]; client: TribeunalAPIClient } {
  const calls: unknown[] = [];
  const client = {
    getDeal: async (slug: string, share?: string) => {
      calls.push({ slug, share });
      return body;
    },
  } as unknown as TribeunalAPIClient;
  return { calls, client };
}

function throwingClient(status: number | undefined, body: unknown): TribeunalAPIClient {
  return {
    getDeal: async () => {
      throw new TribeunalAPIError('x', status, body);
    },
  } as unknown as TribeunalAPIClient;
}

function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text;
}

function jsonOf(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  const text = textOf(result);
  return JSON.parse(text.slice(text.indexOf('\n\n') + 2));
}

test('get_deal is advertised read-only with a required slug and an optional share', () => {
  const tool = findTool();
  assert.ok(tool, 'tribeunal_get_deal must be advertised');
  assert.deepEqual(tool.annotations, {
    title: 'Get deal',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const schema = tool.inputSchema as { properties: Record<string, { pattern?: string; description?: string }>; required: string[] };
  assert.deepEqual(Object.keys(schema.properties), ['slug', 'share']);
  assert.equal(schema.properties.slug.pattern, '^[a-z2-7]{16}$');
  assert.equal(schema.properties.share.pattern, '^[0-9a-f]{64}$');
  assert.equal(schema.properties.slug.description, DEAL_DESC.slug);
  assert.equal(schema.properties.share.description, DEAL_DESC.share);
  assert.deepEqual(schema.required, ['slug']);
});

test('get_deal reads the deal by slug and returns the document with its honesty row', async () => {
  const { calls, client } = fakeClient();
  const result = await dispatchToolCall(client, TOOL, { slug: SLUG });

  assert.deepEqual(calls, [{ slug: SLUG, share: undefined }]);
  const json = jsonOf(result);
  assert.deepEqual(Object.keys(json), [
    'slug', 'status', 'chain', 'terms', 'deal', 'params', 'live', 'onchain', 'dispute', 'resolution', 'viewer',
    'shareUrl', 'honesty',
  ]);
  assert.equal(json.status, 'awaiting_deposit');
  assert.deepEqual(json.terms, DEAL_200.terms);
  assert.deepEqual(json.deal, DEAL_200.deal);
  assert.equal(json.shareUrl, DEAL_200.shareUrl);
  assert.deepEqual(json.honesty, DEAL_HONESTY.getDeal);
});

test('get_deal passes the share value through for a deal the caller did not create', async () => {
  const { shareUrl: _omitted, ...withoutShareUrl } = DEAL_200;
  const { calls, client } = fakeClient({ ...withoutShareUrl, viewer: { isCreator: false } });
  const json = jsonOf(await dispatchToolCall(client, TOOL, { slug: SLUG, share: SHARE }));

  assert.deepEqual(calls, [{ slug: SLUG, share: SHARE }]);
  assert.equal(json.shareUrl, null, 'a reader who did not create the request gets shareUrl null, not a missing key');
  assert.deepEqual(json.viewer, { isCreator: false });
});

test('get_deal never forwards a field the tool does not document', async () => {
  const { client } = fakeClient({ ...DEAL_200, internalNote: 'x' });
  const json = jsonOf(await dispatchToolCall(client, TOOL, { slug: SLUG }));
  assert.ok(!('internalNote' in json));
});

test('get_deal headlines the recorded status and flags a stale indexer', async () => {
  const fresh = textOf(await dispatchToolCall(fakeClient().client, TOOL, { slug: SLUG }));
  assert.equal(fresh.split('\n')[0], `Deal ${SLUG}: awaiting_deposit, as Tribeunal's indexer last recorded it.`);

  const staleBody = { ...DEAL_200, status: 'funded', live: { ...DEAL_200.live, bridge: { ...DEAL_200.live.bridge, stale: true } } };
  const stale = textOf(await dispatchToolCall(fakeClient(staleBody).client, TOOL, { slug: SLUG }));
  assert.equal(
    stale.split('\n')[0],
    `Deal ${SLUG}: funded, as Tribeunal's indexer last recorded it (the indexer is stale, so this may be behind the network).`,
  );
});

test('get_deal refuses a URL, a UUID or a malformed share before any request', async () => {
  const { calls, client } = fakeClient();
  for (const args of [
    { slug: `https://tribeunal.test/deals/${SLUG}` },
    { slug: '01a0e1b5-9b8e-7073-833f-f285549df319' },
    { slug: SLUG, share: 'tok' },
    {},
  ]) {
    await assert.rejects(dispatchToolCall(client, TOOL, args), /Invalid parameters/, JSON.stringify(args));
  }
  assert.deepEqual(calls, []);
});

test('get_deal surfaces deal_not_found code-first with a hint that names share', async () => {
  await assert.rejects(dispatchToolCall(throwingClient(404, { error: 'deal_not_found' }), TOOL, { slug: SLUG }), (e: Error) => {
    assert.match(e.message, /^API Error: deal_not_found \(404\) — /);
    assert.ok(e.message.includes('share'), 'the hint must say a share value is what a non-creator is missing');
    assertClean(e.message, 'deal_not_found hint');
    return true;
  });
});

test('get_deal reports a server without deal endpoints as such', async () => {
  await assert.rejects(
    dispatchToolCall(throwingClient(404, { title: 'An error occurred', status: 404 }), TOOL, { slug: SLUG }),
    /^Error: API Error: 404: this server has no deal endpoints yet$/,
  );
});

test("get_deal's description names every status, the share rule and its honesty row, in plain words", () => {
  const description = findTool()!.description;
  assert.match(description, /^[^.]*\. [A-Z]/, 'the first sentence must end at ". " plus a capital');
  for (const status of [
    'awaiting_deposit', 'expired', 'funded', 'disputed', 'released', 'refunded', 'released_after_deadline', 'executed', 'timed_out',
  ]) {
    assert.ok(description.includes(status), `description must name the status ${status}`);
  }
  for (const phrase of ['tribeunal_create_deal', 'share', '404 deal_not_found', 'live.bridge.stale', 'unix seconds']) {
    assert.ok(description.includes(phrase), `description must mention ${phrase}`);
  }
  const { proves, doesNotProve } = DEAL_HONESTY.getDeal;
  assert.ok(description.endsWith(`Proves: ${proves}. Does NOT prove: ${doesNotProve}`));
  assertClean(description, 'description');
  assertClean(proves, 'proves');
  assertClean(doesNotProve, 'doesNotProve');
});

test('TribeunalAPIClient.getDeal GETs /deals/{slug}, with ?share= only when given', async () => {
  const client = new TribeunalAPIClient({ baseURL: 'https://tribeunal.test/api' });
  const seen: Array<{ url: string; config: unknown }> = [];
  (client as any).client.get = async (url: string, config: unknown) => {
    seen.push({ url, config });
    return { data: DEAL_200 };
  };

  assert.deepEqual(await client.getDeal(SLUG), DEAL_200);
  await client.getDeal(SLUG, SHARE);

  assert.deepEqual(seen, [
    { url: `/deals/${SLUG}`, config: { params: {} } },
    { url: `/deals/${SLUG}`, config: { params: { share: SHARE } } },
  ]);
});
