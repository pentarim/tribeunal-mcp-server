import {
  recoverTypedDataAddress,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  parseAbi,
  sha256,
  toHex,
  bytesToHex,
  concatBytes,
  hexToBytes,
  stringToBytes,
} from 'viem';

import { subtle as defaultSubtle } from './webcrypto.js';
import type { SubtleCryptoLike } from './webcrypto.js';

/**
 * A pure, Worker-safe re-implementation of a subset of the app's
 * `tools/ruling-verify.mjs` (design spec 2026-09-26-agent-dispute-tools, §4.4),
 * reached only via a lazy `await import('../verify/ruling-verifier.js')` from
 * `tribeunal_verify_ruling` (Task 5) so `viem` never loads on any other path.
 *
 * Checks 1-9 port the script's logic line for line, with `Buffer`/`node:crypto`
 * replaced by a byte layer (`utf8`/`b64`/`cat`) that keeps this module
 * Worker-safe. Two traps a literal port would hit: viem's `sha256(value)`
 * hex-decodes a string only when it looks like `0x...` hex and hands anything
 * else to noble as-is, so no JS string is ever passed to it directly — every
 * hashed string goes through `utf8()` first; and `sha256` returns `0x`-prefixed
 * hex while the bundle's `digest` is bare (the script itself builds
 * `` `0x${ruling.digest}` `` at its own `:742`).
 *
 * Check 10, `dispute`, is MCP-only (no equivalent in the script): it re-derives
 * the I9 fold (`App\Dispute\DisputeStanding::fold`) over `bundle.dispute` and
 * checks it agrees with itself and the signed verdict — an app-served,
 * unsigned block, never checked against a chain.
 *
 * The constants below are copied verbatim from `tools/ruling-verify.mjs:124-186`
 * — never read off the bundle, never re-derived from anything network-supplied.
 */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// docs/VERDICT_SIGNING.md — App\Ruling\Signing\VerdictTypedData.
const VERDICT_DOMAIN = { name: 'Tribeunal Verdict', version: '1', chainId: 8453 } as const;
const VERDICT_TYPES = {
  Verdict: [
    { name: 'caseId', type: 'bytes16' },
    { name: 'decisionId', type: 'bytes16' },
    { name: 'version', type: 'uint16' },
    { name: 'digest', type: 'bytes32' },
  ],
} as const;

// App\Ruling\Attestation\EasTypedData. `EAS_SCHEMA_UID`/`EAS_RESOLVER`/`EAS_REF_UID`
// are bare hex (no 0x) where that is how EasTypedData itself stores them; every
// other constant below is already 0x-prefixed, matching the bundle's convention.
const EAS_SCHEMA_UID = '4537ff73f7dc5f562875b1b40bd38122add35bb9199a1743ab8a9ca7788f2a29';
const EAS_RESOLVER = '0000000000000000000000000000000000000000';
const EAS_REVOCABLE = false;
const EAS_ATTEST_VERSION = 2;
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
const EAS_RECIPIENT = `0x${EAS_RESOLVER}`; // no recipient — self-addressed to the zero address, like the resolver.
const EAS_EXPIRATION_TIME = 0;
const EAS_REF_UID = `0x${'0'.repeat(64)}`;
const EAS_SALT_PREIMAGE_PREFIX = 'tribeunal/eas/v1|';

// contracts/src/TribeunalLogAnchor.sol — the one fragment this module ever
// calls: `roots(uint64) view returns (bytes32)`, selector `0x1e3f0320`.
const ANCHOR_ABI = parseAbi(['function roots(uint64 treeSize) view returns (bytes32)']);
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const LOG_ORIGIN = 'tribeunal.com/log/v1';
// App\Tlog\TransparencyLog::SOURCE_RULING_LEDGER and the one `kind`
// RulingBundleAssembler ever serves — hardcoded for the same reason every
// other constant in this file is: never trust the bundle's own copy of what
// it claims to be.
const LEAF_SRC_RULING_LEDGER = 'ruling_ledger';
const LEAF_KIND_VERDICT = 'verdict';

const STANDARD_BASE64_32 = /^[A-Za-z0-9+/]{43}=$/;

// RFC 8032 §7.1 TEST 1 public key — used ONLY to probe whether this runtime's
// WebCrypto supports Ed25519 at all (§4.4); never compared against anything
// in a bundle.
const ED25519_PROBE_PUBLIC_KEY_HEX = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';

type Hex = `0x${string}`;

// ------------------------------------------------------------------ byte layer (Buffer-free, Worker-safe)

const utf8 = (s: string): Uint8Array => stringToBytes(s);
const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const cat = (...xs: Uint8Array[]): Uint8Array => concatBytes(xs);
const hexEq = (a: Uint8Array, b: Uint8Array): boolean => bytesToHex(a) === bytesToHex(b);

// ------------------------------------------------------------------ bundle shapes this module reads (structural — never the full API type)

/** One EAS-style signature triple. */
export interface RulingSignature {
  signature: string; // bare hex, no 0x
  signerAddress: string;
}

/** One EIP-712 EAS attestation, as the bundle serves it. */
export interface RulingAttestation {
  schemaUid: string;
  attester: string;
  uid: string;
  signature: { r: string; s: string; v: number };
  message: {
    version: number;
    schema: string;
    recipient: string;
    time: number;
    expirationTime: number;
    revocable: boolean;
    refUID: string;
    data: string;
    salt: string;
  };
}

export interface RulingLogAnchor {
  contract: string;
  checkpoint?: string;
  treeSize: number;
  rootHash: string;
  auditPath?: string[];
  cosignatures?: unknown[];
  txHash?: string;
}

export interface RulingLog {
  status: string;
  sourceId?: string;
  leafData?: string;
  leafHash?: string;
  leafIndex?: number;
  treeSize?: number;
  checkpoint?: string;
  auditPath?: string[];
  cosignatures?: unknown[];
  anchor?: RulingLogAnchor | null;
}

export interface RulingReopenedBy {
  digest: string;
  canonicalJson: string;
  canonicalJsonStatus: string;
}

export interface RulingRecord {
  caseUuid: string;
  decisionUuid: string;
  version: number;
  digest: string; // bare hex, no 0x
  canonicalJson: string;
  canonicalJsonStatus: string;
  evidenceSetHash: string;
  ledgerId: string;
  latest: boolean;
  reopenedBy?: RulingReopenedBy | null;
}

/** One `bundle.dispute.rounds[]` item (App\Ruling\Verification\RulingBundleAssembler::disputeRoundBlock). */
export interface RulingDisputeRound {
  round: number;
  caseUuid: string;
  decisionUuid: string | null;
  digest: string | null;
  panelMode: 'ai' | 'human';
  jurorCount: number;
  minVotes: number;
  closedAt: string | null;
  appealDeadline: string | null;
  outcome: 'decided' | 'void' | null;
  ruling: 0 | 1 | 2 | null;
}

/** `bundle.dispute` (App\Ruling\Verification\RulingBundleAssembler::disputeBlock, spec §2.4/§4.8). */
export interface RulingDisputeBlock {
  disputeUuid: string;
  origin: string;
  enforcement: string;
  consent: string;
  bindingBasis: string;
  round: number;
  rounds: RulingDisputeRound[];
  standingRuling: 0 | 1 | 2 | null;
  basisDecisionUuid: string | null;
  final: boolean;
  finalAt: string | null;
  finalRuling: 0 | 1 | 2 | null;
  finalDecisionUuid: string | null;
  basis: string;
  execution: unknown;
  valueMinor?: string;
  asset?: string;
  valueCapMinor?: string;
}

/** The subset of `GET /api/rulings/{uuid}` this module ever reads. */
export interface VerifiableRulingBundle {
  ruling: RulingRecord;
  signatures?: RulingSignature[];
  attestations?: RulingAttestation[];
  log?: RulingLog;
  dispute?: RulingDisputeBlock | null;
}

export interface SignerDocument {
  address?: string;
}

export interface AnchorDocument {
  contract?: string;
}

// ------------------------------------------------------------------ check harness (ok / FAIL / n/a — the script's own three shapes)

interface Na {
  kind: 'na';
  reason: string;
}

function na(reason: string): Na {
  return { kind: 'na', reason };
}

function isNa(x: unknown): x is Na {
  return typeof x === 'object' && x !== null && (x as { kind?: unknown }).kind === 'na';
}

export interface CheckResult {
  name: string;
  result: 'ok' | 'FAIL' | 'n/a';
  detail: string;
}

async function runCheck(
  name: string,
  fn: () => Promise<boolean | Na> | boolean | Na,
  okDetail = '',
): Promise<CheckResult> {
  let outcome: boolean | Na;
  try {
    outcome = await fn();
  } catch (e) {
    return { name, result: 'FAIL', detail: e instanceof Error ? e.message : String(e) };
  }
  if (isNa(outcome)) {
    return { name, result: 'n/a', detail: outcome.reason };
  }

  return outcome ? { name, result: 'ok', detail: okDetail } : { name, result: 'FAIL', detail: '' };
}

// ------------------------------------------------------------------ checkpoint / vkey parsing (c2sp.org/signed-note), byte-for-byte port

interface Vkey {
  name: string;
  keyId: Uint8Array;
  publicKey: Uint8Array;
}

/** `<name>+<hex key id>+<base64 payload>`; the payload must decode to signature-type 0x01 + a 32-byte Ed25519 public key. */
function parseVkey(vkey: string): Vkey {
  const firstPlus = vkey.indexOf('+');
  const secondPlus = -1 === firstPlus ? -1 : vkey.indexOf('+', firstPlus + 1);
  if (-1 === firstPlus || -1 === secondPlus) {
    throw new Error('log vkey must have the form <name>+<hex key id>+<base64 payload>');
  }
  const name = vkey.slice(0, firstPlus);
  const keyIdHex = vkey.slice(firstPlus + 1, secondPlus);
  const payloadB64 = vkey.slice(secondPlus + 1);
  if (!name || !/^[0-9a-f]{8}$/.test(keyIdHex)) {
    throw new Error('log vkey key id must be 8 lowercase hex chars');
  }
  const payload = b64(payloadB64);
  if (33 !== payload.length || 0x01 !== payload[0]) {
    throw new Error('log vkey payload must decode to signature-type 0x01 + a 32-byte Ed25519 public key');
  }

  return { name, keyId: hexToBytes(`0x${keyIdHex}` as Hex), publicKey: payload.subarray(1) };
}

/** `key ID = SHA-256(key name || 0x0A || 0x01 || public key)[:4]` (c2sp.org/signed-note). */
function computeKeyId(name: string, publicKey: Uint8Array): Uint8Array {
  return sha256(cat(utf8(name), Uint8Array.of(0x0a, 0x01), publicKey), 'bytes').subarray(0, 4);
}

interface ParsedCheckpoint {
  originLine: string;
  sizeLine: string;
  rootLine: string;
  noteText: string;
  sigLines: string[];
}

/** Splits a signed checkpoint at the LAST blank-line separator (c2sp.org/signed-note). */
function parseCheckpoint(raw: string): ParsedCheckpoint {
  const sep = raw.lastIndexOf('\n\n');
  if (-1 === sep) {
    throw new Error('no blank line between the checkpoint note text and its signature block');
  }
  const noteText = raw.slice(0, sep + 1);
  const sigBlock = raw.slice(sep + 2).replace(/\n+$/, '');
  const noteLines = noteText.split('\n');
  noteLines.pop(); // the trailing '' produced by splitting noteText's own final \n
  if (3 !== noteLines.length) {
    throw new Error('checkpoint note text must be exactly three lines: origin, size, root');
  }
  const sigLines = sigBlock.length ? sigBlock.split('\n') : [];
  if (0 === sigLines.length) {
    throw new Error('signed checkpoint has no signature line');
  }

  return { originLine: noteLines[0], sizeLine: noteLines[1], rootLine: noteLines[2], noteText, sigLines };
}

interface ParsedSignatureLine {
  name: string;
  keyId: Uint8Array;
  signature: Uint8Array;
}

/** `— <key name> base64(32-bit key id || signature)`. */
function parseSignatureLine(line: string): ParsedSignatureLine {
  const firstSpace = line.indexOf(' ');
  const secondSpace = -1 === firstSpace ? -1 : line.indexOf(' ', firstSpace + 1);
  if (-1 === firstSpace || -1 === secondSpace || line.slice(0, firstSpace) !== '—') {
    throw new Error('checkpoint signature line must be U+2014, a space, the key name, a space, base64(keyId||signature)');
  }
  const decoded = b64(line.slice(secondSpace + 1));
  if (decoded.length < 5) {
    throw new Error('checkpoint signature line payload too short to hold a key id and a signature');
  }

  return { name: line.slice(firstSpace + 1, secondSpace), keyId: decoded.subarray(0, 4), signature: decoded.subarray(4) };
}

/** The first well-formed signature line whose name/key-id matches `vkey`, or null. */
function findMatchingSignature(sigLines: string[], vkey: Vkey): ParsedSignatureLine | null {
  for (const line of sigLines) {
    try {
      const parsed = parseSignatureLine(line);
      if (parsed.name === vkey.name && hexEq(parsed.keyId, vkey.keyId)) {
        return parsed;
      }
    } catch {
      // Not a well-formed signature line — try the next one.
    }
  }

  return null;
}

/** Strict STANDARD base64 of exactly 32 bytes, or null. */
function decodeRoot32(rootLine: string): Uint8Array | null {
  if (!STANDARD_BASE64_32.test(rootLine)) {
    return null;
  }
  const root = b64(rootLine);

  return 32 === root.length ? root : null;
}

// ------------------------------------------------------------------ RFC 6962 inclusion fold

function sha256LeafHash(leafDataUtf8: string): Uint8Array {
  return sha256(cat(Uint8Array.of(0x00), utf8(leafDataUtf8)), 'bytes');
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(cat(Uint8Array.of(0x01), left, right), 'bytes');
}

/** RFC 6962 §2.1: the largest power of two strictly less than `n` (`n >= 2`). */
function largestPowerOfTwoBelow(n: number): number {
  let k = 1;
  while (k * 2 < n) {
    k *= 2;
  }

  return k;
}

/** RFC 9162 §2.1.3.2 — folds an inclusion (audit) path back to a root and compares it. */
function verifyInclusion(index: number, size: number, leafHashRaw: Uint8Array, path: Uint8Array[], root: Uint8Array): boolean {
  if (index < 0 || size < 1 || index >= size) {
    return false;
  }

  let cursor = 0;
  const recur = (index: number, size: number): Uint8Array => {
    if (1 === size) {
      return leafHashRaw;
    }
    const k = largestPowerOfTwoBelow(size);
    if (index < k) {
      const left = recur(index, k);
      if (cursor >= path.length) {
        return null as unknown as Uint8Array;
      }

      return nodeHash(left, path[cursor++]);
    }
    const right = recur(index - k, size - k);
    if (cursor >= path.length) {
      return null as unknown as Uint8Array;
    }

    return nodeHash(path[cursor++], right);
  };

  const computed = recur(index, size);

  return null !== computed && cursor === path.length && hexEq(root, computed);
}

// ------------------------------------------------------------------ Ed25519 over WebCrypto

/**
 * Once per `verifyBundle()` call (never cached across calls — each call may
 * inject a different `subtle`): imports the RFC 8032 TEST 1 public key to
 * decide whether THIS runtime's WebCrypto supports Ed25519 at all. Only when
 * this probe itself throws is the runtime Ed25519-less; with it passing, a
 * later import/verify failure on the bundle's own key is a real disagreement
 * (FAIL), never a missing-capability n/a (§4.4).
 */
async function ed25519Supported(getSubtle: () => Promise<SubtleCryptoLike>): Promise<boolean> {
  try {
    const s = await getSubtle();
    await s.importKey('raw', hexToBytes(`0x${ED25519_PROBE_PUBLIC_KEY_HEX}` as Hex), { name: 'Ed25519' }, false, ['verify']);

    return true;
  } catch {
    return false;
  }
}

async function ed25519Verify(
  getSubtle: () => Promise<SubtleCryptoLike>,
  publicKeyRaw: Uint8Array,
  messageText: string,
  signature: Uint8Array,
): Promise<boolean> {
  const s = await getSubtle();
  const key = await s.importKey('raw', publicKeyRaw, { name: 'Ed25519' }, false, ['verify']);

  return s.verify('Ed25519', key, signature, utf8(messageText));
}

// ------------------------------------------------------------------ checks 1-9 (ported from tools/ruling-verify.mjs)

/** #1 digest: sha256(canonicalJson) == digest (n/a when redacted/withheld). Never hands the JS string to viem's sha256 directly — always utf8() first. */
function checkDigest(ruling: RulingRecord): boolean | Na {
  if ('served' !== ruling.canonicalJsonStatus) {
    return na(`canonicalJsonStatus=${ruling.canonicalJsonStatus}`);
  }
  const computed = sha256(utf8(ruling.canonicalJson));

  return computed === `0x${ruling.digest}`;
}

/** #2 reopen: `ruling.reopenedBy`'s own pre-image genuinely chains to and reopens THIS verdict. Pure bundle arithmetic — no network. */
function checkReopen(ruling: RulingRecord): boolean | Na {
  const reopenedBy = ruling.reopenedBy;
  if (undefined === reopenedBy) {
    return na('bundle has no reopenedBy field');
  }
  if (null === reopenedBy) {
    return na(true === ruling.latest ? 'not reopened' : 'superseded without a ledgered reopen');
  }
  if ('served' !== reopenedBy.canonicalJsonStatus) {
    return na(`canonicalJsonStatus=${reopenedBy.canonicalJsonStatus}`);
  }
  const computed = sha256(utf8(reopenedBy.canonicalJson));
  if (computed !== `0x${reopenedBy.digest}`) {
    throw new Error('digest');
  }
  const p = JSON.parse(reopenedBy.canonicalJson) as {
    kind?: string;
    schema?: string;
    case?: { uuid?: string };
    previous?: { digest?: string };
    reopens?: { decisionUuid?: string; version?: number };
  };
  if ('reopened' !== p.kind) {
    throw new Error('kind');
  }
  if ('tribeunal.ruling/1' !== p.schema) {
    throw new Error('schema');
  }
  if (p.case?.uuid !== ruling.caseUuid) {
    throw new Error('case.uuid');
  }
  if (p.previous?.digest !== ruling.digest) {
    throw new Error('previous.digest');
  }
  if (p.reopens?.decisionUuid !== ruling.decisionUuid) {
    throw new Error('reopens.decisionUuid');
  }
  if (p.reopens?.version !== ruling.version) {
    throw new Error('reopens.version');
  }
  if (false !== ruling.latest) {
    throw new Error('latest');
  }

  return true;
}

/** #3 signature[i]: recoverTypedDataAddress over the Verdict struct == signerAddress. Every signature that verifies is a candidate for #5's identity comparison. */
async function checkSignature(ruling: RulingRecord, sig: RulingSignature, verifiedIdentities: Set<string>): Promise<boolean> {
  const verdictMessage = {
    caseId: `0x${ruling.caseUuid.replace(/-/g, '')}` as Hex,
    decisionId: `0x${ruling.decisionUuid.replace(/-/g, '')}` as Hex,
    version: ruling.version,
    digest: `0x${ruling.digest}` as Hex,
  };
  const recovered = await recoverTypedDataAddress({
    domain: VERDICT_DOMAIN,
    types: VERDICT_TYPES,
    primaryType: 'Verdict',
    message: verdictMessage,
    signature: `0x${sig.signature}` as Hex,
  });
  const matches = recovered.toLowerCase() === sig.signerAddress.toLowerCase();
  if (matches) {
    verifiedIdentities.add(sig.signerAddress.toLowerCase());
  }

  return matches;
}

/**
 * #4 attestation[i]: recoverTypedDataAddress over EAS Attest == attester; the
 * frozen constants, the re-encoded schema data, the re-derived salt and the
 * re-derived packed uid all equal the bundle's values. Verified attester
 * identities feed the separate `attester` check, in their own set — never
 * `verifiedIdentities`.
 */
async function checkAttestation(
  ruling: RulingRecord,
  att: RulingAttestation,
  verifiedAttesterIdentities: Set<string>,
): Promise<true> {
  if (att.schemaUid.toLowerCase() !== `0x${EAS_SCHEMA_UID}` || att.message.schema.toLowerCase() !== `0x${EAS_SCHEMA_UID}`) {
    throw new Error('schema/schemaUid does not equal the frozen schemaUID');
  }
  if (att.message.recipient.toLowerCase() !== EAS_RECIPIENT) {
    throw new Error('message.recipient does not equal the frozen recipient (zero address)');
  }
  if (att.message.revocable !== EAS_REVOCABLE) {
    throw new Error('message.revocable does not equal the frozen value (false)');
  }
  if (att.message.refUID.toLowerCase() !== EAS_REF_UID) {
    throw new Error('message.refUID does not equal the frozen value (32 zero bytes)');
  }
  if (att.message.expirationTime !== EAS_EXPIRATION_TIME) {
    throw new Error('message.expirationTime does not equal the frozen value (0)');
  }
  if (att.message.version !== EAS_ATTEST_VERSION) {
    throw new Error('message.version (the Attest layout version) does not equal the frozen value (2)');
  }

  const recovered = await recoverTypedDataAddress({
    domain: EAS_DOMAIN,
    types: EAS_TYPES,
    primaryType: 'Attest',
    message: {
      version: att.message.version,
      schema: att.message.schema as Hex,
      recipient: att.message.recipient as Hex,
      time: BigInt(att.message.time),
      expirationTime: BigInt(att.message.expirationTime),
      revocable: att.message.revocable,
      refUID: att.message.refUID as Hex,
      data: att.message.data as Hex,
      salt: att.message.salt as Hex,
    },
    signature: `${att.signature.r}${att.signature.s.slice(2)}${att.signature.v.toString(16).padStart(2, '0')}` as Hex,
  });
  if (recovered.toLowerCase() !== att.attester.toLowerCase()) {
    throw new Error(`recovered address ${recovered} does not equal the claimed attester ${att.attester}`);
  }

  const expectedData = encodeAbiParameters(
    [{ type: 'bytes16' }, { type: 'bytes16' }, { type: 'uint16' }, { type: 'bytes32' }],
    [
      `0x${ruling.caseUuid.replace(/-/g, '')}` as Hex,
      `0x${ruling.decisionUuid.replace(/-/g, '')}` as Hex,
      ruling.version,
      `0x${ruling.digest}` as Hex,
    ],
  );
  if (expectedData.toLowerCase() !== att.message.data.toLowerCase()) {
    throw new Error('message.data does not equal the re-encoded (caseId,decisionId,version,digest) schema tuple');
  }

  const saltPreimage = `${EAS_SALT_PREIMAGE_PREFIX}${ruling.decisionUuid.toLowerCase()}|${ruling.version}|${ruling.digest.toLowerCase()}`;
  const expectedSalt = keccak256(toHex(saltPreimage));
  if (expectedSalt.toLowerCase() !== att.message.salt.toLowerCase()) {
    throw new Error('salt does not equal keccak256("tribeunal/eas/v1|{decisionUuid}|{version}|{digestHex}")');
  }

  // The off-chain uid: packed (not padded), schema packed as the 66 ASCII
  // characters of its "0x..." hex STRING (never the 32 decoded bytes), a
  // hardcoded zero-address attester slot after recipient, and a trailing
  // uint32 0 "bump" (spec §3).
  const packed = encodePacked(
    ['uint16', 'bytes', 'address', 'address', 'uint64', 'uint64', 'bool', 'bytes32', 'bytes', 'bytes32', 'uint32'],
    [
      att.message.version,
      toHex(att.message.schema),
      att.message.recipient as Hex,
      ZERO_ADDRESS,
      BigInt(att.message.time),
      BigInt(att.message.expirationTime),
      att.message.revocable,
      att.message.refUID as Hex,
      att.message.data as Hex,
      att.message.salt as Hex,
      0,
    ],
  );
  const expectedUid = keccak256(packed);
  if (expectedUid.toLowerCase() !== att.uid.toLowerCase()) {
    throw new Error('uid does not equal the re-derived packed keccak256');
  }

  verifiedAttesterIdentities.add(att.attester.toLowerCase());

  return true;
}

/** #5 signer: ok when >=1 cryptographically-verified Verdict signer equals the well-known address; n/a in every other case — never a FAIL (a rotation is expected to produce exactly this). */
function checkSigner(signerDoc: SignerDocument | null, verifiedIdentities: Set<string>): boolean | Na {
  if (null === signerDoc || 'string' !== typeof signerDoc.address) {
    return na('well-known signer document unavailable (404, none, or missing an address)');
  }
  if (0 === verifiedIdentities.size) {
    return na('no cryptographically-verified signature on this ruling to compare');
  }
  if (verifiedIdentities.has(signerDoc.address.toLowerCase())) {
    return true;
  }

  return na(`verified only ${[...verifiedIdentities].join(', ')}, not the well-known address ${signerDoc.address}`);
}

/** #6 attester: the EAS-side twin of #5, over its own `verifiedAttesterIdentities` set — never `verifiedIdentities`. */
function checkAttester(signerDoc: SignerDocument | null, verifiedAttesterIdentities: Set<string>): boolean | Na {
  if (null === signerDoc || 'string' !== typeof signerDoc.address) {
    return na('well-known signer document unavailable (404, none, or missing an address)');
  }
  if (0 === verifiedAttesterIdentities.size) {
    return na('no cryptographically-verified attestation on this ruling to compare');
  }
  if (verifiedAttesterIdentities.has(signerDoc.address.toLowerCase())) {
    return true;
  }

  return na(`attested by ${[...verifiedAttesterIdentities].join(', ')}, not the well-known address ${signerDoc.address}`);
}

/** #7 inclusion: leafHash matches leafData, and the RFC 6962 fold of leafHash+auditPath at leafIndex/treeSize reaches the checkpoint's root. n/a for not_logged/pending_checkpoint. */
function checkInclusion(ruling: RulingRecord, log: RulingLog): boolean | Na {
  if ('not_logged' === log.status || 'pending_checkpoint' === log.status) {
    return na(`log.status=${log.status}`);
  }
  if ('published' !== log.status) {
    throw new Error(`unrecognized log.status "${log.status}"`);
  }
  if ('string' !== typeof log.checkpoint) {
    throw new Error('log.status is published but log.checkpoint is missing');
  }
  if (log.sourceId !== ruling.ledgerId) {
    throw new Error('log.sourceId does not equal ruling.ledgerId');
  }
  let leaf: { src?: string; kind?: string; id?: string; digest?: string; evidenceSetHash?: string };
  try {
    leaf = JSON.parse(log.leafData ?? '');
  } catch (e) {
    throw new Error(`log.leafData does not parse as JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  if (leaf.src !== LEAF_SRC_RULING_LEDGER) {
    throw new Error(`leafData.src != "${LEAF_SRC_RULING_LEDGER}"`);
  }
  if (leaf.kind !== LEAF_KIND_VERDICT) {
    throw new Error(`leafData.kind != "${LEAF_KIND_VERDICT}"`);
  }
  if (leaf.id !== ruling.ledgerId) {
    throw new Error('leafData.id does not equal ruling.ledgerId');
  }
  if (leaf.digest !== ruling.digest) {
    throw new Error('leafData.digest does not equal ruling.digest');
  }
  if (leaf.evidenceSetHash !== ruling.evidenceSetHash) {
    throw new Error('leafData.evidenceSetHash does not equal ruling.evidenceSetHash');
  }
  const cp = parseCheckpoint(log.checkpoint);
  const root = decodeRoot32(cp.rootLine);
  if (null === root) {
    throw new Error('checkpoint root does not decode (standard base64) to exactly 32 bytes');
  }
  const leafHashRaw = b64(log.leafHash ?? '');
  if (!hexEq(sha256LeafHash(log.leafData ?? ''), leafHashRaw)) {
    throw new Error('leafHash != sha256(0x00 || leafData)');
  }
  const path = (log.auditPath ?? []).map((h) => b64(h));
  if (!verifyInclusion(log.leafIndex ?? -1, log.treeSize ?? 0, leafHashRaw, path, root)) {
    throw new Error('the inclusion fold does not reach the checkpoint root');
  }

  return true;
}

/**
 * #8 checkpoint: the log key's Ed25519 signature verifies over the
 * checkpoint's note text, and the note's size equals log.treeSize. n/a when
 * there is no checkpoint to check, no log key to check it against, OR (once
 * every earlier structural check has passed) this runtime's WebCrypto has no
 * Ed25519 at all (the probe, run once by the caller) — never for a real
 * disagreement on a runtime that does support it.
 */
async function checkCheckpoint(
  log: RulingLog,
  logKeyText: string | null,
  getSubtle: () => Promise<SubtleCryptoLike>,
  ed25519Ok: boolean,
): Promise<boolean | Na> {
  if ('published' !== log.status || 'string' !== typeof log.checkpoint) {
    return na(`log.status=${log.status ?? 'unknown'}`);
  }
  if (null === logKeyText) {
    return na('log key well-known document unavailable (404 or none)');
  }
  const vkey = parseVkey(logKeyText.trim());
  if (!hexEq(computeKeyId(vkey.name, vkey.publicKey), vkey.keyId)) {
    throw new Error('log vkey key id != sha256(name||0x0A||0x01||pubkey)[:4]');
  }
  const cp = parseCheckpoint(log.checkpoint);
  if (cp.originLine !== LOG_ORIGIN) {
    throw new Error(`checkpoint origin "${cp.originLine}" != "${LOG_ORIGIN}"`);
  }
  if (String(log.treeSize) !== cp.sizeLine) {
    throw new Error('checkpoint note size != log.treeSize');
  }
  const matched = findMatchingSignature(cp.sigLines, vkey);
  if (null === matched) {
    throw new Error("no checkpoint signature line matches the log key's name/key-id");
  }
  if (!ed25519Ok) {
    return na('this runtime has no Ed25519 in WebCrypto');
  }
  if (!(await ed25519Verify(getSubtle, vkey.publicKey, cp.noteText, matched.signature))) {
    throw new Error('Ed25519 signature does not verify over the checkpoint note text');
  }

  return true;
}

/** Shared precondition for `anchor`: never FAIL, n/a on no rpcUrl / no log.anchor / an unavailable or disagreeing anchor well-known document. */
function anchorPrecondition(rpcUrl: string | null, log: RulingLog, anchorDoc: AnchorDocument | null): Na | null {
  if (!rpcUrl) {
    return na('no rpcUrl given');
  }
  if (null == log.anchor) {
    return na('log.anchor is null (not logged, pending checkpoint, no covering confirmed anchor yet, or anchoring unconfigured)');
  }
  if (null === anchorDoc || 'string' !== typeof anchorDoc.contract) {
    return na('anchor well-known document unavailable (404, none, or missing a contract)');
  }
  if (anchorDoc.contract.toLowerCase() !== log.anchor.contract.toLowerCase()) {
    return na(`anchor well-known document names contract ${anchorDoc.contract}, not the bundle's ${log.anchor.contract}`);
  }

  return null;
}

/**
 * #9 anchor: (1)-(3) locally re-derive and fold `log.anchor.checkpoint`/
 * `.auditPath` to bind THIS ruling's leaf to a genuinely signed checkpoint
 * root — a local disagreement here is a FAIL, never n/a (except no log key
 * at all, which makes the Ed25519 step itself impossible to check). Only
 * once all three hold does (4) re-derive `roots(treeSize)` via one read-only
 * `eth_call` and compare it to `anchor.rootHash` — a transport failure there
 * is n/a, a successful disagreeing answer is FAIL.
 */
async function checkAnchor(
  log: RulingLog,
  logKeyText: string | null,
  anchorDoc: AnchorDocument | null,
  getSubtle: () => Promise<SubtleCryptoLike>,
  ed25519Ok: boolean,
  rpcUrl: string | null,
  rpcCall: (rpcUrl: string, method: string, params: unknown[]) => Promise<unknown>,
): Promise<boolean | Na> {
  const pre = anchorPrecondition(rpcUrl, log, anchorDoc);
  if (null !== pre) {
    return pre;
  }
  const anchor = log.anchor as RulingLogAnchor;

  if (null === logKeyText) {
    return na('log key well-known document unavailable (404 or none)');
  }
  if ('string' !== typeof anchor.checkpoint) {
    throw new Error('log.anchor.checkpoint is missing');
  }
  const anchorCp = parseCheckpoint(anchor.checkpoint);
  if (anchorCp.originLine !== LOG_ORIGIN) {
    throw new Error(`anchor checkpoint origin "${anchorCp.originLine}" != "${LOG_ORIGIN}"`);
  }
  if (String(anchor.treeSize) !== anchorCp.sizeLine) {
    throw new Error('anchor checkpoint note size != anchor.treeSize');
  }
  const anchorRoot = decodeRoot32(anchorCp.rootLine);
  if (null === anchorRoot) {
    throw new Error('anchor checkpoint root does not decode (standard base64) to exactly 32 bytes');
  }
  if (`0x${bytesToHex(anchorRoot).slice(2)}` !== anchor.rootHash.toLowerCase()) {
    throw new Error('anchor checkpoint root does not equal anchor.rootHash');
  }
  const anchorVkey = parseVkey(logKeyText.trim());
  if (!hexEq(computeKeyId(anchorVkey.name, anchorVkey.publicKey), anchorVkey.keyId)) {
    throw new Error('log vkey key id != sha256(name||0x0A||0x01||pubkey)[:4]');
  }
  const anchorMatched = findMatchingSignature(anchorCp.sigLines, anchorVkey);
  if (null === anchorMatched) {
    throw new Error("no anchor checkpoint signature line matches the log key's name/key-id");
  }
  if (!ed25519Ok) {
    return na('this runtime has no Ed25519 in WebCrypto');
  }
  if (!(await ed25519Verify(getSubtle, anchorVkey.publicKey, anchorCp.noteText, anchorMatched.signature))) {
    throw new Error('Ed25519 signature does not verify over the anchor checkpoint note text');
  }
  if (!Array.isArray(anchor.auditPath)) {
    throw new Error('log.anchor.auditPath is missing');
  }
  const anchorLeafHashRaw = b64(String(log.leafHash));
  const anchorPath = anchor.auditPath.map((h) => b64(h));
  if (!verifyInclusion(log.leafIndex ?? -1, anchor.treeSize, anchorLeafHashRaw, anchorPath, anchorRoot)) {
    throw new Error('the inclusion fold of log.leafHash + anchor.auditPath does not reach the anchor checkpoint root');
  }

  // (4): the on-chain root at this size must equal the now locally-proven anchor.rootHash.
  let wordHex: string;
  try {
    const dataHex = encodeFunctionData({ abi: ANCHOR_ABI, functionName: 'roots', args: [BigInt(anchor.treeSize)] });
    const result = await rpcCall(rpcUrl as string, 'eth_call', [{ to: anchor.contract, data: dataHex }, 'latest']);
    wordHex = String(result ?? '0x');
  } catch (e) {
    return na(`RPC call failed (${e instanceof Error ? e.message : String(e)})`);
  }

  if (64 !== wordHex.replace(/^0x/, '').length) {
    throw new Error(`no contract at ${anchor.contract} answered a 32-byte word (got ${wordHex.replace(/^0x/, '').length / 2} bytes)`);
  }
  if (wordHex.toLowerCase() === ZERO_BYTES32) {
    throw new Error(`no root anchored at size ${anchor.treeSize}`);
  }
  if (wordHex.toLowerCase() !== anchor.rootHash.toLowerCase()) {
    throw new Error(`roots(${anchor.treeSize}) returned ${wordHex}, bundle claims ${anchor.rootHash}`);
  }

  return true;
}

// ------------------------------------------------------------------ #10 dispute (MCP-only) — the I9 fold, App\Dispute\DisputeStanding::fold ported

/** `App\Dispute\DisputeStanding::fold()`: standing(0) = ruling(0); for round N >= 1, a decided ruling (1 or 2) becomes the new standing and its basis; a Void ruling (0) never changes either (I9). */
function foldStanding(rulings: Array<0 | 1 | 2>): { ruling: 0 | 1 | 2; basisRound: number } {
  let ruling = rulings[0];
  let basisRound = 0;
  for (let round = 1; round < rulings.length; round++) {
    const roundRuling = rulings[round];
    if (1 === roundRuling || 2 === roundRuling) {
      ruling = roundRuling;
      basisRound = round;
    }
  }

  return { ruling, basisRound };
}

/**
 * #10 dispute: MCP-only, no equivalent in `tools/ruling-verify.mjs`. n/a when
 * `bundle.dispute` is absent or null. Otherwise FAILs on the first
 * disagreement between the dispute block and itself / the signed verdict
 * (spec §4.4); on success its `detail` always ends "app-served, unsigned
 * block: consistent with itself and the signed verdict, not checked against
 * a chain" (attached by the caller, not here) — this check never reaches a
 * chain.
 */
function checkDispute(ruling: RulingRecord, dispute: RulingDisputeBlock | null | undefined): boolean | Na {
  if (null === dispute || undefined === dispute) {
    return na('bundle.dispute is absent or null');
  }

  const rounds = dispute.rounds;
  for (let i = 0; i < rounds.length; i++) {
    if (rounds[i].round !== i) {
      throw new Error(`rounds[${i}].round !== ${i}`);
    }
  }
  const row = rounds.find((r) => r.round === dispute.round);
  if (undefined === row) {
    throw new Error(`no row for dispute.round ${dispute.round}`);
  }
  if (row.decisionUuid !== ruling.decisionUuid) {
    throw new Error("the current round's decisionUuid differs from the ruling's");
  }
  if (row.caseUuid !== ruling.caseUuid) {
    throw new Error("the current round's caseUuid differs from the ruling's");
  }
  if (null !== row.digest && row.digest !== ruling.digest) {
    throw new Error("the current round's digest is neither null nor the ruling's");
  }

  for (const r of rounds) {
    const decided = 1 === r.ruling || 2 === r.ruling;
    const isVoid = 0 === r.ruling;
    if ('decided' === r.outcome && !decided) {
      throw new Error(`round ${r.round} outcome "decided" disagrees with ruling ${r.ruling}`);
    }
    if ('void' === r.outcome && !isVoid) {
      throw new Error(`round ${r.round} outcome "void" disagrees with ruling ${r.ruling}`);
    }
    if (null === r.outcome && null !== r.ruling) {
      throw new Error(`round ${r.round} outcome is null but ruling is ${r.ruling}`);
    }
    if (null !== r.ruling && null === r.outcome) {
      throw new Error(`round ${r.round} has a ruling but no outcome`);
    }
  }

  if ('served' === ruling.canonicalJsonStatus) {
    const parsed = JSON.parse(ruling.canonicalJson) as {
      verdict?: { decided?: boolean; decidedAt?: string | null; sides?: Array<{ isWinner?: boolean }> };
    };
    const verdict = parsed.verdict ?? {};
    const winners = (verdict.sides ?? []).filter((s) => true === s.isWinner).length;
    const verdictDecided = true === verdict.decided && 1 === winners;
    if (('decided' === row.outcome) !== verdictDecided) {
      throw new Error("the current round's outcome disagrees with the signed verdict's decided/isWinner");
    }
    if (null !== row.closedAt && null != verdict.decidedAt) {
      if (new Date(row.closedAt).getTime() !== new Date(verdict.decidedAt).getTime()) {
        throw new Error("the current round's closedAt differs from the signed verdict's decidedAt");
      }
    }
  }

  const closedRulings: Array<0 | 1 | 2> = [];
  for (const r of rounds) {
    if (null === r.ruling) {
      break;
    }
    closedRulings.push(r.ruling);
  }

  if (closedRulings.length > 0) {
    const fold = foldStanding(closedRulings);
    if (fold.ruling !== dispute.standingRuling) {
      throw new Error('the I9 fold disagrees with standingRuling');
    }
    const basisRow = rounds[fold.basisRound];
    if ((basisRow?.decisionUuid ?? null) !== dispute.basisDecisionUuid) {
      throw new Error("the fold's basis round disagrees with basisDecisionUuid");
    }
    if (dispute.final) {
      if (null === dispute.finalAt) {
        throw new Error('final is true but finalAt is null');
      }
      if (dispute.finalRuling !== fold.ruling || dispute.finalDecisionUuid !== (basisRow?.decisionUuid ?? null)) {
        throw new Error('finalRuling/finalDecisionUuid disagree with the standing ruling and its basis');
      }
    }
  } else if (dispute.final) {
    throw new Error('final is true but no round has closed');
  }

  if (!dispute.final && (null !== dispute.finalAt || null !== dispute.finalRuling || null !== dispute.finalDecisionUuid)) {
    throw new Error('final is false but finalAt/finalRuling/finalDecisionUuid is set');
  }

  return true;
}

const DISPUTE_OK_DETAIL_BASE =
  'app-served, unsigned block: consistent with itself and the signed verdict, not checked against a chain';

function disputeOkDetail(dispute: RulingDisputeBlock | null | undefined): string {
  if (dispute && null !== dispute.execution && undefined !== dispute.execution) {
    return `${DISPUTE_OK_DETAIL_BASE}; execution: ${JSON.stringify(dispute.execution)}`;
  }

  return DISPUTE_OK_DETAIL_BASE;
}

// ------------------------------------------------------------------ default rpcCall (global fetch, no credentials, 15s timeout)

async function defaultRpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`${method}: HTTP ${res.status}`);
  }
  const decoded = (await res.json()) as { error?: { message?: string }; result?: unknown } | null;
  if (decoded && decoded.error) {
    throw new Error(`${method}: ${decoded.error.message ?? 'unknown JSON-RPC error'}`);
  }

  return decoded ? decoded.result : null;
}

// ------------------------------------------------------------------ verifyBundle()

export interface VerifyBundleParams {
  bundle: VerifiableRulingBundle;
  signerDoc: SignerDocument | null;
  logKeyText: string | null;
  anchorDoc: AnchorDocument | null;
  rpcUrl?: string | null;
  rpcCall?: (rpcUrl: string, method: string, params: unknown[]) => Promise<unknown>;
  subtle?: () => Promise<SubtleCryptoLike>;
}

export interface VerifyBundleResult {
  ok: boolean;
  checks: CheckResult[];
  independent: false;
  witnesses: { log: number; anchor: number; verified: false };
}

/**
 * Recomputes a subset of `tools/ruling-verify.mjs`'s checks over an already-
 * fetched ruling bundle (the caller — `tribeunal_verify_ruling`, Task 5 — owns
 * every network call: fetching the bundle and the three well-knowns, and the
 * one `eth_call` `rpcCall` makes). Pure apart from `rpcCall` (default: global
 * `fetch`, POST, no credentials, a 15s timeout) and `subtle` (default: this
 * runtime's WebCrypto), so tests inject both and never touch a network.
 */
export async function verifyBundle(params: VerifyBundleParams): Promise<VerifyBundleResult> {
  const { bundle, signerDoc, logKeyText, anchorDoc } = params;
  const rpcUrl = params.rpcUrl ?? null;
  const rpcCall = params.rpcCall ?? defaultRpcCall;
  const getSubtle = params.subtle ?? defaultSubtle;

  const ruling = bundle.ruling;
  const signatures = Array.isArray(bundle.signatures) ? bundle.signatures : [];
  const attestations = Array.isArray(bundle.attestations) ? bundle.attestations : [];
  const log: RulingLog = bundle.log ?? { status: 'not_logged' };

  const checks: CheckResult[] = [];
  const verifiedIdentities = new Set<string>();
  const verifiedAttesterIdentities = new Set<string>();

  checks.push(await runCheck('digest', () => checkDigest(ruling)));
  checks.push(await runCheck('reopen', () => checkReopen(ruling)));

  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    checks.push(await runCheck(`signature[${i}]`, () => checkSignature(ruling, sig, verifiedIdentities)));
  }
  for (let i = 0; i < attestations.length; i++) {
    const att = attestations[i];
    checks.push(await runCheck(`attestation[${i}]`, () => checkAttestation(ruling, att, verifiedAttesterIdentities)));
  }

  checks.push(await runCheck('signer', () => checkSigner(signerDoc, verifiedIdentities)));
  checks.push(await runCheck('attester', () => checkAttester(signerDoc, verifiedAttesterIdentities)));
  checks.push(await runCheck('inclusion', () => checkInclusion(ruling, log)));

  const ed25519Ok = await ed25519Supported(getSubtle);
  checks.push(await runCheck('checkpoint', () => checkCheckpoint(log, logKeyText, getSubtle, ed25519Ok)));
  checks.push(
    await runCheck('anchor', () => checkAnchor(log, logKeyText, anchorDoc, getSubtle, ed25519Ok, rpcUrl, rpcCall)),
  );

  checks.push(await runCheck('dispute', () => checkDispute(ruling, bundle.dispute), disputeOkDetail(bundle.dispute)));

  const witnesses = {
    log: Array.isArray(log.cosignatures) ? log.cosignatures.length : 0,
    anchor: Array.isArray(log.anchor?.cosignatures) ? (log.anchor as RulingLogAnchor).cosignatures!.length : 0,
    verified: false as const,
  };

  return {
    ok: !checks.some((c) => 'FAIL' === c.result),
    checks,
    independent: false,
    witnesses,
  };
}
