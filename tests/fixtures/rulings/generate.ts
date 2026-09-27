// tests/fixtures/rulings/generate.ts — deterministic fixture generator for
// tests/verify-ruling.test.ts (design spec 2026-09-26-agent-dispute-tools, §8.1).
//
// Signs the Verdict and EAS typed data with the PUBLIC Anvil/Hardhat default
// account #0 (private key 0xac0974...ff80 — a well-known test-only key, never
// a real secret) and signs the transparency-log checkpoint notes with a fixed,
// locally-derived Ed25519 keypair (a sha256 digest of a fixed string, never a
// production key). No dev data of any kind is read or embedded.
//
// Run with: node --import tsx tests/fixtures/rulings/generate.ts
// A second run reproduces byte-identical files (nothing here reads the clock
// or any source of randomness).
//
// This script deliberately duplicates the handful of frozen constants
// (`EAS_SCHEMA_UID`, the two domains/types, the salt prefix) that
// `src/verify/ruling-verifier.ts` also copies from the app's
// `tools/ruling-verify.mjs:124-186` — both are independent, hand-checked
// transcriptions of the same frozen source, never one importing the other.

import { createHash, createPrivateKey, createPublicKey, sign as ed25519SignRaw } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  encodeAbiParameters,
  encodePacked,
  hexToSignature,
  keccak256,
  toHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

// Anvil/Hardhat's well-known default account #0 — public, test-only, never a secret.
const ANVIL_KEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const account = privateKeyToAccount(ANVIL_KEY_0);

const VERDICT_DOMAIN = { name: 'Tribeunal Verdict', version: '1', chainId: 8453 } as const;
const VERDICT_TYPES = {
  Verdict: [
    { name: 'caseId', type: 'bytes16' },
    { name: 'decisionId', type: 'bytes16' },
    { name: 'version', type: 'uint16' },
    { name: 'digest', type: 'bytes32' },
  ],
} as const;

const EAS_SCHEMA_UID = '4537ff73f7dc5f562875b1b40bd38122add35bb9199a1743ab8a9ca7788f2a29';
const EAS_RESOLVER = '0000000000000000000000000000000000000000';
const EAS_RECIPIENT = `0x${EAS_RESOLVER}` as Hex;
const EAS_REF_UID = `0x${'0'.repeat(64)}` as Hex;
const EAS_DOMAIN = {
  name: 'EAS Attestation',
  version: '1.0.1',
  chainId: 8453,
  verifyingContract: '0x4200000000000000000000000000000000000021',
} as const;
const EAS_TYPES = {
  Attest: [
    { name: 'version', type: 'uint16' },
    { name: 'schema', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'time', type: 'uint64' },
    { name: 'expirationTime', type: 'uint64' },
    { name: 'revocable', type: 'bool' },
    { name: 'refUID', type: 'bytes32' },
    { name: 'data', type: 'bytes' },
    { name: 'salt', type: 'bytes32' },
  ],
} as const;
const EAS_SALT_PREIMAGE_PREFIX = 'tribeunal/eas/v1|';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const LOG_ORIGIN = 'tribeunal.com/log/v1';

function sha256Hex(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

// ------------------------------------------------------------------ a fixed, non-production Ed25519 log key

/** RFC 8410 PKCS8 DER prefix for a raw 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
/** RFC 8410 SPKI DER prefix for a raw 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function loadEd25519(): { privateKey: ReturnType<typeof createPrivateKey>; publicKey: Uint8Array } {
  // A fixed, deterministic, non-production seed — sha256 of a fixed label,
  // never randomness and never a real key.
  const seed = createHash('sha256').update('tribeunal-mcp-server fixture log key seed, 2026-09-26').digest();
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicKeyObj = createPublicKey(privateKey);
  const spki = publicKeyObj.export({ format: 'der', type: 'spki' }) as Buffer;
  const publicKey = new Uint8Array(spki.subarray(spki.length - 32));

  return { privateKey, publicKey };
}

function ed25519Sign(privateKey: ReturnType<typeof createPrivateKey>, messageUtf8: string): Uint8Array {
  return new Uint8Array(ed25519SignRaw(null, Buffer.from(messageUtf8, 'utf8'), privateKey));
}

/** `key ID = SHA-256(key name || 0x0A || 0x01 || public key)[:4]` (c2sp.org/signed-note). */
function computeKeyId(name: string, publicKey: Uint8Array): Uint8Array {
  return new Uint8Array(
    createHash('sha256')
      .update(Buffer.from(name, 'utf8'))
      .update(Buffer.from([0x0a, 0x01]))
      .update(publicKey)
      .digest()
      .subarray(0, 4),
  );
}

/** One c2sp.org/signed-note checkpoint: `<origin>\n<size>\n<root(b64)>\n\n— <name> <b64(keyId||sig)>\n`. */
function signCheckpoint(privateKey: unknown, name: string, keyId: Uint8Array, size: number, root: Uint8Array): string {
  const noteText = `${LOG_ORIGIN}\n${size}\n${b64(root)}\n`;
  const signature = ed25519Sign(privateKey, noteText);
  const payload = new Uint8Array([...keyId, ...signature]);

  return `${noteText}\n— ${name} ${b64(payload)}\n`;
}

// ------------------------------------------------------------------ EAS attestation helpers (mirrors ruling-verifier.ts's checkAttestation, in reverse)

function easData(caseUuid: string, decisionUuid: string, version: number, digest: string): Hex {
  return encodeAbiParameters(
    [{ type: 'bytes16' }, { type: 'bytes16' }, { type: 'uint16' }, { type: 'bytes32' }],
    [`0x${caseUuid.replace(/-/g, '')}` as Hex, `0x${decisionUuid.replace(/-/g, '')}` as Hex, version, `0x${digest}` as Hex],
  );
}

function easSalt(decisionUuid: string, version: number, digest: string): Hex {
  const preimage = `${EAS_SALT_PREIMAGE_PREFIX}${decisionUuid.toLowerCase()}|${version}|${digest.toLowerCase()}`;

  return keccak256(toHex(preimage));
}

function easUid(version: number, schema: Hex, recipient: Hex, time: number, expirationTime: number, data: Hex, salt: Hex): Hex {
  const packed = encodePacked(
    ['uint16', 'bytes', 'address', 'address', 'uint64', 'uint64', 'bool', 'bytes32', 'bytes', 'bytes32', 'uint32'],
    [version, toHex(schema), recipient, ZERO_ADDRESS, BigInt(time), BigInt(expirationTime), false, EAS_REF_UID, data, salt, 0],
  );

  return keccak256(packed);
}

// ------------------------------------------------------------------ main

async function main() {
  const { privateKey: logPrivateKey, publicKey: logPublicKey } = loadEd25519();
  const LOG_KEY_NAME = 'tribeunal-log-fixture';
  const logKeyId = computeKeyId(LOG_KEY_NAME, logPublicKey);

  // --- round 0 (claimant wins) -------------------------------------------------
  const caseUuid0 = '11111111-1111-4111-8111-111111111111';
  const decisionUuid0 = '22222222-2222-4222-8222-222222222222';
  const digest0 = sha256Hex('round-0 fixture verdict — arbitrary, never verified on its own');

  // --- round 1 (respondent wins; this is THIS bundle's own ruling) -----------
  const caseUuid1 = '33333333-3333-4333-8333-333333333333';
  const decisionUuid1 = '44444444-4444-4444-8444-444444444444';
  const ledgerId1 = '66666666-6666-4666-8666-666666666666';
  const disputeUuid = '55555555-5555-4555-8555-555555555555';
  const version1 = 1;
  const decidedAt = '2026-09-27T12:00:00Z';

  const canonicalJson1 = JSON.stringify({
    capture: 'live',
    case: {
      arbitrationMode: true,
      decisionRequirement: 'simple',
      descriptionHash: sha256Hex('Lieferung fehlt — ü'),
      minVotes: 5,
      // Deliberately non-ASCII (the UTF-8 byte-path trap, spec §4.4): a
      // literal port that hands this string to viem's `sha256` directly
      // (instead of `stringToBytes()` first) computes the wrong digest.
      title: 'Lieferung fehlt — ü',
      uuid: caseUuid1,
      visibility: 'private',
    },
    evidence: { items: [], setHash: sha256Hex('fixture evidence set') },
    kind: 'verdict',
    previous: null,
    recordedAt: decidedAt,
    salt: 'fixture-salt-round-1',
    schema: 'tribeunal.ruling/1',
    source: 'real',
    verdict: {
      decided: true,
      decisionUuid: decisionUuid1,
      type: 2,
      typeName: 'respondent',
      name: 'Keep the payment',
      text: null,
      winningSides: [{ uuid: 'side-respondent', name: 'Keep the payment' }],
      sides: [
        { uuid: 'side-claimant', name: 'Refund the buyer', totalVotes: 2, votePercentage: 40, isWinner: false },
        { uuid: 'side-respondent', name: 'Keep the payment', totalVotes: 3, votePercentage: 60, isWinner: true },
      ],
      totalVotes: 5,
      decidedAt,
      version: version1,
      supersededVerdicts: [],
      voidReason: null,
      quorum: { required: 5, received: 5 },
      voterBreakdown: { human: 5, ai: 0, guest: 0 },
    },
  });
  const digest1 = sha256Hex(canonicalJson1);

  const verdictSig1 = await account.signTypedData({
    domain: VERDICT_DOMAIN,
    types: VERDICT_TYPES,
    primaryType: 'Verdict',
    message: {
      caseId: `0x${caseUuid1.replace(/-/g, '')}` as Hex,
      decisionId: `0x${decisionUuid1.replace(/-/g, '')}` as Hex,
      version: version1,
      digest: `0x${digest1}` as Hex,
    },
  });

  const attTime1 = 1790000000;
  const attData1 = easData(caseUuid1, decisionUuid1, version1, digest1);
  const attSalt1 = easSalt(decisionUuid1, version1, digest1);
  const attUid1 = easUid(2, `0x${EAS_SCHEMA_UID}` as Hex, EAS_RECIPIENT, attTime1, 0, attData1, attSalt1);
  const attSig1 = await account.signTypedData({
    domain: EAS_DOMAIN,
    types: EAS_TYPES,
    primaryType: 'Attest',
    message: {
      version: 2,
      schema: `0x${EAS_SCHEMA_UID}` as Hex,
      recipient: EAS_RECIPIENT,
      time: attTime1,
      expirationTime: 0,
      revocable: false,
      refUID: EAS_REF_UID,
      data: attData1,
      salt: attSalt1,
    },
  });
  const { r: attR1, s: attS1, v: attV1Raw } = hexToSignature(attSig1);
  const attV1 = Number(attV1Raw);

  const evidenceSetHash1 = sha256Hex('fixture evidence set');
  const leafData1 = JSON.stringify({
    src: 'ruling_ledger',
    kind: 'verdict',
    id: ledgerId1,
    digest: digest1,
    evidenceSetHash: evidenceSetHash1,
  });
  const leafHash1 = new Uint8Array(createHash('sha256').update(Buffer.from([0x00])).update(Buffer.from(leafData1, 'utf8')).digest());
  // treeSize 1: the checkpoint root is the leaf hash itself (an empty audit path).
  const checkpoint1 = signCheckpoint(logPrivateKey, LOG_KEY_NAME, logKeyId, 1, leafHash1);
  const anchorContract = '0x1111111111111111111111111111111111111111';
  const anchorCheckpoint1 = signCheckpoint(logPrivateKey, LOG_KEY_NAME, logKeyId, 1, leafHash1);
  const anchorRootHash = `0x${Buffer.from(leafHash1).toString('hex')}`;

  const rulingCommon = {
    caseUuid: caseUuid1,
    decisionUuid: decisionUuid1,
    version: version1,
    digest: digest1,
    canonicalJson: canonicalJson1,
    canonicalJsonStatus: 'served',
    evidenceSetHash: evidenceSetHash1,
    ledgerId: ledgerId1,
    latest: true,
  };

  const published = {
    ruling: { ...rulingCommon, reopenedBy: null },
    signatures: [{ signature: verdictSig1.slice(2), signerAddress: account.address }],
    attestations: [
      {
        schemaUid: `0x${EAS_SCHEMA_UID}`,
        attester: account.address,
        uid: attUid1,
        signature: { r: attR1, s: attS1, v: attV1 },
        message: {
          version: 2,
          schema: `0x${EAS_SCHEMA_UID}`,
          recipient: EAS_RECIPIENT,
          time: attTime1,
          expirationTime: 0,
          revocable: false,
          refUID: EAS_REF_UID,
          data: attData1,
          salt: attSalt1,
        },
      },
    ],
    log: {
      status: 'published',
      sourceId: ledgerId1,
      leafData: leafData1,
      leafHash: b64(leafHash1),
      leafIndex: 0,
      treeSize: 1,
      checkpoint: checkpoint1,
      auditPath: [] as string[],
      cosignatures: [] as unknown[],
      anchor: {
        contract: anchorContract,
        checkpoint: anchorCheckpoint1,
        treeSize: 1,
        rootHash: anchorRootHash,
        auditPath: [] as string[],
        cosignatures: [] as unknown[],
      },
    },
    dispute: {
      disputeUuid,
      origin: 'offchain',
      enforcement: 'none',
      consent: 'claimant_only',
      bindingBasis: 'advisory',
      round: 1,
      rounds: [
        {
          round: 0,
          caseUuid: caseUuid0,
          decisionUuid: decisionUuid0,
          digest: digest0,
          panelMode: 'ai',
          jurorCount: 3,
          minVotes: 2,
          closedAt: '2026-09-27T11:00:00Z',
          appealDeadline: '2026-09-27T11:01:00Z',
          outcome: 'decided',
          ruling: 1,
        },
        {
          round: 1,
          caseUuid: caseUuid1,
          decisionUuid: decisionUuid1,
          digest: digest1,
          panelMode: 'human',
          jurorCount: 9,
          minVotes: 5,
          closedAt: decidedAt,
          appealDeadline: null,
          outcome: 'decided',
          ruling: 2,
        },
      ],
      standingRuling: 2,
      basisDecisionUuid: decisionUuid1,
      final: true,
      finalAt: '2026-09-27T11:01:01Z',
      finalRuling: 2,
      finalDecisionUuid: decisionUuid1,
      basis: 'app-window',
      execution: null,
      valueMinor: '1500000',
      asset: 'USDC',
      valueCapMinor: '2000000000',
    },
  };

  const notLogged = {
    ...published,
    log: { status: 'not_logged' },
  };

  // --- a separately reopened ruling (round 0's own verdict, later superseded) --
  const caseUuid2 = '77777777-7777-4777-8777-777777777777';
  const decisionUuid2 = '88888888-8888-4888-8888-888888888888';
  const canonicalJson2 = JSON.stringify({
    capture: 'live',
    case: { arbitrationMode: false, decisionRequirement: 'simple', descriptionHash: null, minVotes: 3, title: 'Reopened fixture case', uuid: caseUuid2, visibility: 'private' },
    evidence: { items: [], setHash: sha256Hex('fixture evidence set 2') },
    kind: 'verdict',
    previous: null,
    recordedAt: '2026-09-20T09:00:00Z',
    salt: 'fixture-salt-round-2',
    schema: 'tribeunal.ruling/1',
    source: 'real',
    verdict: {
      decided: true,
      decisionUuid: decisionUuid2,
      type: 1,
      typeName: 'claimant',
      name: 'Refund the buyer',
      text: null,
      winningSides: [{ uuid: 'side-claimant', name: 'Refund the buyer' }],
      sides: [{ uuid: 'side-claimant', name: 'Refund the buyer', totalVotes: 3, votePercentage: 100, isWinner: true }],
      totalVotes: 3,
      decidedAt: '2026-09-20T09:00:00Z',
      version: 1,
      supersededVerdicts: [],
      voidReason: null,
      quorum: { required: 3, received: 3 },
      voterBreakdown: { human: 3, ai: 0, guest: 0 },
    },
  });
  const digest2 = sha256Hex(canonicalJson2);
  const reopenPreimage = JSON.stringify({
    capture: 'live',
    case: { uuid: caseUuid2 },
    kind: 'reopened',
    previous: { digest: digest2 },
    recordedAt: '2026-09-21T09:00:00Z',
    reopens: { decisionUuid: decisionUuid2, version: 1 },
    salt: 'fixture-reopen-salt',
    schema: 'tribeunal.ruling/1',
    source: 'real',
  });
  const reopenDigest = sha256Hex(reopenPreimage);

  const reopened = {
    ruling: {
      caseUuid: caseUuid2,
      decisionUuid: decisionUuid2,
      version: 1,
      digest: digest2,
      canonicalJson: canonicalJson2,
      canonicalJsonStatus: 'served',
      evidenceSetHash: sha256Hex('fixture evidence set 2'),
      ledgerId: '99999999-9999-4999-8999-999999999999',
      latest: false,
      reopenedBy: {
        digest: reopenDigest,
        canonicalJson: reopenPreimage,
        canonicalJsonStatus: 'served',
      },
    },
    signatures: [] as unknown[],
    attestations: [] as unknown[],
    log: { status: 'not_logged' },
    dispute: null,
  };

  const signer = { address: account.address };
  const logKeyText = `${LOG_KEY_NAME}+${Buffer.from(logKeyId).toString('hex')}+${b64(new Uint8Array([0x01, ...logPublicKey]))}\n`;
  const anchorDoc = { contract: anchorContract };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'published.json'), `${JSON.stringify(published, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, 'not-logged.json'), `${JSON.stringify(notLogged, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, 'reopened.json'), `${JSON.stringify(reopened, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, 'signer.json'), `${JSON.stringify(signer, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, 'log-key.txt'), logKeyText);
  writeFileSync(join(OUT_DIR, 'anchor-doc.json'), `${JSON.stringify(anchorDoc, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log('wrote published.json, not-logged.json, reopened.json, signer.json, log-key.txt, anchor-doc.json');
}

await main();
