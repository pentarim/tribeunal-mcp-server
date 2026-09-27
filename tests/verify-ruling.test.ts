import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  verifyBundle,
  type VerifiableRulingBundle,
  type CheckResult,
  type SignerDocument,
  type RulingDisputeRound,
  type RulingRecord,
} from '../src/verify/ruling-verifier.js';
import type { SubtleCryptoLike } from '../src/verify/webcrypto.js';
import { dispatchToolCall, TOOL_DEFINITIONS } from '../src/core/tools.js';
import { TribeunalAPIError, type TribeunalAPIClient } from '../src/client/api-client.js';
import { HONESTY } from '../src/tools/disputes.js';

/**
 * design spec 2026-09-26-agent-dispute-tools §8.1 `tests/verify-ruling.test.ts`.
 * Plan Task 4 built the module half above (`verifyBundle` imported directly,
 * `rpcCall`/`subtle` always injected, nothing here reaches a network); Task 5
 * adds the dispatch half below, exercising `tribeunal_verify_ruling` through
 * `dispatchToolCall` against a fake `TribeunalAPIClient`.
 */

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rulings');

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as T;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function published(): VerifiableRulingBundle {
  return loadJson<VerifiableRulingBundle>('published.json');
}

function notLogged(): VerifiableRulingBundle {
  return loadJson<VerifiableRulingBundle>('not-logged.json');
}

function reopened(): VerifiableRulingBundle {
  return loadJson<VerifiableRulingBundle>('reopened.json');
}

const signerDoc = loadJson<SignerDocument>('signer.json');
const logKeyText = readFileSync(join(FIXTURES_DIR, 'log-key.txt'), 'utf8');
const anchorDoc = loadJson<{ contract?: string }>('anchor-doc.json');
const anchorRootHash = (published().log!.anchor as { rootHash: string }).rootHash;

function byName(checks: CheckResult[], name: string): CheckResult {
  const found = checks.find((c) => c.name === name);
  assert.ok(found, `no check named ${name} (have: ${checks.map((c) => c.name).join(', ')})`);
  return found as CheckResult;
}

function neverRpcCall(): Promise<unknown> {
  throw new Error('rpcCall must not be called');
}

// ---------------------------------------------------------------------------
// published.json — every check ok
// ---------------------------------------------------------------------------

test('published.json: every check ok, ok:true, independent:false, witnesses.verified false', async () => {
  const result = await verifyBundle({
    bundle: published(),
    signerDoc,
    logKeyText,
    anchorDoc,
    rpcUrl: 'https://rpc.example/base',
    rpcCall: async (_url, _method, params) => {
      void params;
      return anchorRootHash;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.independent, false);
  assert.equal(result.witnesses.verified, false);
  assert.equal(result.witnesses.log, 0);
  assert.equal(result.witnesses.anchor, 0);

  for (const name of [
    'digest',
    'signature[0]',
    'attestation[0]',
    'signer',
    'attester',
    'inclusion',
    'checkpoint',
    'anchor',
    'dispute',
  ]) {
    assert.equal(byName(result.checks, name).result, 'ok', `${name} should be ok`);
  }
  // Not reopened: n/a, never ok or FAIL.
  assert.equal(byName(result.checks, 'reopen').result, 'n/a');

  // The dispute check's detail always carries the "app-served ... not checked
  // against a chain" sentence, even on ok.
  assert.match(byName(result.checks, 'dispute').detail, /app-served, unsigned block: consistent with itself and the signed verdict, not checked against a chain/);

  // The UTF-8 byte-path trap: published.json's canonicalJson itself carries a
  // non-ASCII title, and digest still comes out ok — proving no JS string
  // ever reached viem's sha256 un-encoded.
  assert.match(published().ruling.canonicalJson, /Lieferung fehlt — ü/);
});

test('published.json: verifyBundle never throws', async () => {
  await assert.doesNotReject(
    verifyBundle({ bundle: published(), signerDoc: null, logKeyText: null, anchorDoc: null, rpcCall: neverRpcCall }),
  );
});

// ---------------------------------------------------------------------------
// not-logged.json
// ---------------------------------------------------------------------------

test('not-logged.json: inclusion, checkpoint, anchor n/a; the rest ok/n/a as designed', async () => {
  const result = await verifyBundle({
    bundle: notLogged(),
    signerDoc,
    logKeyText,
    anchorDoc,
    rpcUrl: 'https://rpc.example/base',
    rpcCall: async () => anchorRootHash,
  });

  assert.equal(byName(result.checks, 'inclusion').result, 'n/a');
  assert.equal(byName(result.checks, 'checkpoint').result, 'n/a');
  assert.equal(byName(result.checks, 'anchor').result, 'n/a');
  assert.equal(byName(result.checks, 'digest').result, 'ok');
  assert.equal(byName(result.checks, 'signature[0]').result, 'ok');
  assert.equal(byName(result.checks, 'attestation[0]').result, 'ok');
  assert.equal(byName(result.checks, 'dispute').result, 'ok');
});

// ---------------------------------------------------------------------------
// reopened.json
// ---------------------------------------------------------------------------

test('reopened.json: reopen ok', async () => {
  const result = await verifyBundle({ bundle: reopened(), signerDoc: null, logKeyText: null, anchorDoc: null });
  assert.equal(byName(result.checks, 'reopen').result, 'ok');
});

// ---------------------------------------------------------------------------
// digest: a one-byte-flipped canonicalJson
// ---------------------------------------------------------------------------

test('a one-byte-flipped canonicalJson: digest FAIL, ok:false', async () => {
  const bundle = published();
  bundle.ruling.canonicalJson = bundle.ruling.canonicalJson.replace('"schema":"tribeunal.ruling/1"', '"schema":"tribeunal.ruling/2"');
  // The stored digest is untouched — it now disagrees with the (mutated) canonicalJson.
  const result = await verifyBundle({ bundle, signerDoc: null, logKeyText: null, anchorDoc: null });

  assert.equal(byName(result.checks, 'digest').result, 'FAIL');
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// signer / attester: a signer document naming another address
// ---------------------------------------------------------------------------

test('signer document with another address: signer and attester n/a, never FAIL', async () => {
  const wrongSigner = { address: '0x0000000000000000000000000000000000dEaD' };
  const result = await verifyBundle({ bundle: published(), signerDoc: wrongSigner, logKeyText: null, anchorDoc: null });

  assert.equal(byName(result.checks, 'signer').result, 'n/a');
  assert.equal(byName(result.checks, 'attester').result, 'n/a');
});

test('signerDoc/logKeyText/anchorDoc all null: every dependent check n/a, never FAIL', async () => {
  const result = await verifyBundle({
    bundle: published(),
    signerDoc: null,
    logKeyText: null,
    anchorDoc: null,
    rpcUrl: 'https://rpc.example/base',
    rpcCall: async () => anchorRootHash,
  });

  assert.equal(byName(result.checks, 'signer').result, 'n/a');
  assert.equal(byName(result.checks, 'attester').result, 'n/a');
  assert.equal(byName(result.checks, 'checkpoint').result, 'n/a');
  assert.equal(byName(result.checks, 'anchor').result, 'n/a');
  // digest/signature/attestation/inclusion/dispute never depend on the well-knowns.
  assert.equal(byName(result.checks, 'digest').result, 'ok');
  assert.equal(byName(result.checks, 'inclusion').result, 'ok');
});

// ---------------------------------------------------------------------------
// anchor: rpcCall variants
// ---------------------------------------------------------------------------

test('anchor: rpcCall returning the matching root -> ok', async () => {
  const result = await verifyBundle({
    bundle: published(),
    signerDoc,
    logKeyText,
    anchorDoc,
    rpcUrl: 'https://rpc.example/base',
    rpcCall: async () => anchorRootHash,
  });
  assert.equal(byName(result.checks, 'anchor').result, 'ok');
});

test('anchor: rpcCall returning a different word -> FAIL', async () => {
  const result = await verifyBundle({
    bundle: published(),
    signerDoc,
    logKeyText,
    anchorDoc,
    rpcUrl: 'https://rpc.example/base',
    rpcCall: async () => `0x${'ab'.repeat(32)}`,
  });
  assert.equal(byName(result.checks, 'anchor').result, 'FAIL');
});

test('anchor: rpcCall returning the zero word -> FAIL', async () => {
  const result = await verifyBundle({
    bundle: published(),
    signerDoc,
    logKeyText,
    anchorDoc,
    rpcUrl: 'https://rpc.example/base',
    rpcCall: async () => `0x${'0'.repeat(64)}`,
  });
  assert.equal(byName(result.checks, 'anchor').result, 'FAIL');
});

test('anchor: rpcCall throwing -> n/a (transport failure, never FAIL)', async () => {
  const result = await verifyBundle({
    bundle: published(),
    signerDoc,
    logKeyText,
    anchorDoc,
    rpcUrl: 'https://rpc.example/base',
    rpcCall: async () => {
      throw new Error('ECONNRESET');
    },
  });
  assert.equal(byName(result.checks, 'anchor').result, 'n/a');
});

test('anchor: no rpcUrl -> n/a, and rpcCall is never invoked', async () => {
  const result = await verifyBundle({
    bundle: published(),
    signerDoc,
    logKeyText,
    anchorDoc,
    rpcCall: neverRpcCall,
  });
  assert.equal(byName(result.checks, 'anchor').result, 'n/a');
});

// ---------------------------------------------------------------------------
// checkpoint / anchor: Ed25519 probe, wrong key, flipped note, malformed audit path
// ---------------------------------------------------------------------------

function fakeSubtleThatCannotEd25519(): () => Promise<SubtleCryptoLike> {
  return async () => ({
    digest: async () => new ArrayBuffer(0),
    importKey: async () => {
      throw new Error('Ed25519 unsupported in this fake runtime');
    },
    verify: async () => {
      throw new Error('unreachable — importKey always throws first');
    },
  });
}

test('a subtle whose Ed25519 probe fails: checkpoint and anchor n/a, never FAIL', async () => {
  const result = await verifyBundle({
    bundle: published(),
    signerDoc,
    logKeyText,
    anchorDoc,
    rpcUrl: 'https://rpc.example/base',
    rpcCall: async () => anchorRootHash,
    subtle: fakeSubtleThatCannotEd25519(),
  });

  assert.equal(byName(result.checks, 'checkpoint').result, 'n/a');
  assert.match(byName(result.checks, 'checkpoint').detail, /this runtime has no Ed25519 in WebCrypto/);
  assert.equal(byName(result.checks, 'anchor').result, 'n/a');
  assert.match(byName(result.checks, 'anchor').detail, /this runtime has no Ed25519 in WebCrypto/);
});

test('the real subtle() with a wrong log-key.txt: checkpoint FAIL', async () => {
  // A structurally well-formed vkey (self-consistent keyId) that names a
  // different public key than the one that actually signed the checkpoint —
  // so it can never match the checkpoint's signature line, or (if it somehow
  // matched by name) can never verify against it.
  const wrongKeyName = 'a-different-log-key';
  const wrongPublicKey = new Uint8Array(32).fill(0x42);
  const nodeCrypto = await import('node:crypto');
  const wrongKeyIdDigest = await nodeCrypto.webcrypto.subtle.digest(
    'SHA-256',
    Buffer.concat([Buffer.from(wrongKeyName, 'utf8'), Buffer.from([0x0a, 0x01]), Buffer.from(wrongPublicKey)]),
  );
  const wrongKeyId = new Uint8Array(wrongKeyIdDigest).subarray(0, 4);
  const wrongLogKeyText = `${wrongKeyName}+${Buffer.from(wrongKeyId).toString('hex')}+${Buffer.from(
    new Uint8Array([0x01, ...wrongPublicKey]),
  ).toString('base64')}\n`;

  const result = await verifyBundle({ bundle: published(), signerDoc: null, logKeyText: wrongLogKeyText, anchorDoc: null });
  assert.equal(byName(result.checks, 'checkpoint').result, 'FAIL');
});

test('a one-byte-flipped checkpoint note: checkpoint FAIL', async () => {
  const bundle = published();
  const log = bundle.log as { checkpoint: string };
  // Flip one base64 character of the root line — still a well-formed
  // checkpoint (three lines, a signature block), but the Ed25519 signature
  // no longer verifies over the mutated note text.
  log.checkpoint = log.checkpoint.replace('gzDhrtnWavasH/WDzW8oRS6a2v1TYX31v5ByUy5XfGU=', 'AzDhrtnWavasH/WDzW8oRS6a2v1TYX31v5ByUy5XfGU=');

  const result = await verifyBundle({ bundle, signerDoc: null, logKeyText, anchorDoc: null });
  assert.equal(byName(result.checks, 'checkpoint').result, 'FAIL');
});

test('a malformed log.anchor.auditPath (a non-base64 element): anchor FAIL, not n/a', async () => {
  const bundle = published();
  const anchor = (bundle.log as { anchor: { auditPath: string[] } }).anchor;
  anchor.auditPath = ['not-valid-base64!!'];

  const result = await verifyBundle({
    bundle,
    signerDoc: null,
    logKeyText,
    anchorDoc,
    rpcUrl: 'https://rpc.example/base',
    rpcCall: async () => anchorRootHash,
  });
  assert.equal(byName(result.checks, 'anchor').result, 'FAIL');
});

// ---------------------------------------------------------------------------
// dispute (#10, MCP-only)
// ---------------------------------------------------------------------------

function stubRuling(overrides: Partial<RulingRecord> = {}): RulingRecord {
  return {
    caseUuid: 'aaaaaaaa-1111-4111-8111-111111111111',
    decisionUuid: 'bbbbbbbb-1111-4111-8111-111111111111',
    version: 1,
    digest: 'f'.repeat(64),
    canonicalJson: '{}',
    canonicalJsonStatus: 'withheld',
    evidenceSetHash: '0'.repeat(64),
    ledgerId: 'cccccccc-1111-4111-8111-111111111111',
    latest: true,
    reopenedBy: undefined,
    ...overrides,
  };
}

const DISPUTE_OK_DETAIL_BASE =
  'app-served, unsigned block: consistent with itself and the signed verdict, not checked against a chain';

function stubRound(overrides: Partial<RulingDisputeRound> = {}): RulingDisputeRound {
  return {
    round: 0,
    caseUuid: 'round-case',
    decisionUuid: 'round-decision',
    digest: null,
    panelMode: 'ai' as const,
    jurorCount: 3,
    minVotes: 2,
    closedAt: null,
    appealDeadline: null,
    outcome: null,
    ruling: null,
    ...overrides,
  };
}

async function disputeResult(dispute: unknown, ruling = stubRuling()): Promise<CheckResult> {
  const bundle = { ruling, dispute } as unknown as VerifiableRulingBundle;
  const result = await verifyBundle({ bundle, signerDoc: null, logKeyText: null, anchorDoc: null });
  return byName(result.checks, 'dispute');
}

test('dispute: absent or null -> n/a', async () => {
  assert.equal((await disputeResult(undefined)).result, 'n/a');
  assert.equal((await disputeResult(null)).result, 'n/a');
});

test('dispute: a consistent single round -> ok, detail ends with the fixed sentence', async () => {
  const ruling = stubRuling();
  const round0 = stubRound({
    round: 0,
    caseUuid: ruling.caseUuid,
    decisionUuid: ruling.decisionUuid,
    digest: ruling.digest,
    outcome: 'decided',
    ruling: 1,
  });
  const dispute = {
    disputeUuid: 'dispute-1',
    origin: 'offchain',
    enforcement: 'none',
    consent: 'claimant_only',
    bindingBasis: 'advisory',
    round: 0,
    rounds: [round0],
    standingRuling: 1,
    basisDecisionUuid: ruling.decisionUuid,
    final: false,
    finalAt: null,
    finalRuling: null,
    finalDecisionUuid: null,
    basis: 'app-window',
    execution: null,
  };
  const check = await disputeResult(dispute, ruling);
  assert.equal(check.result, 'ok');
  assert.equal(check.detail, DISPUTE_OK_DETAIL_BASE);
});

test('dispute: rounds[1].round = 2 -> FAIL', async () => {
  const ruling = stubRuling();
  const round0 = stubRound({ round: 0, outcome: 'decided', ruling: 1 });
  const round1 = stubRound({ round: 2, caseUuid: ruling.caseUuid, decisionUuid: ruling.decisionUuid, digest: ruling.digest, outcome: 'decided', ruling: 2 });
  const dispute = {
    disputeUuid: 'd', origin: 'offchain', enforcement: 'none', consent: 'claimant_only', bindingBasis: 'advisory',
    round: 2, rounds: [round0, round1], standingRuling: 2, basisDecisionUuid: ruling.decisionUuid,
    final: false, finalAt: null, finalRuling: null, finalDecisionUuid: null, basis: 'app-window', execution: null,
  };
  assert.equal((await disputeResult(dispute, ruling)).result, 'FAIL');
});

test('dispute I9: a Void round 1 keeps round 0\'s standing ruling -> ok', async () => {
  const ruling = stubRuling();
  const round0 = stubRound({ round: 0, caseUuid: 'c0', decisionUuid: 'dec0', digest: 'digest0', outcome: 'decided', ruling: 1 });
  const round1 = stubRound({ round: 1, caseUuid: ruling.caseUuid, decisionUuid: ruling.decisionUuid, digest: ruling.digest, outcome: 'void', ruling: 0 });
  const dispute = {
    disputeUuid: 'd', origin: 'offchain', enforcement: 'none', consent: 'claimant_only', bindingBasis: 'advisory',
    round: 1, rounds: [round0, round1], standingRuling: 1, basisDecisionUuid: 'dec0',
    final: false, finalAt: null, finalRuling: null, finalDecisionUuid: null, basis: 'app-window', execution: null,
  };
  assert.equal((await disputeResult(dispute, ruling)).result, 'ok');
});

test('dispute I9: the same shape with standingRuling 0 -> FAIL', async () => {
  const ruling = stubRuling();
  const round0 = stubRound({ round: 0, caseUuid: 'c0', decisionUuid: 'dec0', digest: 'digest0', outcome: 'decided', ruling: 1 });
  const round1 = stubRound({ round: 1, caseUuid: ruling.caseUuid, decisionUuid: ruling.decisionUuid, digest: ruling.digest, outcome: 'void', ruling: 0 });
  const dispute = {
    disputeUuid: 'd', origin: 'offchain', enforcement: 'none', consent: 'claimant_only', bindingBasis: 'advisory',
    round: 1, rounds: [round0, round1], standingRuling: 0, basisDecisionUuid: 'dec0',
    final: false, finalAt: null, finalRuling: null, finalDecisionUuid: null, basis: 'app-window', execution: null,
  };
  assert.equal((await disputeResult(dispute, ruling)).result, 'FAIL');
});

test('dispute: finalRuling disagreeing with the standing ruling -> FAIL', async () => {
  const ruling = stubRuling();
  const round0 = stubRound({ round: 0, caseUuid: ruling.caseUuid, decisionUuid: ruling.decisionUuid, digest: ruling.digest, outcome: 'decided', ruling: 1 });
  const dispute = {
    disputeUuid: 'd', origin: 'offchain', enforcement: 'none', consent: 'claimant_only', bindingBasis: 'advisory',
    round: 0, rounds: [round0], standingRuling: 1, basisDecisionUuid: ruling.decisionUuid,
    final: true, finalAt: '2026-01-01T00:00:00Z', finalRuling: 2, finalDecisionUuid: ruling.decisionUuid,
    basis: 'app-window', execution: null,
  };
  assert.equal((await disputeResult(dispute, ruling)).result, 'FAIL');
});

test('dispute: final false but finalAt set -> FAIL', async () => {
  const ruling = stubRuling();
  const round0 = stubRound({ round: 0, caseUuid: ruling.caseUuid, decisionUuid: ruling.decisionUuid, digest: ruling.digest, outcome: 'decided', ruling: 1 });
  const dispute = {
    disputeUuid: 'd', origin: 'offchain', enforcement: 'none', consent: 'claimant_only', bindingBasis: 'advisory',
    round: 0, rounds: [round0], standingRuling: 1, basisDecisionUuid: ruling.decisionUuid,
    final: false, finalAt: '2026-01-01T00:00:00Z', finalRuling: null, finalDecisionUuid: null,
    basis: 'app-window', execution: null,
  };
  assert.equal((await disputeResult(dispute, ruling)).result, 'FAIL');
});

test('dispute: closedAt one second off the signed verdict.decidedAt -> FAIL', async () => {
  const canonicalJson = JSON.stringify({ verdict: { decided: true, decidedAt: '2026-01-01T00:00:00Z', sides: [{ isWinner: true }] } });
  const ruling = stubRuling({ canonicalJson, canonicalJsonStatus: 'served', digest: 'irrelevant-for-this-check'.padEnd(64, '0') });
  const round0 = stubRound({
    round: 0,
    caseUuid: ruling.caseUuid,
    decisionUuid: ruling.decisionUuid,
    digest: ruling.digest,
    outcome: 'decided',
    ruling: 1,
    closedAt: '2026-01-01T00:00:01Z',
  });
  const dispute = {
    disputeUuid: 'd', origin: 'offchain', enforcement: 'none', consent: 'claimant_only', bindingBasis: 'advisory',
    round: 0, rounds: [round0], standingRuling: 1, basisDecisionUuid: ruling.decisionUuid,
    final: false, finalAt: null, finalRuling: null, finalDecisionUuid: null, basis: 'app-window', execution: null,
  };
  assert.equal((await disputeResult(dispute, ruling)).result, 'FAIL');
});

test('dispute: closedAt null against a set signed verdict.decidedAt -> FAIL', async () => {
  const canonicalJson = JSON.stringify({ verdict: { decided: true, decidedAt: '2026-01-01T00:00:00Z', sides: [{ isWinner: true }] } });
  const ruling = stubRuling({ canonicalJson, canonicalJsonStatus: 'served', digest: 'irrelevant-for-this-check'.padEnd(64, '0') });
  const round0 = stubRound({
    round: 0,
    caseUuid: ruling.caseUuid,
    decisionUuid: ruling.decisionUuid,
    digest: ruling.digest,
    outcome: 'decided',
    ruling: 1,
    closedAt: null,
  });
  const dispute = {
    disputeUuid: 'd', origin: 'offchain', enforcement: 'none', consent: 'claimant_only', bindingBasis: 'advisory',
    round: 0, rounds: [round0], standingRuling: 1, basisDecisionUuid: ruling.decisionUuid,
    final: false, finalAt: null, finalRuling: null, finalDecisionUuid: null, basis: 'app-window', execution: null,
  };
  assert.equal((await disputeResult(dispute, ruling)).result, 'FAIL');
});

test('dispute: an empty closed prefix (rounds[0].ruling null) with standingRuling/basisDecisionUuid set -> FAIL', async () => {
  const ruling = stubRuling();
  const round0 = stubRound({ round: 0, caseUuid: ruling.caseUuid, decisionUuid: ruling.decisionUuid, digest: ruling.digest, outcome: null, ruling: null });
  const dispute = {
    disputeUuid: 'd', origin: 'offchain', enforcement: 'none', consent: 'claimant_only', bindingBasis: 'advisory',
    round: 0, rounds: [round0], standingRuling: 2, basisDecisionUuid: null,
    final: false, finalAt: null, finalRuling: null, finalDecisionUuid: null, basis: 'app-window', execution: null,
  };
  assert.equal((await disputeResult(dispute, ruling)).result, 'FAIL');
});

test('dispute: outcome "decided" with ruling 0 -> FAIL', async () => {
  const ruling = stubRuling();
  const round0 = stubRound({ round: 0, caseUuid: ruling.caseUuid, decisionUuid: ruling.decisionUuid, digest: ruling.digest, outcome: 'decided', ruling: 0 });
  const dispute = {
    disputeUuid: 'd', origin: 'offchain', enforcement: 'none', consent: 'claimant_only', bindingBasis: 'advisory',
    round: 0, rounds: [round0], standingRuling: 0, basisDecisionUuid: ruling.decisionUuid,
    final: false, finalAt: null, finalRuling: null, finalDecisionUuid: null, basis: 'app-window', execution: null,
  };
  assert.equal((await disputeResult(dispute, ruling)).result, 'FAIL');
});

test('dispute: a non-null execution is named in detail, verdict unchanged', async () => {
  const ruling = stubRuling();
  const round0 = stubRound({ round: 0, caseUuid: ruling.caseUuid, decisionUuid: ruling.decisionUuid, digest: ruling.digest, outcome: 'decided', ruling: 1 });
  const dispute = {
    disputeUuid: 'd', origin: 'offchain', enforcement: 'none', consent: 'claimant_only', bindingBasis: 'advisory',
    round: 0, rounds: [round0], standingRuling: 1, basisDecisionUuid: ruling.decisionUuid,
    final: false, finalAt: null, finalRuling: null, finalDecisionUuid: null, basis: 'app-window',
    execution: { txHash: '0xdeadbeef' },
  };
  const check = await disputeResult(dispute, ruling);
  assert.equal(check.result, 'ok');
  assert.equal(check.detail, `execution: ${JSON.stringify({ txHash: '0xdeadbeef' })}; ${DISPUTE_OK_DETAIL_BASE}`);
  assert.equal(check.detail.endsWith(DISPUTE_OK_DETAIL_BASE), true);
});

// ---------------------------------------------------------------------------
// Import hygiene (spec §3.1/§4.4)
// ---------------------------------------------------------------------------

test('import hygiene: only src/verify/ruling-verifier.ts imports from viem, and its import list is exactly the twelve names', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const offenders: string[] = [];
  let verifierImportLine: string | null = null;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const text = readFileSync(path, 'utf8');
      if (!text.includes("from 'viem'")) continue;
      if (path.endsWith(join('verify', 'ruling-verifier.ts'))) {
        const block = /import\s*\{[\s\S]*?\}\s*from\s*'viem';/.exec(text);
        assert.ok(block, 'expected a single import { ... } from \'viem\'; statement');
        verifierImportLine = block[0];
      } else {
        offenders.push(path);
      }
    }
  };
  walk(srcDir);

  assert.deepEqual(offenders, [], `only src/verify/ruling-verifier.ts may import from 'viem', found: ${offenders.join(', ')}`);
  assert.ok(verifierImportLine, 'src/verify/ruling-verifier.ts must import from viem');
  const names = [
    'recoverTypedDataAddress',
    'encodeAbiParameters',
    'encodeFunctionData',
    'encodePacked',
    'keccak256',
    'parseAbi',
    'sha256',
    'toHex',
    'bytesToHex',
    'concatBytes',
    'hexToBytes',
    'stringToBytes',
  ];
  for (const name of names) {
    assert.match(verifierImportLine as unknown as string, new RegExp(`\\b${name}\\b`), `missing viem import ${name}`);
  }
});

test('import hygiene: no file other than src/core/tools.ts imports ../verify/ruling-verifier.js', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.ts') || path.endsWith(join('verify', 'ruling-verifier.ts'))) continue;
      const text = readFileSync(path, 'utf8');
      if (text.includes('verify/ruling-verifier.js') && !path.endsWith(join('core', 'tools.ts'))) {
        offenders.push(path);
      }
    }
  };
  walk(srcDir);

  assert.deepEqual(offenders, []);
});

test('src/core/tools.ts reaches the verifier only via a dynamic import, never a static one', () => {
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'tools.ts'), 'utf8');
  assert.match(text, /await import\('\.\.\/verify\/ruling-verifier\.js'\)/, 'tools.ts must lazily import the verifier');
  assert.ok(text.includes("await import('../verify/ruling-verifier.js')"), 'tools.ts must lazily import the verifier');
  assert.doesNotMatch(
    text,
    /^import\s[^;]*from\s+['"]\.\.\/verify\/ruling-verifier\.js['"]/m,
    'tools.ts must never statically import the verifier (keeps it out of every other path\'s startup)',
  );
});

// ---------------------------------------------------------------------------
// Dispatch (plan Task 5): tribeunal_verify_ruling over a fake TribeunalAPIClient
// ---------------------------------------------------------------------------

const DECISION_UUID = (published().ruling as unknown as { decisionUuid: string }).decisionUuid;

function withVisibility(bundle: VerifiableRulingBundle, visibility: string): VerifiableRulingBundle {
  const copy = clone(bundle);
  const parsed = JSON.parse(copy.ruling.canonicalJson) as { case?: Record<string, unknown> };
  (parsed.case as Record<string, unknown>).visibility = visibility;
  copy.ruling.canonicalJson = JSON.stringify(parsed);
  return copy;
}

function jsonAfterHeadline(text: string): { headline: string; result: Record<string, unknown> } {
  const blank = text.indexOf('\n\n');
  assert.ok(blank > 0, 'result text must have a headline, a blank line, then JSON');
  return { headline: text.slice(0, blank), result: JSON.parse(text.slice(blank + 2)) };
}

function fakeVerifyClient(opts: {
  bundle?: unknown;
  bundleErr?: unknown;
  signer?: unknown;
  logKey?: unknown;
  anchor?: unknown;
  origin?: string;
} = {}): { calls: { getRulingBundle: unknown[][]; getWellKnown: unknown[][] }; client: TribeunalAPIClient } {
  const origin = opts.origin ?? 'https://tribeunal.test';
  const calls = { getRulingBundle: [] as unknown[][], getWellKnown: [] as unknown[][] };
  const client = {
    origin,
    rulingBundleUrl: (uuid: string) => `${origin}/api/rulings/${uuid}`,
    getRulingBundle: async (uuid: string, share?: string) => {
      calls.getRulingBundle.push([uuid, share]);
      if (opts.bundleErr) throw opts.bundleErr;
      return opts.bundle;
    },
    getWellKnown: async (path: string) => {
      calls.getWellKnown.push([path]);
      if (path.endsWith('tribeunal-verdict-signer')) return 'signer' in opts ? opts.signer : signerDoc;
      if (path.endsWith('tribeunal-log-key')) return 'logKey' in opts ? opts.logKey : logKeyText;
      if (path.endsWith('tribeunal-log-anchor')) return 'anchor' in opts ? opts.anchor : anchorDoc;
      return null;
    },
  } as unknown as TribeunalAPIClient;
  return { calls, client };
}

test('tribeunal_verify_ruling: decisionUuid over the published fixture — everything ok, result keys exact', async () => {
  const { client } = fakeVerifyClient({ bundle: published() });
  const res = await dispatchToolCall(client, 'tribeunal_verify_ruling', { decisionUuid: DECISION_UUID });
  const { headline, result } = jsonAfterHeadline(res.content[0].text);
  assert.match(headline, /^Verified: \d+ ok, \d+ n\/a, 0 FAIL — independent: false$/);
  assert.equal(result.ok, true);
  assert.equal(result.independent, false);
  assert.deepEqual(result.trustedSigner, {
    address: signerDoc.address,
    source: 'well-known',
    url: 'https://tribeunal.test/.well-known/tribeunal-verdict-signer',
  });
  assert.deepEqual(result.witnesses, { log: 0, anchor: 0, verified: false });
  assert.equal(result.decisionUuid, DECISION_UUID);
  assert.equal(result.caseUuid, (published().ruling as unknown as { caseUuid: string }).caseUuid);
  assert.deepEqual(
    Object.keys(result).sort(),
    ['ok', 'checks', 'independent', 'trustedSigner', 'witnesses', 'decisionUuid', 'caseUuid', 'command', 'honesty'].sort(),
  );
  assert.deepEqual(result.honesty, HONESTY.verifyRuling);
});

test('a bundleUrl on this host resolves the decisionUuid and forwards the share token', async () => {
  const { calls, client } = fakeVerifyClient({ bundle: published() });
  await dispatchToolCall(client, 'tribeunal_verify_ruling', { bundleUrl: `https://tribeunal.test/rulings/${DECISION_UUID}?share=abc` });
  assert.deepEqual(calls.getRulingBundle[0], [DECISION_UUID, 'abc']);
});

test('a bundleUrl on a foreign host is refused before any client call', async () => {
  const { calls, client } = fakeVerifyClient({ bundle: published() });
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_verify_ruling', { bundleUrl: `https://evil.example/api/rulings/${DECISION_UUID}` }),
    (err: Error) => {
      assert.equal(err.message, 'Invalid parameters: bundleUrl must be on https://tribeunal.test');
      return true;
    },
  );
  assert.equal(calls.getRulingBundle.length, 0, 'no bundle fetch on a rejected foreign host');
  assert.equal(calls.getWellKnown.length, 0, 'no well-known fetch on a rejected foreign host');
});

test('rpcUrl must be https, or http on localhost/127.0.0.1', async () => {
  const { client } = fakeVerifyClient({ bundle: published() });
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_verify_ruling', { decisionUuid: DECISION_UUID, rpcUrl: 'http://example.com/' }),
    (err: Error) => {
      assert.ok(err.message.startsWith('Invalid parameters:'));
      assert.ok(err.message.includes('rpcUrl must be https (or http on localhost)'));
      return true;
    },
  );
  await assert.doesNotReject(() =>
    dispatchToolCall(client, 'tribeunal_verify_ruling', { decisionUuid: DECISION_UUID, rpcUrl: 'http://127.0.0.1:8545/' }),
  );
});

test('a well-known that answers null for signer/log-key/anchor leaves the dependent checks n/a, ok stays true', async () => {
  const { client } = fakeVerifyClient({ bundle: published(), signer: null, logKey: null, anchor: null });
  const res = await dispatchToolCall(client, 'tribeunal_verify_ruling', { decisionUuid: DECISION_UUID });
  const { result } = jsonAfterHeadline(res.content[0].text);
  assert.equal(result.ok, true);
  const checks = result.checks as CheckResult[];
  assert.equal(byName(checks, 'signer').result, 'n/a');
  assert.equal(byName(checks, 'attester').result, 'n/a');
  assert.equal(byName(checks, 'checkpoint').result, 'n/a');
  assert.equal(byName(checks, 'anchor').result, 'n/a');
});

test('getRulingBundle 404 ruling_not_found is wrapped by disputeApiError', async () => {
  const { client } = fakeVerifyClient({ bundleErr: new TribeunalAPIError('boom', 404, { error: 'ruling_not_found', message: 'm' }) });
  await assert.rejects(
    () => dispatchToolCall(client, 'tribeunal_verify_ruling', { decisionUuid: DECISION_UUID }),
    (err: Error) => {
      assert.equal(err.message, 'API Error: ruling_not_found (404): m — unknown decision, or a private ruling you cannot view');
      return true;
    },
  );
});

test('command names the online form for a public ruling, with --rpc when given', async () => {
  const { client } = fakeVerifyClient({ bundle: withVisibility(published(), 'public') });
  const { result } = jsonAfterHeadline((await dispatchToolCall(client, 'tribeunal_verify_ruling', { decisionUuid: DECISION_UUID })).content[0].text);
  assert.equal(result.command, `node tools/ruling-verify.mjs https://tribeunal.test/api/rulings/${DECISION_UUID}`);

  const { client: client2 } = fakeVerifyClient({ bundle: withVisibility(published(), 'public') });
  const { result: result2 } = jsonAfterHeadline(
    (await dispatchToolCall(client2, 'tribeunal_verify_ruling', { decisionUuid: DECISION_UUID, rpcUrl: 'https://rpc.example/' })).content[0].text,
  );
  assert.equal(result2.command, `node tools/ruling-verify.mjs https://tribeunal.test/api/rulings/${DECISION_UUID} --rpc https://rpc.example/`);
});

test('command names the offline form for a private ruling (every dispute round today)', async () => {
  const { client } = fakeVerifyClient({ bundle: published() });
  const { result } = jsonAfterHeadline((await dispatchToolCall(client, 'tribeunal_verify_ruling', { decisionUuid: DECISION_UUID })).content[0].text);
  assert.equal(
    result.command,
    'node tools/ruling-verify.mjs --bundle <this bundle, saved as a party> --signer https://tribeunal.test/.well-known/tribeunal-verdict-signer --log-key https://tribeunal.test/.well-known/tribeunal-log-key',
  );
});

test('a tampered bundle still returns a normal result — ok:false, 1 FAIL, never an error result', async () => {
  const tampered = clone(published());
  tampered.ruling.canonicalJson = tampered.ruling.canonicalJson.replace('"schema":"tribeunal.ruling/1"', '"schema":"tribeunal.ruling/2"');
  const { client } = fakeVerifyClient({ bundle: tampered });
  const res = await dispatchToolCall(client, 'tribeunal_verify_ruling', { decisionUuid: DECISION_UUID });
  const { headline, result } = jsonAfterHeadline(res.content[0].text);
  assert.equal(result.ok, false);
  assert.match(headline, /^Verified: \d+ ok, \d+ n\/a, 1 FAIL — independent: false$/);
  assert.equal(byName(result.checks as CheckResult[], 'digest').result, 'FAIL');
});

test('annotation totals: 46 tools, 15 read-only, 10 destructive, 3 open-world', () => {
  assert.equal(TOOL_DEFINITIONS.length, 46);
  const readOnly = TOOL_DEFINITIONS.filter((d) => (d.annotations as { readOnlyHint?: boolean }).readOnlyHint === true);
  assert.equal(readOnly.length, 15, 'expected 15 readOnlyHint:true tools');
  const destructive = TOOL_DEFINITIONS.filter((d) => (d.annotations as { destructiveHint?: boolean }).destructiveHint === true);
  assert.equal(destructive.length, 10, 'expected 10 destructiveHint:true tools');
  const openWorld = TOOL_DEFINITIONS
    .filter((d) => (d.annotations as { openWorldHint?: boolean }).openWorldHint === true)
    .map((d) => d.name)
    .sort();
  assert.deepEqual(openWorld, ['tribeunal_create_case', 'tribeunal_update_side_image', 'tribeunal_verify_ruling'].sort());
});
