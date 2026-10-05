import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall, TOOL_DEFINITIONS } from '../src/core/tools.js';
import { HONESTY } from '../src/tools/disputes.js';
import { UUID_PATTERN } from '../src/tools/uuid.js';
import { TribeunalAPIClient, TribeunalAPIError } from '../src/client/api-client.js';

/**
 * tribeunal_get_dispute and tribeunal_list_disputes: the one-shot reads over
 * GET /api/disputes/{uuid} and GET /api/disputes. The fixtures are trimmed
 * copies of what the dev stack answered on 2026-10-05.
 */

const DISPUTE_UUID = '01a0e1b5-9b8e-7073-833f-f285549df319';

const ROUND_0 = {
  round: 0,
  caseUuid: '49f4924f-3e70-4f4f-85ed-f2058a7ea425',
  caseUrl: 'https://tribeunal.test/cases/Af-Gate-A-6',
  state: 'closed',
  panelMode: 'ai',
  jurorCount: 3,
  minVotes: 2,
  panelOpensAt: '2026-09-27T07:12:50+00:00',
  endsAt: '2026-09-27T07:12:55+00:00',
  appealWindowSeconds: 600,
  filedBy: 'claimant',
  decisionUuid: '01a0e1b5-b2ac-76f3-aeff-17ed70913604',
  ruling: 1,
  closedAt: '2026-09-27T07:12:56+00:00',
  appealDeadline: '2026-09-27T07:22:56+00:00',
};

const ROUND_1 = {
  round: 1,
  caseUuid: 'd182c87a-4fce-42a3-a94e-453fa86060fb',
  caseUrl: 'https://tribeunal.test/cases/Af-Gate-A-Appeal-Round-1-6',
  state: 'open',
  panelMode: 'human',
  jurorCount: 5,
  minVotes: 3,
  panelOpensAt: '2026-09-27T07:13:04+00:00',
  endsAt: '2026-09-27T07:13:15+00:00',
  appealWindowSeconds: 60,
  filedBy: 'respondent',
  decisionUuid: null,
  ruling: null,
  closedAt: null,
  appealDeadline: null,
};

const DOC = {
  disputeUuid: DISPUTE_UUID,
  round0CaseUuid: ROUND_0.caseUuid,
  origin: 'offchain',
  panel: 'fast_track',
  enforcement: 'none',
  consent: 'claimant_only',
  bindingBasis: 'advisory',
  viewerRole: 'respondent',
  value: { minor: '0', asset: 'USDC', decimals: 6 },
  valueCapMinor: '2000000000',
  claimant: { username: 'testuser', label: 'Buyer', sideUuid: '1f1ba42d-98dd-6af0-905f-9fd43e9fe0d0', wallet: null },
  respondent: { username: 'testuser2', label: 'Seller', sideUuid: '1f1ba42d-98dd-6e38-bf08-9fd43e9fe0d0', wallet: null },
  arbiter: { username: 'tribeunal-arbiter' },
  rulingIndex: { 0: 'void', 1: 'claimant', 2: 'respondent' },
  rounds: [ROUND_0, ROUND_1],
  final: { at: null, ruling: null, decisionUuid: null },
  standing: { ruling: 1, basisRound: 0, basisDecisionUuid: ROUND_0.decisionUuid },
  receiptFiling: null,
  receipts: [],
  createdAt: '2026-09-27T07:12:51+00:00',
  honesty: { proves: 'server row', doesNotProve: 'server row' },
};

const LIST_ROW = {
  disputeUuid: DISPUTE_UUID,
  viewerRole: 'respondent',
  claimant: { username: 'testuser', label: 'Buyer' },
  respondent: { username: 'testuser2', label: 'Seller' },
  value: { minor: '0', asset: 'USDC', decimals: 6 },
  panel: 'fast_track',
  createdAt: '2026-09-27T07:12:51+00:00',
  currentRound: { round: 1, caseUuid: ROUND_1.caseUuid, state: 'open', ruling: null },
};

function findTool(name: string) {
  return TOOL_DEFINITIONS.find((d) => d.name === name);
}

function fakeClient(overrides: Record<string, unknown> = {}): { calls: Record<string, unknown[]>; client: TribeunalAPIClient } {
  const calls: Record<string, unknown[]> = { getDispute: [], listDisputes: [] };
  const client = {
    getDispute: async (uuid: string) => {
      calls.getDispute.push(uuid);
      return DOC;
    },
    listDisputes: async (params: unknown) => {
      calls.listDisputes.push(params);
      return { items: [LIST_ROW], page: 1, limit: 20, hasMore: false };
    },
    ...overrides,
  } as unknown as TribeunalAPIClient;
  return { calls, client };
}

function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text;
}

function jsonOf(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  const text = textOf(result);
  return JSON.parse(text.slice(text.indexOf('\n\n') + 2));
}

// ---------------------------------------------------------------------------
// tribeunal_get_dispute
// ---------------------------------------------------------------------------

test('get_dispute is advertised read-only with a required UUID disputeUuid', () => {
  const tool = findTool('tribeunal_get_dispute');
  assert.ok(tool, 'tribeunal_get_dispute must be advertised');
  assert.deepEqual(tool.annotations, {
    title: 'Get dispute',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const schema = tool.inputSchema as { properties: Record<string, { pattern?: string }>; required: string[] };
  assert.deepEqual(Object.keys(schema.properties), ['disputeUuid']);
  assert.equal(schema.properties.disputeUuid.pattern, UUID_PATTERN);
  assert.deepEqual(schema.required, ['disputeUuid']);
});

test('get_dispute reads the dispute once and returns the document with the open-dispute honesty row', async () => {
  const { calls, client } = fakeClient();
  const result = await dispatchToolCall(client, 'tribeunal_get_dispute', { disputeUuid: DISPUTE_UUID });

  assert.deepEqual(calls.getDispute, [DISPUTE_UUID]);
  const json = jsonOf(result);
  assert.deepEqual(Object.keys(json), [
    'disputeUuid', 'round0CaseUuid', 'origin', 'panel', 'enforcement', 'consent', 'bindingBasis', 'viewerRole',
    'value', 'valueCapMinor', 'claimant', 'respondent', 'arbiter', 'rulingIndex', 'rounds', 'final', 'standing',
    'receiptFiling', 'receipts', 'createdAt', 'honesty',
  ]);
  assert.deepEqual(json.rounds, DOC.rounds);
  assert.deepEqual(json.standing, DOC.standing);
  assert.deepEqual(json.claimant, DOC.claimant);
  assert.deepEqual(json.honesty, HONESTY.openDispute);
});

test('get_dispute never forwards a field the tool does not document', async () => {
  const { client } = fakeClient({ getDispute: async () => ({ ...DOC, internalNote: 'x' }) });
  const json = jsonOf(await dispatchToolCall(client, 'tribeunal_get_dispute', { disputeUuid: DISPUTE_UUID }));
  assert.ok(!('internalNote' in json));
});

test('get_dispute headlines the latest round, the ruling status and the viewer role', async () => {
  const { client } = fakeClient();
  const pending = textOf(await dispatchToolCall(client, 'tribeunal_get_dispute', { disputeUuid: DISPUTE_UUID }));
  assert.equal(
    pending.split('\n')[0],
    `Dispute ${DISPUTE_UUID}: round 1 (human) is open, ruling pending; you are viewing as respondent.`,
  );

  const finalDoc = {
    ...DOC,
    rounds: [ROUND_0],
    final: { at: '2026-09-27T07:30:00+00:00', ruling: 1, decisionUuid: ROUND_0.decisionUuid },
  };
  const { client: finalClient } = fakeClient({ getDispute: async () => finalDoc });
  const final = textOf(await dispatchToolCall(finalClient, 'tribeunal_get_dispute', { disputeUuid: DISPUTE_UUID }));
  assert.equal(
    final.split('\n')[0],
    `Dispute ${DISPUTE_UUID}: round 0 (ai) is closed, ruling final; you are viewing as respondent.`,
  );
});

test('get_dispute refuses a non-UUID disputeUuid before any request', async () => {
  const { calls, client } = fakeClient();
  await assert.rejects(
    dispatchToolCall(client, 'tribeunal_get_dispute', { disputeUuid: 'Af-Gate-A-6' }),
    /Invalid parameters/,
  );
  assert.deepEqual(calls.getDispute, []);
});

test('get_dispute surfaces dispute_not_found code-first with its hint', async () => {
  const { client } = fakeClient({
    getDispute: async () => {
      throw new TribeunalAPIError('x', 404, { error: 'dispute_not_found' });
    },
  });
  await assert.rejects(
    dispatchToolCall(client, 'tribeunal_get_dispute', { disputeUuid: DISPUTE_UUID }),
    (e: Error) => {
      assert.equal(e.message, 'API Error: dispute_not_found (404) — unknown, or you are not a party; identical by design');
      return true;
    },
  );
});

test("get_dispute's description separates it from await_ruling and names what it returns", () => {
  const description = findTool('tribeunal_get_dispute')!.description;
  assert.match(description, /^[^.]*\. [A-Z]/, 'the first sentence must end at ". " plus a capital');
  for (const phrase of ['tribeunal_await_ruling', 'tribeunal_list_disputes', 'tribeunal_get_case', '404 dispute_not_found', 'rounds', 'standing']) {
    assert.ok(description.includes(phrase), `description must mention ${phrase}`);
  }
  assert.ok(description.includes(`Proves: ${HONESTY.openDispute.proves}. Does NOT prove: ${HONESTY.openDispute.doesNotProve}`));
});

// ---------------------------------------------------------------------------
// tribeunal_list_disputes
// ---------------------------------------------------------------------------

test('list_disputes is advertised read-only with optional page and limit', () => {
  const tool = findTool('tribeunal_list_disputes');
  assert.ok(tool, 'tribeunal_list_disputes must be advertised');
  assert.deepEqual(tool.annotations, {
    title: 'List disputes',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const schema = tool.inputSchema as {
    properties: Record<string, { type: string; minimum?: number; maximum?: number; default?: number }>;
    required?: string[];
  };
  assert.deepEqual(Object.keys(schema.properties), ['page', 'limit']);
  assert.deepEqual(
    { type: schema.properties.page.type, minimum: schema.properties.page.minimum, default: schema.properties.page.default },
    { type: 'integer', minimum: 1, default: 1 },
  );
  assert.deepEqual(
    {
      type: schema.properties.limit.type,
      minimum: schema.properties.limit.minimum,
      maximum: schema.properties.limit.maximum,
      default: schema.properties.limit.default,
    },
    { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  );
  assert.deepEqual(schema.required ?? [], []);
});

test('list_disputes asks for page 1 of 20 by default and returns the rows under disputes', async () => {
  const { calls, client } = fakeClient();
  const result = await dispatchToolCall(client, 'tribeunal_list_disputes', {});

  assert.deepEqual(calls.listDisputes, [{ page: 1, limit: 20 }]);
  const json = jsonOf(result);
  assert.deepEqual(Object.keys(json), ['disputes', 'page', 'limit', 'hasMore']);
  assert.deepEqual(json.disputes, [LIST_ROW]);
  assert.equal(json.hasMore, false);
  assert.equal(textOf(result).split('\n')[0], '1 dispute on page 1; no further page.');
});

test('list_disputes passes page and limit through and says when another page exists', async () => {
  const { calls, client } = fakeClient({
    listDisputes: async (params: unknown) => {
      calls.listDisputes.push(params);
      return { items: [LIST_ROW, LIST_ROW], page: 3, limit: 2, hasMore: true };
    },
  });
  const result = await dispatchToolCall(client, 'tribeunal_list_disputes', { page: 3, limit: 2 });

  assert.deepEqual(calls.listDisputes, [{ page: 3, limit: 2 }]);
  assert.equal(textOf(result).split('\n')[0], '2 disputes on page 3; more on page 4.');
});

test('list_disputes rows carry only the documented keys', async () => {
  const { client } = fakeClient({
    listDisputes: async () => ({ items: [{ ...LIST_ROW, internalNote: 'x' }], page: 1, limit: 20, hasMore: false }),
  });
  const json = jsonOf(await dispatchToolCall(client, 'tribeunal_list_disputes', {}));
  assert.deepEqual(Object.keys((json.disputes as Array<Record<string, unknown>>)[0]), [
    'disputeUuid', 'viewerRole', 'claimant', 'respondent', 'value', 'panel', 'createdAt', 'currentRound',
  ]);
});

test('list_disputes says so when the account is a party to no dispute', async () => {
  const { client } = fakeClient({ listDisputes: async () => ({ items: [], page: 1, limit: 20, hasMore: false }) });
  const result = await dispatchToolCall(client, 'tribeunal_list_disputes', {});
  assert.equal(textOf(result).split('\n')[0], 'No disputes on page 1: this account is a party to none.');
  assert.deepEqual(jsonOf(result).disputes, []);
});

test('list_disputes does not call a later empty page proof of having no disputes', async () => {
  const { client } = fakeClient({ listDisputes: async () => ({ items: [], page: 2, limit: 20, hasMore: false }) });
  const result = await dispatchToolCall(client, 'tribeunal_list_disputes', { page: 2 });
  assert.equal(textOf(result).split('\n')[0], 'No disputes on page 2.');
});

test('list_disputes refuses limit 101 and page 0 before any request', async () => {
  const { calls, client } = fakeClient();
  await assert.rejects(dispatchToolCall(client, 'tribeunal_list_disputes', { limit: 101 }), /Invalid parameters/);
  await assert.rejects(dispatchToolCall(client, 'tribeunal_list_disputes', { page: 0 }), /Invalid parameters/);
  assert.deepEqual(calls.listDisputes, []);
});

test("list_disputes' description says it finds disputes opened against you and points at get_dispute", () => {
  const description = findTool('tribeunal_list_disputes')!.description;
  assert.match(description, /^[^.]*\. [A-Z]/, 'the first sentence must end at ". " plus a capital');
  for (const phrase of ['claimant or respondent', 'newest first', 'tribeunal_get_dispute', 'hasMore', 'currentRound']) {
    assert.ok(description.includes(phrase), `description must mention ${phrase}`);
  }
});

// ---------------------------------------------------------------------------
// The API client and the neighbouring descriptions
// ---------------------------------------------------------------------------

test('TribeunalAPIClient.listDisputes GETs /disputes with page and limit', async () => {
  const client = new TribeunalAPIClient({ baseURL: 'https://tribeunal.test/api' });
  const record: { url?: string; config?: unknown } = {};
  (client as any).client.get = async (url: string, config: unknown) => {
    record.url = url;
    record.config = config;
    return { data: { items: [], page: 2, limit: 5, hasMore: false } };
  };

  const page = await client.listDisputes({ page: 2, limit: 5 });

  assert.equal(record.url, '/disputes');
  assert.deepEqual(record.config, { params: { page: 2, limit: 5 } });
  assert.deepEqual(page, { items: [], page: 2, limit: 5, hasMore: false });
});

test('open_dispute and the shared disputeUuid description tell a respondent how to find the dispute', () => {
  const open = findTool('tribeunal_open_dispute')!.description;
  assert.ok(
    open.includes('it learns of the dispute only from a dispute.opened webhook it subscribed to, by opening the case or by calling tribeunal_list_disputes, so tell it yourself'),
    'open_dispute must no longer say a webhook or the case page is the only way to learn of a dispute',
  );
  for (const name of ['tribeunal_get_dispute', 'tribeunal_submit_evidence', 'tribeunal_await_ruling', 'tribeunal_appeal_ruling']) {
    const schema = findTool(name)!.inputSchema as { properties: { disputeUuid: { description: string } } };
    assert.ok(
      schema.properties.disputeUuid.description.includes('tribeunal_list_disputes'),
      `${name}.disputeUuid must name tribeunal_list_disputes as a source`,
    );
  }
});
