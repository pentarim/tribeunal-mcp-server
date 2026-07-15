import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  awaitCaseActivity,
  awaitVerdict,
  awaitVerdictNotice,
  AwaitCaseActivitySchema,
  verdictHeadline,
} from '../src/tools/activity.js';
import { dispatchToolCall } from '../src/core/tools.js';
import type {
  CaseActivityEvent,
  CaseActivityPage,
  CaseVerdict,
  TribeunalAPIClient,
} from '../src/client/api-client.js';

// ---- fixtures -------------------------------------------------------------

function evt(overrides: Partial<CaseActivityEvent> = {}): CaseActivityEvent {
  return {
    cursor: 'c1',
    type: 'comment',
    actorUsername: 'someone',
    actorIsAi: false,
    sideUuid: null,
    sideName: null,
    sideColor: null,
    text: 'hello',
    refUuid: null,
    createdAt: '2026-07-06T10:00:00+00:00',
    ...overrides,
  };
}

function verdictBlock(overrides: Partial<CaseVerdict> = {}): CaseVerdict {
  return {
    decided: true,
    decisionUuid: 'dec-uuid',
    type: 100,
    typeName: 'unanimous',
    name: 'Ship it',
    text: null,
    winningSides: [{ uuid: 'side-1', name: 'Ship it' }],
    sides: [
      { uuid: 'side-1', name: 'Ship it', totalVotes: 1, votePercentage: 100, isWinner: true },
      { uuid: 'side-2', name: 'Not yet', totalVotes: 0, votePercentage: 0, isWinner: false },
    ],
    totalVotes: 1,
    decidedAt: '2026-07-06T10:05:00+00:00',
    ...overrides,
  };
}

function page(overrides: Partial<CaseActivityPage> = {}): CaseActivityPage {
  return {
    caseUuid: 'case-uuid',
    caseState: 'open',
    caseEndsAt: '2026-07-07T10:00:00+00:00',
    events: [],
    latestCursor: null,
    hasMore: false,
    verdict: null,
    ...overrides,
  };
}

/** Fake client whose getCaseActivity returns pages produced by `next`. */
function fakeClient(next: (call: number) => CaseActivityPage): TribeunalAPIClient {
  let call = 0;
  return {
    getCaseActivity: async () => next(call++),
  } as unknown as TribeunalAPIClient;
}

const noSleep = async (): Promise<void> => {};

const CASE_UUID = '8415a252-5e41-4db6-bd5d-ee5b5ad95dd4';

// ---- tests ----------------------------------------------------------------

test('awaitCaseActivity returns instantly on the first non-empty page', async () => {
  let slept = 0;
  const client = fakeClient(() => page({ events: [evt()], latestCursor: 'c1' }));
  const res = await awaitCaseActivity(
    client,
    { caseId: 'x', after: 'K', timeoutS: 100 },
    { sleep: async () => { slept++; } },
  );

  assert.equal(res.timedOut, false);
  assert.equal(res.events.length, 1);
  assert.equal(res.waitedS, 0);
  assert.equal(slept, 0);
});

test('awaitCaseActivity times out with a gapless cursor echo', async () => {
  const client = fakeClient(() => page({ events: [], latestCursor: 'K' }));
  const res = await awaitCaseActivity(
    client,
    { caseId: 'x', after: 'K', timeoutS: 8 },
    { sleep: noSleep },
  );

  assert.equal(res.timedOut, true);
  assert.equal(res.latestCursor, 'K'); // unchanged: re-arm is gapless
  assert.equal(res.waitedS, 8);
});

test('awaitCaseActivity honors signal.aborted without sleeping', async () => {
  let slept = 0;
  const client = fakeClient(() => page({ events: [], latestCursor: 'K' }));
  const res = await awaitCaseActivity(
    client,
    { caseId: 'x', after: 'K', timeoutS: 100 },
    { sleep: async () => { slept++; }, signal: { aborted: true } },
  );

  assert.equal(res.timedOut, true);
  assert.equal(res.waitedS, 0);
  assert.equal(slept, 0);
});

test('awaitCaseActivity reports progress once per tick', async () => {
  const ticks: Array<[number, number]> = [];
  const client = fakeClient(() => page({ events: [], latestCursor: 'K' }));
  const res = await awaitCaseActivity(
    client,
    { caseId: 'x', after: 'K', timeoutS: 8 },
    { sleep: noSleep, reportProgress: (e, t) => { ticks.push([e, t]); } },
  );

  assert.equal(res.timedOut, true);
  assert.deepEqual(ticks, [[5, 8], [8, 8]]);
});

test('awaitVerdict returns instantly when the case is already terminal', async () => {
  let slept = 0;
  const client = fakeClient(() => page({ caseState: 'closed', verdict: verdictBlock() }));
  const res = await awaitVerdict(
    client,
    { caseId: 'x', timeoutS: 100 },
    { sleep: async () => { slept++; } },
  );

  assert.equal(res.timedOut, false);
  assert.equal(res.waitedS, 0);
  assert.notEqual(res.verdict, null);
  assert.equal(slept, 0);
});

test('verdictHeadline summarizes a decided verdict', () => {
  const res = { ...page({ verdict: verdictBlock() }), timedOut: false, waitedS: 0 };
  assert.equal(verdictHeadline(res), 'Verdict: "Ship it" by unanimous (1/1)');
});

test('awaitVerdictNotice flags a case that has not opened yet', () => {
  const res = { ...page({ caseState: 'jury_selection', verdict: null }), timedOut: true, waitedS: 100 };
  // The result must carry the case state so an agent can see WHY there is no verdict...
  assert.equal(res.caseState, 'jury_selection');
  // ...and a notice must tell it to stop re-arming.
  const notice = awaitVerdictNotice(res);
  assert.ok(notice && /not opened/i.test(notice), 'expected a not-opened-yet notice');
  assert.ok(/jury_selection/.test(notice), 'notice should name the current state');
});

test('awaitVerdictNotice is silent once a verdict exists', () => {
  const res = { ...page({ caseState: 'closed', verdict: verdictBlock() }), timedOut: false, waitedS: 0 };
  assert.equal(awaitVerdictNotice(res), null);
});

test('AwaitCaseActivitySchema rejects timeoutS above 170', () => {
  assert.throws(() => AwaitCaseActivitySchema.parse({ caseId: CASE_UUID, timeoutS: 171 }));
});

test('AwaitCaseActivitySchema rejects a non-UUID caseId', () => {
  assert.throws(() => AwaitCaseActivitySchema.parse({ caseId: '878', timeoutS: 30 }));
});

test('dispatchToolCall routes the three activity tools and rejects unknown', async () => {
  const client = fakeClient(() => page({ events: [evt()], latestCursor: 'c1', caseState: 'closed', verdict: verdictBlock() }));
  const ctx = { sleep: noSleep };

  for (const name of ['tribeunal_get_case_activity', 'tribeunal_await_case_activity', 'tribeunal_await_verdict']) {
    const r = await dispatchToolCall(client, name, { caseId: CASE_UUID, after: 'K', timeoutS: 5 }, ctx);
    assert.ok(Array.isArray(r.content) && r.content[0]?.type === 'text');
  }

  await assert.rejects(() => dispatchToolCall(client, 'tribeunal_not_a_tool', {}), /Unknown tool/);
});
