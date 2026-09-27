import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dispatchToolCall, TOOL_DEFINITIONS } from '../src/core/tools.js';
import {
  DESC,
  OpenDisputeSchema,
  SubmitEvidenceSchema,
  AwaitRulingSchema,
  VerifyRulingSchema,
  AppealRulingSchema,
  HONESTY,
  disputeApiError,
  localContentHash,
} from '../src/tools/disputes.js';
import { TribeunalAPIError, type TribeunalAPIClient } from '../src/client/api-client.js';

/**
 * design spec 2026-09-26-agent-dispute-tools §8.1 `tests/disputes.test.ts`.
 * This task (plan Task 2) wires only the three write tools — open, submit,
 * appeal — so the dispatch-level assertions below cover those three; the
 * await/verify ROWS are asserted against their zod schemas directly (their
 * TOOL_DEFINITIONS entries land in Tasks 3 and 5, at which point the schema
 * they already satisfy here is the same one the new dispatch case parses
 * with).
 */

const DISPUTE_UUID = '11111111-1111-1111-1111-111111111111';
const VALID_RECEIPT = JSON.parse(readFileSync(new URL('./fixtures/x402-receipt-vector0.json', import.meta.url), 'utf8')).input;
const VALID_RECEIPT_HASH = JSON.parse(readFileSync(new URL('./fixtures/x402-receipt-vector0.json', import.meta.url), 'utf8')).sha256;

function findTool(name: string) {
  return TOOL_DEFINITIONS.find((d) => d.name === name);
}

/** Fake client recording every dispute call it receives. */
function fakeClient(overrides: Partial<TribeunalAPIClient> = {}): { calls: Record<string, unknown[]>; client: TribeunalAPIClient } {
  const calls: Record<string, unknown[]> = { openDispute: [], fileDisputeEvidence: [], appealDispute: [] };
  const client = {
    openDispute: async (body: unknown) => {
      calls.openDispute.push(body);
      return DEFAULT_OPEN_DOC;
    },
    fileDisputeEvidence: async (uuid: string, body: unknown) => {
      calls.fileDisputeEvidence.push({ uuid, body });
      return DEFAULT_FILING_RESULT;
    },
    appealDispute: async (uuid: string, reason: string) => {
      calls.appealDispute.push({ uuid, reason });
      return DEFAULT_APPEAL_RESULT;
    },
    ...overrides,
  } as unknown as TribeunalAPIClient;
  return { calls, client };
}

const DEFAULT_OPEN_DOC = {
  disputeUuid: DISPUTE_UUID,
  round0CaseUuid: '22222222-2222-2222-2222-222222222222',
  origin: 'offchain',
  panel: 'fast_track',
  enforcement: 'none',
  consent: 'claimant_only',
  bindingBasis: 'advisory',
  viewerRole: 'claimant',
  value: { minor: '1500000', asset: 'USDC', decimals: 6 },
  valueCapMinor: '2000000000',
  claimant: { username: 'cl', label: 'Refund the buyer', sideUuid: 'a', wallet: null },
  respondent: { username: 'testuser2', label: 'Keep the payment', sideUuid: 'b', wallet: null },
  arbiter: { username: 'tribeunal-arbiter' },
  rulingIndex: null,
  rounds: [
    {
      round: 0,
      caseUuid: '22222222-2222-2222-2222-222222222222',
      caseUrl: 'https://tribeunal.test/cases/foo',
      state: 'open',
      panelMode: 'ai',
      jurorCount: 3,
      minVotes: 2,
      panelOpensAt: '2026-09-26T12:00:00Z',
      endsAt: '2026-09-26T12:10:00Z',
      appealWindowSeconds: 60,
      filedBy: null,
      decisionUuid: null,
      ruling: null,
      closedAt: null,
      appealDeadline: null,
    },
  ],
  standing: null,
  final: { at: null, ruling: null, decisionUuid: null },
  receiptFiling: null,
  createdAt: '2026-09-26T11:55:00Z',
  honesty: HONESTY.openDispute,
};

const DEFAULT_FILING_RESULT = {
  filingUuid: '33333333-3333-3333-3333-333333333333',
  commentUuid: '44444444-4444-4444-4444-444444444444',
  caseUuid: '22222222-2222-2222-2222-222222222222',
  round: 0,
  kind: 'text',
  contentHash: 'deadbeef',
  markedBy: 'tribeunal-arbiter',
  receiptCheck: null,
  inRecord: true,
};

const DEFAULT_APPEAL_RESULT = {
  disputeUuid: DISPUTE_UUID,
  round: 1,
  caseUuid: '55555555-5555-5555-5555-555555555555',
  caseUrl: 'https://tribeunal.test/cases/bar',
  filedBy: 'testuser2',
  panelMode: 'human',
  jurorCount: 5,
  minVotes: 3,
  trialLength: 86400,
  endsAt: '2026-09-27T12:00:00Z',
  appealWindowSeconds: 60,
  priorRound: { round: 0, caseUuid: '22222222-2222-2222-2222-222222222222', decisionUuid: '66666666-6666-6666-6666-666666666666', ruling: 1 },
  standing: { ruling: 1, basisRound: 0, basisDecisionUuid: '66666666-6666-6666-6666-666666666666' },
  record: { commentUuid: '77777777-7777-7777-7777-777777777777', contentHash: 'abc', type: 'appeal_reason' },
  invited: 9,
  honesty: HONESTY.appealRuling,
};

function jsonAfterHeadline(text: string): unknown {
  const blank = text.indexOf('\n\n');
  assert.ok(blank > 0, 'result text must have a headline, a blank line, then JSON');
  return JSON.parse(text.slice(blank + 2));
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

test('no dispute inputSchema has a top-level oneOf/anyOf/allOf', () => {
  for (const name of ['tribeunal_open_dispute', 'tribeunal_submit_evidence', 'tribeunal_appeal_ruling']) {
    const schema = findTool(name)!.inputSchema as Record<string, unknown>;
    assert.ok(!('oneOf' in schema), `${name} must not use a top-level oneOf`);
    assert.ok(!('anyOf' in schema), `${name} must not use a top-level anyOf`);
    assert.ok(!('allOf' in schema), `${name} must not use a top-level allOf`);
  }
});

test('tribeunal_open_dispute inputSchema keys and required match the zod shape', () => {
  const def = findTool('tribeunal_open_dispute')!;
  const props = def.inputSchema.properties as Record<string, { description?: string }>;
  assert.deepEqual(Object.keys(props).sort(), ['asset', 'claim', 'claimantLabel', 'panel', 'respondent', 'respondentLabel', 'title', 'valueMinor', 'x402Receipt'].sort());
  assert.deepEqual(def.inputSchema.required, ['title', 'claim', 'respondent', 'claimantLabel', 'respondentLabel', 'panel']);
  assert.equal(props.title.description, DESC.title);
  assert.equal(props.claim.description, DESC.claim);
  assert.equal(props.claimantLabel.description, DESC.claimantLabel);
  assert.equal(props.respondentLabel.description, DESC.respondentLabel);
  assert.equal(props.panel.description, DESC.panel);
  assert.equal(props.valueMinor.description, DESC.valueMinor);
  assert.equal(props.asset.description, DESC.asset);
  assert.equal((props.respondent as { description?: string }).description, DESC.respondent);
  assert.equal((props.respondent.properties as Record<string, { description?: string }>).username.description, DESC.respondentUsername);
});

test('tribeunal_submit_evidence inputSchema keys and required match the zod shape', () => {
  const def = findTool('tribeunal_submit_evidence')!;
  const props = def.inputSchema.properties as Record<string, { description?: string }>;
  assert.deepEqual(Object.keys(props).sort(), ['disputeUuid', 'text', 'x402Receipt'].sort());
  assert.deepEqual(def.inputSchema.required, ['disputeUuid']);
  assert.equal(props.disputeUuid.description, DESC.disputeUuid);
  assert.equal(props.text.description, DESC.text);
});

test('tribeunal_appeal_ruling inputSchema keys and required match the zod shape', () => {
  const def = findTool('tribeunal_appeal_ruling')!;
  const props = def.inputSchema.properties as Record<string, { description?: string }>;
  assert.deepEqual(Object.keys(props).sort(), ['disputeUuid', 'reason'].sort());
  assert.deepEqual(def.inputSchema.required, ['disputeUuid', 'reason']);
  assert.equal(props.disputeUuid.description, DESC.disputeUuid);
  assert.equal(props.reason.description, DESC.reason);
});

// Tasks 3 and 5 add the tribeunal_await_ruling / tribeunal_verify_ruling
// TOOL_DEFINITIONS entries; their zod schemas already exist and are checked
// against the required lists directly here.
test('AwaitRulingSchema requires only disputeUuid', () => {
  assert.throws(() => AwaitRulingSchema.parse({}));
  const parsed = AwaitRulingSchema.parse({ disputeUuid: DISPUTE_UUID });
  assert.equal(parsed.disputeUuid, DISPUTE_UUID);
  assert.equal(parsed.until, 'provisional');
  assert.equal(parsed.timeoutSeconds, 150);
});

test('VerifyRulingSchema requires nothing at the top level', () => {
  assert.doesNotThrow(() => VerifyRulingSchema.parse({ decisionUuid: DISPUTE_UUID }));
  assert.doesNotThrow(() => VerifyRulingSchema.parse({ bundleUrl: 'https://tribeunal.test/rulings/x' }));
});

// ---------------------------------------------------------------------------
// Cap (I6) — refused before any request
// ---------------------------------------------------------------------------

const OPEN_BASE = {
  title: 'Undelivered report',
  claim: 'The goods never arrived.',
  respondent: { username: 'testuser2' },
  claimantLabel: 'Refund the buyer',
  respondentLabel: 'Keep the payment',
  panel: 'fast_track' as const,
};

test('valueMinor at exactly the cap is accepted and reaches the client', async () => {
  const { calls, client } = fakeClient();
  await dispatchToolCall(client, 'tribeunal_open_dispute', { ...OPEN_BASE, valueMinor: '2000000000' });
  assert.equal(calls.openDispute.length, 1);
  assert.equal((calls.openDispute[0] as { valueMinor: string }).valueMinor, '2000000000');
});

test('valueMinor one over the cap is refused with zero client calls', async () => {
  const { calls, client } = fakeClient();
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_open_dispute', { ...OPEN_BASE, valueMinor: '2000000001' }),
    (err: Error) => {
      assert.match(err.message, /^Invalid parameters/);
      assert.ok(err.message.includes('valueMinor exceeds the 2000 USDC cap (2000000000 minor units)'));
      return true;
    },
  );
  assert.equal(calls.openDispute.length, 0);
});

test('valueMinor over the cap with leading zeros is still refused with zero client calls', async () => {
  const { calls, client } = fakeClient();
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_open_dispute', { ...OPEN_BASE, valueMinor: '02000000001' }),
    (err: Error) => {
      assert.ok(err.message.includes('valueMinor exceeds the 2000 USDC cap (2000000000 minor units)'));
      return true;
    },
  );
  assert.equal(calls.openDispute.length, 0);
});

test('valueMinor with leading zeros that strip to exactly the cap is accepted', async () => {
  const { calls, client } = fakeClient();
  await dispatchToolCall(client, 'tribeunal_open_dispute', { ...OPEN_BASE, valueMinor: '0002000000000' });
  assert.equal(calls.openDispute.length, 1);
});

test('a non-decimal valueMinor is refused with the pattern message', async () => {
  const { client } = fakeClient();
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_open_dispute', { ...OPEN_BASE, valueMinor: '1.5' }),
    /valueMinor must be a decimal string of minor units, e\.g\. "1500000"/,
  );
});

// ---------------------------------------------------------------------------
// Required panel
// ---------------------------------------------------------------------------

test('a missing panel is refused with zero client calls', async () => {
  const { calls, client } = fakeClient();
  const { panel, ...withoutPanel } = OPEN_BASE;
  await assert.rejects(() => dispatchToolCall(client, 'tribeunal_open_dispute', withoutPanel), /Invalid parameters/);
  assert.equal(calls.openDispute.length, 0);
});

// ---------------------------------------------------------------------------
// x402 strict shape
// ---------------------------------------------------------------------------

test('the vector-0 x402 receipt parses on both open and submit', () => {
  assert.doesNotThrow(() => OpenDisputeSchema.parse({ ...OPEN_BASE, x402Receipt: VALID_RECEIPT }));
  assert.doesNotThrow(() => SubmitEvidenceSchema.parse({ disputeUuid: DISPUTE_UUID, x402Receipt: VALID_RECEIPT }));
});

test('an 11th x402Receipt key is refused (strict object)', () => {
  assert.throws(() => SubmitEvidenceSchema.parse({ disputeUuid: DISPUTE_UUID, x402Receipt: { ...VALID_RECEIPT, extra: 'nope' } }));
});

test('a short transaction hash is refused', () => {
  assert.throws(() => SubmitEvidenceSchema.parse({ disputeUuid: DISPUTE_UUID, x402Receipt: { ...VALID_RECEIPT, transaction: '0x' + 'a'.repeat(63) } }));
});

test('an address without 0x is refused', () => {
  assert.throws(() => SubmitEvidenceSchema.parse({ disputeUuid: DISPUTE_UUID, x402Receipt: { ...VALID_RECEIPT, payer: VALID_RECEIPT.payer.slice(2) } }));
});

test('a non-ASCII resource is refused', () => {
  assert.throws(() => SubmitEvidenceSchema.parse({ disputeUuid: DISPUTE_UUID, x402Receipt: { ...VALID_RECEIPT, resource: 'https://ex.com/ü' } }));
});

// ---------------------------------------------------------------------------
// xor refinements
// ---------------------------------------------------------------------------

test('submit refuses both text and x402Receipt', () => {
  assert.throws(
    () => SubmitEvidenceSchema.parse({ disputeUuid: DISPUTE_UUID, text: 'hi', x402Receipt: VALID_RECEIPT }),
    /Pass exactly one of text or x402Receipt/,
  );
});

test('submit refuses neither text nor x402Receipt', () => {
  assert.throws(() => SubmitEvidenceSchema.parse({ disputeUuid: DISPUTE_UUID }), /Pass exactly one of text or x402Receipt/);
});

test('verify refuses both decisionUuid and bundleUrl', () => {
  assert.throws(
    () => VerifyRulingSchema.parse({ decisionUuid: DISPUTE_UUID, bundleUrl: 'https://tribeunal.test/rulings/x' }),
    /Pass exactly one of decisionUuid or bundleUrl/,
  );
});

test('verify refuses neither decisionUuid nor bundleUrl', () => {
  assert.throws(() => VerifyRulingSchema.parse({}), /Pass exactly one of decisionUuid or bundleUrl/);
});

// ---------------------------------------------------------------------------
// reason (appeal)
// ---------------------------------------------------------------------------

test('reason is trimmed before it reaches the client', async () => {
  const { calls, client } = fakeClient();
  await dispatchToolCall(client, 'tribeunal_appeal_ruling', { disputeUuid: DISPUTE_UUID, reason: '  ok  ' });
  assert.deepEqual(calls.appealDispute[0], { uuid: DISPUTE_UUID, reason: 'ok' });
});

test('an empty, all-whitespace, or 501-character reason is refused', () => {
  assert.throws(() => AppealRulingSchema.parse({ disputeUuid: DISPUTE_UUID, reason: '' }));
  assert.throws(() => AppealRulingSchema.parse({ disputeUuid: DISPUTE_UUID, reason: '   ' }));
  assert.throws(() => AppealRulingSchema.parse({ disputeUuid: DISPUTE_UUID, reason: 'a'.repeat(501) }));
});

test('a reason with a newline is refused with the control-character message', () => {
  assert.throws(() => AppealRulingSchema.parse({ disputeUuid: DISPUTE_UUID, reason: 'a\nb' }), /reason must be one line with no control characters/);
});

test('a 500-character reason is accepted', () => {
  assert.doesNotThrow(() => AppealRulingSchema.parse({ disputeUuid: DISPUTE_UUID, reason: 'a'.repeat(500) }));
});

// ---------------------------------------------------------------------------
// Bodies forwarded exactly
// ---------------------------------------------------------------------------

test('open forwards the exact body, valueMinor omitted when absent', async () => {
  const { calls, client } = fakeClient();
  await dispatchToolCall(client, 'tribeunal_open_dispute', OPEN_BASE);
  assert.deepEqual(calls.openDispute[0], {
    title: OPEN_BASE.title,
    claim: OPEN_BASE.claim,
    respondent: { username: 'testuser2' },
    claimantLabel: OPEN_BASE.claimantLabel,
    respondentLabel: OPEN_BASE.respondentLabel,
    panel: 'fast_track',
    asset: 'USDC',
  });
});

test('open forwards valueMinor and x402Receipt when given', async () => {
  const { calls, client } = fakeClient();
  await dispatchToolCall(client, 'tribeunal_open_dispute', { ...OPEN_BASE, valueMinor: '1500000', x402Receipt: VALID_RECEIPT });
  const body = calls.openDispute[0] as Record<string, unknown>;
  assert.equal(body.valueMinor, '1500000');
  assert.deepEqual(body.x402Receipt, VALID_RECEIPT);
});

test('submit forwards {text} or {x402Receipt}', async () => {
  const { calls, client } = fakeClient();
  await dispatchToolCall(client, 'tribeunal_submit_evidence', { disputeUuid: DISPUTE_UUID, text: 'hello' });
  assert.deepEqual(calls.fileDisputeEvidence[0], { uuid: DISPUTE_UUID, body: { text: 'hello' } });

  const { calls: calls2, client: client2 } = fakeClient();
  await dispatchToolCall(client2, 'tribeunal_submit_evidence', { disputeUuid: DISPUTE_UUID, x402Receipt: VALID_RECEIPT });
  assert.deepEqual(calls2.fileDisputeEvidence[0], { uuid: DISPUTE_UUID, body: { x402Receipt: VALID_RECEIPT } });
});

test('a non-UUID disputeUuid is refused with zero client calls', async () => {
  const { calls, client } = fakeClient();
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_submit_evidence', { disputeUuid: 'not-a-uuid', text: 'hi' }),
    /Must be a dispute UUID/,
  );
  assert.equal(calls.fileDisputeEvidence.length, 0);
});

// ---------------------------------------------------------------------------
// Result key sets exact
// ---------------------------------------------------------------------------

test('open result key set is exact', async () => {
  const { client } = fakeClient();
  const r = await dispatchToolCall(client, 'tribeunal_open_dispute', OPEN_BASE);
  const result = jsonAfterHeadline(r.content[0].text) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(result).sort(),
    ['appealWindow', 'bindingBasis', 'caseUuid', 'caseUrl', 'consent', 'disputeUuid', 'endsAt', 'enforcement', 'honesty', 'panel', 'panelOpensAt', 'receiptFiling', 'value'].sort(),
  );
  assert.equal(result.caseUuid, DEFAULT_OPEN_DOC.round0CaseUuid);
  assert.deepEqual(result.appealWindow, { seconds: DEFAULT_OPEN_DOC.rounds[0].appealWindowSeconds, deadline: null });
  assert.deepEqual(result.honesty, HONESTY.openDispute);
});

test('open headline never claims filings close at panelOpensAt', async () => {
  const { client } = fakeClient();
  const r = await dispatchToolCall(client, 'tribeunal_open_dispute', OPEN_BASE);
  const headline = r.content[0].text as string;
  assert.ok(!/filings close/.test(headline), `headline must not claim filings close: ${headline}`);
  assert.match(headline, /File evidence before panelOpensAt/);
});

test('submit result key set is exact', async () => {
  const { client } = fakeClient();
  const r = await dispatchToolCall(client, 'tribeunal_submit_evidence', { disputeUuid: DISPUTE_UUID, text: 'hello' });
  const result = jsonAfterHeadline(r.content[0].text) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(result).sort(),
    ['caseUuid', 'contentHash', 'contentHashCheck', 'filingUuid', 'honesty', 'inRecord', 'kind', 'receiptCheck', 'round'].sort(),
  );
  assert.equal(result.inRecord, true);
  assert.deepEqual(result.honesty, HONESTY.submitEvidence);
});

test('appeal result key set is exact', async () => {
  const { client } = fakeClient();
  const r = await dispatchToolCall(client, 'tribeunal_appeal_ruling', { disputeUuid: DISPUTE_UUID, reason: 'ok' });
  const result = jsonAfterHeadline(r.content[0].text) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(result).sort(),
    ['appealDeadline', 'caseUrl', 'caseUuid', 'disputeUuid', 'endsAt', 'honesty', 'invited', 'jurorCount', 'minVotes', 'priorRound', 'record', 'round', 'standing'].sort(),
  );
  assert.equal(result.appealDeadline, null);
  assert.deepEqual(result.honesty, HONESTY.appealRuling);
});

// ---------------------------------------------------------------------------
// Honesty verbatim
// ---------------------------------------------------------------------------

test('HONESTY rows are byte-equal to the master-plan text', () => {
  assert.equal(HONESTY.openDispute.proves, 'The case exists, is private, and the value is ≤ cap');
  assert.equal(HONESTY.openDispute.doesNotProve, "Respondent consent; any enforcement when `bindingBasis:'advisory'`");
  assert.equal(HONESTY.submitEvidence.proves, 'The filing is hashed into the record the panel sees and the verdict commits to');
  assert.equal(
    HONESTY.submitEvidence.doesNotProve,
    "That the content is true; the x402 receipt is unchecked unless `receiptCheck:'ok'`; a receipt proves payment, not delivery",
  );
  assert.equal(HONESTY.awaitRuling.proves, "`provisional` = a signed round verdict; `final` = no further appeal under Tribeunal's rules");
  assert.equal(HONESTY.awaitRuling.doesNotProve, 'That money moved (see `execution`)');
  assert.equal(HONESTY.verifyRuling.proves, 'Cryptographic consistency against the published signer, the log and optionally the chain');
  assert.equal(HONESTY.verifyRuling.doesNotProve, 'Independence (`independent:false`); no witness cosigns the log yet');
  assert.equal(HONESTY.appealRuling.proves, 'A fresh, larger, human-only round opened');
  assert.equal(HONESTY.appealRuling.doesNotProve, 'That humans will show up (a Void appeal round keeps the standing ruling, I9)');
  assert.equal(HONESTY.aiPanel.proves, '3 AI personas voted, with provenance and model alias');
  assert.equal(
    HONESTY.aiPanel.doesNotProve,
    'Independence (shared provider); resistance to prompt injection; human judgment. **Every AI ruling is appealable to humans**',
  );
});

test('each wired tool description contains its Proves/Does NOT prove sentence', () => {
  const open = findTool('tribeunal_open_dispute')!.description;
  assert.ok(open.includes(`Proves: ${HONESTY.openDispute.proves}. Does NOT prove: ${HONESTY.openDispute.doesNotProve}`));
  assert.ok(open.includes(`AI fast-track panel proves: ${HONESTY.aiPanel.proves}. Does NOT prove: ${HONESTY.aiPanel.doesNotProve}`));

  const submit = findTool('tribeunal_submit_evidence')!.description;
  assert.ok(submit.includes(`Proves: ${HONESTY.submitEvidence.proves}. Does NOT prove: ${HONESTY.submitEvidence.doesNotProve}`));

  const appeal = findTool('tribeunal_appeal_ruling')!.description;
  assert.ok(appeal.includes(`Proves: ${HONESTY.appealRuling.proves}. Does NOT prove: ${HONESTY.appealRuling.doesNotProve}`));
});

test("each wired tool's description first sentence ends at \". \" plus a capital", () => {
  for (const name of ['tribeunal_open_dispute', 'tribeunal_submit_evidence', 'tribeunal_appeal_ruling']) {
    const description = findTool(name)!.description;
    const match = description.match(/^[^.]*\. [A-Z]/);
    assert.ok(match, `${name}'s description must end its first sentence at ". " + a capital`);
  }
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function throwingClient(method: 'openDispute' | 'fileDisputeEvidence' | 'appealDispute', err: unknown) {
  return { client: ({ [method]: async () => { throw err; } } as unknown) as TribeunalAPIClient };
}

test('every §3.5 code is wrapped as "API Error: <code> (<status>): <message> — <hint>"', async () => {
  const cases: Array<[string, number, string]> = [
    ['respondent_is_system', 422, "name the counterparty's own, active account (account-less respondents are unsupported)"],
    ['invalid_title', 422, 'fix that argument; an unchanged retry cannot work'],
    ['invalid_claim', 422, 'fix that argument; an unchanged retry cannot work'],
    ['invalid_x402_receipt', 422, 'fix that argument; an unchanged retry cannot work'],
    ['asset_unsupported', 422, 'fix that argument; an unchanged retry cannot work'],
    ['invalid_json', 400, 'a tool bug; report it'],
    ['dispute_value_over_cap', 422, 'lower valueMinor'],
    ['dispute_value_exceeds_receipt', 422, 'lower valueMinor'],
    ['respondent_unknown', 422, "name the counterparty's own, active account (account-less respondents are unsupported)"],
    ['respondent_is_self', 422, "name the counterparty's own, active account (account-less respondents are unsupported)"],
    ['dispute_not_found', 404, 'unknown, or you are not a party; identical by design'],
    ['not_a_party', 403, 'an admin who is not a party cannot file or appeal'],
    ['dispute_filings_closed', 409, 'never, for this round or dispute'],
    ['appeal_window_closed', 409, 'never, for this round or dispute'],
    ['max_rounds', 409, 'never, for this round or dispute'],
    ['dispute_final', 409, 'never, for this round or dispute'],
    ['round_not_closed', 409, 'await the provisional ruling first'],
    ['appeal_not_losing_party', 403, 'only the party the standing ruling goes against'],
    ['origin_not_offchain', 409, 'a chain dispute is appealed on chain'],
    ['appeal_pool_unconfigured', 503, 'operator configuration; tell a human, do not loop'],
    ['arbiter_unavailable', 503, 'operator configuration; tell a human, do not loop'],
    ['ruling_not_found', 404, 'unknown decision, or a private ruling you cannot view'],
    ['insufficient_scope', 403, 're-consent with the named scope'],
  ];
  for (const [code, status, hint] of cases) {
    const { client } = throwingClient('openDispute', new TribeunalAPIError('boom', status, { error: code, message: 'm' }));
    await assert.rejects(
      () => dispatchToolCall(client, 'tribeunal_open_dispute', OPEN_BASE),
      (err: Error) => {
        assert.equal(err.message, `API Error: ${code} (${status}): m — ${hint}`);
        return true;
      },
    );
  }
});

test('daily_limit_exceeded names the limit in its hint', async () => {
  const { client } = throwingClient('openDispute', new TribeunalAPIError('boom', 429, { error: 'daily_limit_exceeded', message: 'm', limit: 5 }));
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_open_dispute', OPEN_BASE),
    /API Error: daily_limit_exceeded \(429\): m — 5 disputes per account per rolling 24 h/,
  );
});

test('the API rate limiter\'s "Too Many Requests" body gets the 100/hour hint, not an invented one', async () => {
  const { client } = throwingClient(
    'openDispute',
    new TribeunalAPIError('boom', 429, { error: 'Too Many Requests', message: 'API rate limit exceeded. Please try again later.' }),
  );
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_open_dispute', OPEN_BASE),
    /API Error: Too Many Requests \(429\): API rate limit exceeded\. Please try again later\. — the API allows 100 requests\/hour; wait before retrying/,
  );
});

test('an unlisted code with no message and non-429 status gets no invented hint or empty segment', async () => {
  const { client } = throwingClient('openDispute', new TribeunalAPIError('boom', 500, { error: 'some_unlisted_code' }));
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_open_dispute', OPEN_BASE),
    (err: Error) => {
      assert.equal(err.message, 'API Error: some_unlisted_code (500)');
      return true;
    },
  );
});

test('a code-less 404 becomes the old-server message', async () => {
  const { client } = throwingClient('openDispute', new TribeunalAPIError('Not Found', 404, {}));
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_open_dispute', OPEN_BASE),
    /API Error: 404: this server has no dispute endpoints yet/,
  );
});

test('a non-API error rethrows unchanged', () => {
  const plain = new Error('ECONNRESET');
  assert.throws(() => disputeApiError(plain), (e: Error) => e === plain);
});

// ---------------------------------------------------------------------------
// Content hash
// ---------------------------------------------------------------------------

test('localContentHash matches the x402-receipt-vectors.json vector 0', async () => {
  const hash = await localContentHash({ x402Receipt: VALID_RECEIPT });
  assert.equal(hash, 'd0811e060a18085e31340cd773756f14c4596a7352d4f543493497d84ec39be9');
  assert.equal(hash, VALID_RECEIPT_HASH);
});

test('upper-case hex in transaction hashes as lowercase', async () => {
  const upper = { ...VALID_RECEIPT, transaction: VALID_RECEIPT.transaction.toUpperCase().replace('0X', '0x') };
  const hash = await localContentHash({ x402Receipt: upper });
  assert.equal(hash, VALID_RECEIPT_HASH);
});

test('text is trimmed with PHP trim()\'s character set only', async () => {
  const hashed = await localContentHash({ text: ' \t\x0Bhello\n\0' });
  const expected = await localContentHash({ text: 'hello' });
  assert.equal(hashed, expected);

  // A leading NBSP is NOT in PHP trim()'s set and must survive — unlike JS's
  // own String.prototype.trim(), which (wrongly, for this purpose) strips it.
  const withNbsp = await localContentHash({ text: ' hello' });
  const withoutNbsp = await localContentHash({ text: 'hello' });
  assert.notEqual(withNbsp, withoutNbsp);
});

test('a filing result whose contentHash differs from the local one reports mismatch but still succeeds', async () => {
  const { client } = fakeClient({
    fileDisputeEvidence: async () => ({ ...DEFAULT_FILING_RESULT, contentHash: 'not-the-real-hash' }),
  } as Partial<TribeunalAPIClient>);
  const r = await dispatchToolCall(client, 'tribeunal_submit_evidence', { disputeUuid: DISPUTE_UUID, text: 'hello' });
  assert.match(r.content[0].text, /Notice: the server-recorded contentHash does not match/);
  const result = jsonAfterHeadline(r.content[0].text) as Record<string, unknown>;
  assert.equal(result.contentHashCheck, 'mismatch');
});
