import { test } from 'node:test';
import assert from 'node:assert/strict';

import { awaitRuling, rulingHeadline, HONESTY, type AwaitRulingResult } from '../src/tools/disputes.js';
import { dispatchToolCall } from '../src/core/tools.js';
import { TribeunalAPIError } from '../src/client/api-client.js';
import type { DisputeDocument, DisputeRound, TribeunalAPIClient } from '../src/client/api-client.js';

/**
 * design spec 2026-09-26-agent-dispute-tools §8.1 `tests/await-ruling.test.ts`
 * (plan Task 3). Fake `getDispute` returns a scripted sequence of documents —
 * one per fetch tick — so pending -> provisional -> final transitions, the
 * abort/timeout paths and the `signed` tri-state can all be driven precisely.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function round(overrides: Partial<DisputeRound> = {}): DisputeRound {
  return {
    round: 0,
    caseUuid: '22222222-2222-2222-2222-222222222222',
    caseUrl: 'https://tribeunal.test/cases/foo',
    state: 'open',
    panelMode: 'ai',
    jurorCount: 3,
    minVotes: 2,
    panelOpensAt: '2026-09-26T12:00:00Z',
    endsAt: '2026-09-26T12:05:00Z',
    appealWindowSeconds: 60,
    filedBy: null,
    decisionUuid: null,
    ruling: null,
    closedAt: null,
    appealDeadline: null,
    ...overrides,
  };
}

function doc(overrides: Partial<DisputeDocument> = {}): DisputeDocument {
  return {
    disputeUuid: '11111111-1111-1111-1111-111111111111',
    round0CaseUuid: '22222222-2222-2222-2222-222222222222',
    origin: 'offchain',
    panel: 'fast_track',
    enforcement: 'none',
    consent: 'claimant_only',
    bindingBasis: 'advisory',
    viewerRole: 'claimant',
    value: { minor: '0', asset: 'USDC', decimals: 6 },
    valueCapMinor: '2000000000',
    claimant: { username: 'cl', label: 'a', sideUuid: 'a', wallet: null },
    respondent: { username: 'testuser2', label: 'b', sideUuid: 'b', wallet: null },
    arbiter: { username: 'tribeunal-arbiter' },
    rulingIndex: null,
    rounds: [round()],
    standing: null,
    final: { at: null, ruling: null, decisionUuid: null },
    receiptFiling: null,
    createdAt: '2026-09-26T11:55:00Z',
    honesty: {},
    ...overrides,
  };
}

/** Fake client whose getDispute() replays a scripted sequence, one document per fetch tick (repeating the last once exhausted). */
function scriptedClient(docs: DisputeDocument[], opts: { bundle?: unknown; bundleErr?: unknown } = {}) {
  const calls = { getDispute: 0, getRulingBundle: [] as string[] };
  const client = {
    getDispute: async (_uuid: string) => {
      const d = docs[Math.min(calls.getDispute, docs.length - 1)];
      calls.getDispute += 1;
      return d;
    },
    getRulingBundle: async (uuid: string) => {
      calls.getRulingBundle.push(uuid);
      if (opts.bundleErr) throw opts.bundleErr;
      return opts.bundle ?? { signatures: [] };
    },
    rulingBundleUrl: (uuid: string) => `https://tribeunal.test/api/rulings/${uuid}`,
  } as unknown as TribeunalAPIClient;
  return { calls, client };
}

const AWAIT_KEYS = [
  'status', 'timedOut', 'waitedS', 'disputeUuid', 'viewerRole', 'round', 'roundState', 'caseUuid', 'panelMode',
  'endsAt', 'decisionUuid', 'ruling', 'standingRuling', 'basisDecisionUuid', 'bundleUrl', 'signed', 'appealDeadline',
  'mayAppeal', 'youMayAppeal', 'nextCheckAfter', 'final', 'finalAt', 'finalRuling', 'finalDecisionUuid', 'execution',
  'panelHonesty', 'honesty',
].sort();

function ctx() {
  const calls: number[] = [];
  return { sleep: async () => {}, reportProgress: async (elapsedS: number) => { calls.push(elapsedS); }, progressCalls: calls };
}

// ---------------------------------------------------------------------------
// Result key set
// ---------------------------------------------------------------------------

test('await ruling result has exactly the §4.1 key set', async () => {
  const { client } = scriptedClient([doc()]);
  const { result } = await awaitRuling(client, { disputeUuid: doc().disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx());
  assert.deepEqual(Object.keys(result).sort(), AWAIT_KEYS);
});

// ---------------------------------------------------------------------------
// pending -> provisional
// ---------------------------------------------------------------------------

test('pending -> provisional: two ticks, one getRulingBundle call on the returning tick only', async () => {
  const decided = doc({
    rounds: [round({ state: 'closed', decisionUuid: 'dec-0', ruling: 1, closedAt: '2026-09-26T12:05:00Z', appealDeadline: '2026-09-26T12:06:00Z' })],
    standing: { ruling: 1, basisRound: 0, basisDecisionUuid: 'dec-0' },
  });
  const { client, calls } = scriptedClient([doc(), decided], { bundle: { signatures: [{ ok: true }] } });
  const { result } = await awaitRuling(client, { disputeUuid: doc().disputeUuid, until: 'provisional', timeoutSeconds: 30 }, ctx());
  assert.equal(result.status, 'provisional');
  assert.equal(result.timedOut, false);
  assert.equal(calls.getRulingBundle.length, 1);
  assert.equal(calls.getRulingBundle[0], 'dec-0');
});

test('already-terminal document returns after one fetch, zero sleeps', async () => {
  const decided = doc({
    rounds: [round({ state: 'closed', decisionUuid: 'dec-0', ruling: 1, closedAt: '2026-09-26T12:05:00Z', appealDeadline: '2026-09-26T12:06:00Z' })],
    standing: { ruling: 1, basisRound: 0, basisDecisionUuid: 'dec-0' },
  });
  const c = ctx();
  const { client, calls } = scriptedClient([decided]);
  const { result } = await awaitRuling(client, { disputeUuid: decided.disputeUuid, until: 'provisional', timeoutSeconds: 30 }, c);
  assert.equal(result.timedOut, false);
  assert.equal(calls.getDispute, 1);
  assert.equal(c.progressCalls.length, 0);
});

// ---------------------------------------------------------------------------
// until: 'final'
// ---------------------------------------------------------------------------

test("until:'final' stays provisional through a lapsed-but-unfinalized closed round, and times out", async () => {
  const closedLapsed = doc({
    rounds: [round({ state: 'closed', decisionUuid: 'dec-0', ruling: 1, closedAt: '2026-09-26T12:05:00Z', appealDeadline: new Date(Date.now() - 60_000).toISOString(), appealWindowSeconds: 0 })],
    standing: { ruling: 1, basisRound: 0, basisDecisionUuid: 'dec-0' },
    final: { at: null, ruling: null, decisionUuid: null },
  });
  const { client } = scriptedClient([closedLapsed], { bundle: { signatures: [] } });
  const { result } = await awaitRuling(client, { disputeUuid: closedLapsed.disputeUuid, until: 'final', timeoutSeconds: 6 }, ctx());
  assert.equal(result.status, 'provisional');
  assert.equal(result.timedOut, true);
  assert.equal(result.final, false);
});

test("until:'final' flips to final only once final.at is set, carrying finalRuling/finalDecisionUuid/finalAt", async () => {
  const finalDoc = doc({
    rounds: [round({ state: 'closed', decisionUuid: 'dec-1', ruling: 2, closedAt: '2026-09-27T12:00:00Z', appealDeadline: null, appealWindowSeconds: 0, round: 1 })],
    standing: { ruling: 2, basisRound: 1, basisDecisionUuid: 'dec-1' },
    final: { at: '2026-09-27T13:00:00Z', ruling: 2, decisionUuid: 'dec-1' },
  });
  const { client } = scriptedClient([finalDoc], { bundle: { signatures: [{}] } });
  const { result } = await awaitRuling(client, { disputeUuid: finalDoc.disputeUuid, until: 'final', timeoutSeconds: 10 }, ctx());
  assert.equal(result.status, 'final');
  assert.equal(result.final, true);
  assert.equal(result.finalRuling, 2);
  assert.equal(result.finalDecisionUuid, 'dec-1');
  assert.equal(result.finalAt, '2026-09-27T13:00:00Z');
});

// ---------------------------------------------------------------------------
// signed tri-state
// ---------------------------------------------------------------------------

const CLOSED_DOC = doc({
  rounds: [round({ state: 'closed', decisionUuid: 'dec-0', ruling: 1, closedAt: '2026-09-26T12:05:00Z', appealDeadline: '2026-09-26T12:06:00Z' })],
  standing: { ruling: 1, basisRound: 0, basisDecisionUuid: 'dec-0' },
});

test('signed is true when the bundle carries at least one signature', async () => {
  const { client } = scriptedClient([CLOSED_DOC], { bundle: { signatures: [{ sig: 'x' }] } });
  const { result } = await awaitRuling(client, { disputeUuid: CLOSED_DOC.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx());
  assert.equal(result.signed, true);
});

test('signed is false when the bundle carries zero signatures', async () => {
  const { client } = scriptedClient([CLOSED_DOC], { bundle: { signatures: [] } });
  const { result } = await awaitRuling(client, { disputeUuid: CLOSED_DOC.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx());
  assert.equal(result.signed, false);
});

test('signed is null when getRulingBundle throws a 404 TribeunalAPIError — never a failed call', async () => {
  const { client } = scriptedClient([CLOSED_DOC], { bundleErr: new TribeunalAPIError('ruling_not_found (404)', 404, { error: 'ruling_not_found' }) });
  const { result } = await awaitRuling(client, { disputeUuid: CLOSED_DOC.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx());
  assert.equal(result.signed, null);
});

test('signed is null when getRulingBundle throws a plain transport error', async () => {
  const { client } = scriptedClient([CLOSED_DOC], { bundleErr: new Error('ECONNRESET') });
  const { result } = await awaitRuling(client, { disputeUuid: CLOSED_DOC.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx());
  assert.equal(result.signed, null);
});

test('signed is null and no bundle call is made when there is no decisionUuid yet (pending)', async () => {
  const { client, calls } = scriptedClient([doc()]);
  const { result } = await awaitRuling(client, { disputeUuid: doc().disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx());
  assert.equal(result.signed, null);
  assert.equal(calls.getRulingBundle.length, 0);
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

test('an aborted signal before the second tick returns timedOut true without another fetch', async () => {
  const signal = { aborted: false };
  const c = { sleep: async () => { signal.aborted = true; }, signal, reportProgress: async () => {} };
  const { client, calls } = scriptedClient([doc(), doc()]);
  const { result } = await awaitRuling(client, { disputeUuid: doc().disputeUuid, until: 'provisional', timeoutSeconds: 30 }, c);
  assert.equal(result.timedOut, true);
  assert.equal(calls.getDispute, 1);
});

// ---------------------------------------------------------------------------
// mayAppeal / youMayAppeal matrix
// ---------------------------------------------------------------------------

function closedRoundDoc(standingRuling: 0 | 1 | 2, opts: Partial<DisputeRound> = {}, viewerRole = 'respondent'): DisputeDocument {
  return doc({
    viewerRole,
    rounds: [round({ state: 'closed', decisionUuid: 'dec-0', ruling: standingRuling, closedAt: '2026-09-26T12:05:00Z', appealDeadline: '2026-09-26T12:06:00Z', appealWindowSeconds: 60, ...opts })],
    standing: { ruling: standingRuling, basisRound: 0, basisDecisionUuid: 'dec-0' },
  });
}

test('mayAppeal: standing 1 -> respondent, standing 2 -> claimant, standing 0 -> either', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  for (const [standing, expected] of [[1, 'respondent'], [2, 'claimant'], [0, 'either']] as const) {
    const d = closedRoundDoc(standing, { appealDeadline: future });
    const { client } = scriptedClient([d], { bundle: { signatures: [] } });
    const { result } = await awaitRuling(client, { disputeUuid: d.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx());
    assert.equal(result.mayAppeal, expected, `standing ${standing}`);
  }
});

test('mayAppeal is null on the last round (appealWindowSeconds 0)', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const d = closedRoundDoc(1, { appealWindowSeconds: 0, appealDeadline: future });
  const { client } = scriptedClient([d], { bundle: { signatures: [] } });
  const { result } = await awaitRuling(client, { disputeUuid: d.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx());
  assert.equal(result.mayAppeal, null);
});

test('mayAppeal is null once the appeal deadline has lapsed', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const d = closedRoundDoc(1, { appealDeadline: past });
  const { client } = scriptedClient([d], { bundle: { signatures: [] } });
  const { result } = await awaitRuling(client, { disputeUuid: d.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx());
  assert.equal(result.mayAppeal, null);
});

test('mayAppeal is null while pending', async () => {
  const { client } = scriptedClient([doc()]);
  const { result } = await awaitRuling(client, { disputeUuid: doc().disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx());
  assert.equal(result.mayAppeal, null);
});

test('youMayAppeal matches mayAppeal against viewerRole, and treats "either" as any party', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const asRespondent = closedRoundDoc(1, { appealDeadline: future }, 'respondent');
  const { client: c1 } = scriptedClient([asRespondent], { bundle: { signatures: [] } });
  const r1 = (await awaitRuling(c1, { disputeUuid: asRespondent.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx())).result;
  assert.equal(r1.mayAppeal, 'respondent');
  assert.equal(r1.youMayAppeal, true);

  const asClaimant = closedRoundDoc(1, { appealDeadline: future }, 'claimant');
  const { client: c2 } = scriptedClient([asClaimant], { bundle: { signatures: [] } });
  const r2 = (await awaitRuling(c2, { disputeUuid: asClaimant.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx())).result;
  assert.equal(r2.youMayAppeal, false);

  const eitherAsClaimant = closedRoundDoc(0, { appealDeadline: future }, 'claimant');
  const { client: c3 } = scriptedClient([eitherAsClaimant], { bundle: { signatures: [] } });
  const r3 = (await awaitRuling(c3, { disputeUuid: eitherAsClaimant.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx())).result;
  assert.equal(r3.mayAppeal, 'either');
  assert.equal(r3.youMayAppeal, true);
});

// ---------------------------------------------------------------------------
// nextCheckAfter
// ---------------------------------------------------------------------------

test('nextCheckAfter: pending with a future endsAt returns endsAt; a past endsAt returns null', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  const { client: c1 } = scriptedClient([doc({ rounds: [round({ endsAt: future })] })]);
  const r1 = (await awaitRuling(c1, { disputeUuid: doc().disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx())).result;
  assert.equal(r1.nextCheckAfter, future);

  const { client: c2 } = scriptedClient([doc({ rounds: [round({ endsAt: past })] })]);
  const r2 = (await awaitRuling(c2, { disputeUuid: doc().disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx())).result;
  assert.equal(r2.nextCheckAfter, null);
});

test("nextCheckAfter: provisional under until:'final' with a future deadline returns the deadline; under 'provisional' it is null", async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const d = closedRoundDoc(1, { appealDeadline: future });

  const { client: c1 } = scriptedClient([d], { bundle: { signatures: [] } });
  const r1 = (await awaitRuling(c1, { disputeUuid: d.disputeUuid, until: 'final', timeoutSeconds: 5 }, ctx())).result;
  assert.equal(r1.nextCheckAfter, future);

  const { client: c2 } = scriptedClient([d], { bundle: { signatures: [] } });
  const r2 = (await awaitRuling(c2, { disputeUuid: d.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx())).result;
  assert.equal(r2.nextCheckAfter, null);
});

// ---------------------------------------------------------------------------
// panelHonesty / execution
// ---------------------------------------------------------------------------

test('panelHonesty is HONESTY.aiPanel for an ai round, null for a human round; execution is always null', async () => {
  const aiDoc = doc({ rounds: [round({ panelMode: 'ai' })] });
  const { client: c1 } = scriptedClient([aiDoc]);
  const r1 = (await awaitRuling(c1, { disputeUuid: aiDoc.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx())).result;
  assert.deepEqual(r1.panelHonesty, HONESTY.aiPanel);
  assert.equal(r1.execution, null);

  const humanDoc = doc({ rounds: [round({ panelMode: 'human' })] });
  const { client: c2 } = scriptedClient([humanDoc]);
  const r2 = (await awaitRuling(c2, { disputeUuid: humanDoc.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx())).result;
  assert.equal(r2.panelHonesty, null);
  assert.equal(r2.execution, null);
});

// ---------------------------------------------------------------------------
// bundleUrl
// ---------------------------------------------------------------------------

test('bundleUrl is rulingBundleUrl(decisionUuid), or null pre-decision', async () => {
  const { client: c1 } = scriptedClient([CLOSED_DOC], { bundle: { signatures: [] } });
  const r1 = (await awaitRuling(c1, { disputeUuid: CLOSED_DOC.disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx())).result;
  assert.equal(r1.bundleUrl, 'https://tribeunal.test/api/rulings/dec-0');

  const { client: c2 } = scriptedClient([doc()]);
  const r2 = (await awaitRuling(c2, { disputeUuid: doc().disputeUuid, until: 'provisional', timeoutSeconds: 5 }, ctx())).result;
  assert.equal(r2.bundleUrl, null);
});

// ---------------------------------------------------------------------------
// Headlines — byte-exact
// ---------------------------------------------------------------------------

function baseResult(overrides: Partial<AwaitRulingResult> = {}): AwaitRulingResult {
  return {
    status: 'pending',
    timedOut: false,
    waitedS: 0,
    disputeUuid: '11111111-1111-1111-1111-111111111111',
    viewerRole: 'claimant',
    round: 0,
    roundState: 'open',
    caseUuid: '22222222-2222-2222-2222-222222222222',
    panelMode: 'ai',
    endsAt: '2026-09-26T12:05:00Z',
    decisionUuid: null,
    ruling: null,
    standingRuling: null,
    basisDecisionUuid: null,
    bundleUrl: null,
    signed: null,
    appealDeadline: null,
    mayAppeal: null,
    youMayAppeal: false,
    nextCheckAfter: '2026-09-26T12:05:00Z',
    final: false,
    finalAt: null,
    finalRuling: null,
    finalDecisionUuid: null,
    execution: null,
    panelHonesty: null,
    honesty: HONESTY.awaitRuling,
    ...overrides,
  };
}

test('headline: pending', () => {
  const h = rulingHeadline(baseResult(), null);
  assert.equal(h, 'Pending: round 0 (ai) is open until 2026-09-26T12:05:00Z.');
});

test('headline: provisional, appealable', () => {
  const r = baseResult({ status: 'provisional', round: 0, ruling: 1, signed: true, mayAppeal: 'respondent', appealDeadline: '2026-09-26T12:10:00Z' });
  const h = rulingHeadline(r, 0);
  assert.equal(h, 'Provisional ruling, round 0: claimant (signed). Appealable by respondent until 2026-09-26T12:10:00Z.');
});

test('headline: provisional, no appeal open (last round)', () => {
  const r = baseResult({ status: 'provisional', round: 2, ruling: 2, signed: null, mayAppeal: null });
  const h = rulingHeadline(r, 2);
  assert.equal(h, 'Provisional ruling, round 2: respondent (signature not checked). No appeal is open now; await until "final".');
});

test('headline: final', () => {
  const r = baseResult({ status: 'final', final: true, finalRuling: 2 });
  const h = rulingHeadline(r, 1);
  assert.equal(h, "Final under Tribeunal's rules: respondent (basis round 1).");
});

test('no headline ever prints null or undefined, across the whole matrix', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const matrix: Array<[AwaitRulingResult, number | null]> = [
    [baseResult(), null],
    [baseResult({ status: 'provisional', ruling: 0, signed: false, mayAppeal: 'either', appealDeadline: future }), 0],
    [baseResult({ status: 'provisional', ruling: 1, signed: null, mayAppeal: null }), 0],
    [baseResult({ status: 'final', final: true, finalRuling: 0 }), 0],
    [baseResult({ status: 'final', final: true, finalRuling: 1 }), null],
  ];
  for (const [r, basisRound] of matrix) {
    const h = rulingHeadline(r, basisRound);
    assert.ok(!h.includes('null'), h);
    assert.ok(!h.includes('undefined'), h);
  }
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

test('dispatch: timeoutSeconds out of range is refused as Invalid parameters', async () => {
  const { client } = scriptedClient([doc()]);
  await assert.rejects(
    dispatchToolCall(client, 'tribeunal_await_ruling', { disputeUuid: doc().disputeUuid, timeoutSeconds: 4 }),
    /Invalid parameters/,
  );
  await assert.rejects(
    dispatchToolCall(client, 'tribeunal_await_ruling', { disputeUuid: doc().disputeUuid, timeoutSeconds: 171 }),
    /Invalid parameters/,
  );
});

test('dispatch: defaults are until "provisional", timeoutSeconds 150', async () => {
  const { client } = scriptedClient([CLOSED_DOC], { bundle: { signatures: [] } });
  const r = await dispatchToolCall(client, 'tribeunal_await_ruling', { disputeUuid: CLOSED_DOC.disputeUuid });
  const text = r.content[0]!.text;
  const body = JSON.parse(text.slice(text.indexOf('\n\n') + 2));
  assert.equal(body.status, 'provisional');
});

test('dispatch: a 404 dispute_not_found is wrapped with the §3.5 hint', async () => {
  const client = {
    getDispute: async () => {
      throw new TribeunalAPIError('dispute_not_found (404)', 404, { error: 'dispute_not_found', message: 'm' });
    },
  } as unknown as TribeunalAPIClient;
  await assert.rejects(
    dispatchToolCall(client, 'tribeunal_await_ruling', { disputeUuid: '11111111-1111-1111-1111-111111111111' }),
    /API Error: dispute_not_found \(404\): m — unknown, or you are not a party; identical by design/,
  );
});
