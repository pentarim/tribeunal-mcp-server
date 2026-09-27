import { z } from 'zod';

import { TribeunalAPIError } from '../client/api-client.js';
import type { DisputeAppealResult, DisputeDocument, DisputeFilingResult } from '../client/api-client.js';
import { subtle } from '../verify/webcrypto.js';
import { disputeUuid, UUID_RE } from './uuid.js';

// Agent dispute tools — schemas, honesty rows, error wrapping, result shaping
// and the local content-hash check shared by tribeunal_open_dispute,
// tribeunal_submit_evidence, tribeunal_await_ruling, tribeunal_verify_ruling
// and tribeunal_appeal_ruling (design spec 2026-09-26-agent-dispute-tools,
// §3/§4). `awaitRuling()`/`rulingHeadline()` live here too but are added by
// the task that builds tribeunal_await_ruling on top of this file.

/** The app's hard value cap, mirrored client-side so an over-cap open never reaches the network (I6). */
export const DISPUTE_VALUE_CAP_MINOR = '2000000000';

export const DESC = {
  disputeUuid: "The dispute's uuid (disputeUuid from tribeunal_open_dispute or a dispute.opened webhook) — not a case uuid.",
  title: 'The dispute in one line, 3-200 characters; it becomes the title of every round case.',
  claim: 'What was agreed, what happened and what you want, 1-8000 characters. With the filings it is the whole brief the panel reads: name the gaps instead of inventing facts.',
  respondent: 'The counterparty. It must hold a Tribeunal account; it is not asked to consent and is not emailed.',
  respondentUsername: "The respondent's Tribeunal username (not yours, not tribeunal-arbiter).",
  claimantLabel: 'Your side, phrased as a remedy ("Refund the buyer"), 1-255 characters, different from respondentLabel.',
  respondentLabel: 'The other side, phrased as a remedy ("Keep the payment"), 1-255 characters.',
  panel: '"fast_track": 3 AI jurors, seated once the filing window (panelOpensAt) passes. "human": a panel invited from the operator\'s human pool; with no pool configured the round opens unstaffed and closes Void. Required, no default.',
  valueMinor: 'Disputed amount in minor units of asset as a decimal string (USDC has 6 decimals: "1500000" = 1.5 USDC). Defaults to "0"; at most 2000000000 (2000 USDC).',
  asset: 'Currency of valueMinor. Only "USDC".',
  x402Receipt: 'A settled x402 exact-scheme payment, filed as evidence. Checked for shape here and recorded "unchecked" by the server; at open, valueMinor may not exceed its value.',
  network: 'CAIP-2 chain id, e.g. "eip155:8453".',
  transaction: 'Settlement transaction hash: 0x + 64 hex.',
  nonce: 'EIP-3009 authorization nonce: 0x + 64 hex.',
  payer: 'Payer address (authorization.from): 0x + 40 hex. Recorded as a claimed wallet, unverified.',
  payTo: 'Payee address (authorization.to): 0x + 40 hex.',
  receiptAsset: 'Token contract address: 0x + 40 hex.',
  value: "Amount paid, in the token's minor units, as a decimal string.",
  validAfter: 'Authorization validAfter, unix seconds, decimal string.',
  validBefore: 'Authorization validBefore, unix seconds, decimal string.',
  resource: 'URL of the paid resource: printable ASCII, 1-2048 characters.',
  text: 'Evidence text, 1-5000 characters. Omit when filing x402Receipt.',
  until: '"provisional" (default): wake on the latest round\'s verdict. "final": wake only once the dispute is recorded as having no further appeal.',
  timeoutSeconds: 'Seconds to block, 5-170; defaults to 150. Returns at once when the awaited state already holds.',
  decisionUuid: "A ruling's decisionUuid (from tribeunal_await_ruling or tribeunal_await_verdict). Omit when passing bundleUrl.",
  bundleUrl: 'A ruling bundle or page URL on this server\'s host (…/api/rulings/{uuid} or …/rulings/{uuid}; a ?share= token is kept). Omit when passing decisionUuid.',
  rpcUrl: 'Optional https JSON-RPC URL of the anchor chain (Base). Enables the anchor check; it receives one public eth_call and never your credentials.',
  reason: 'The ground of the appeal, 1-500 characters on one line. Copied permanently into the next round\'s record: no personal data.',
} as const;

const HEX64 = /^0x[0-9a-fA-F]{64}$/, ADDR = /^0x[0-9a-fA-F]{40}$/, DEC = /^[0-9]{1,20}$/;
export const X402ReceiptSchema = z.object({
  network: z.string().regex(/^eip155:[0-9]{1,20}$/).describe(DESC.network),
  transaction: z.string().regex(HEX64).describe(DESC.transaction),
  nonce: z.string().regex(HEX64).describe(DESC.nonce),
  payer: z.string().regex(ADDR).describe(DESC.payer),
  payTo: z.string().regex(ADDR).describe(DESC.payTo),
  asset: z.string().regex(ADDR).describe(DESC.receiptAsset),
  value: z.string().regex(/^[0-9]{1,78}$/).describe(DESC.value),
  validAfter: z.string().regex(DEC).describe(DESC.validAfter),
  validBefore: z.string().regex(DEC).describe(DESC.validBefore),
  resource: z.string().regex(/^[\x21-\x7E]{1,2048}$/).describe(DESC.resource),
}).strict().describe(DESC.x402Receipt);

const atMostCap = (v: string) => { const n = v.replace(/^0+(?=\d)/, '');
  return n.length < 10 || (n.length === 10 && n <= DISPUTE_VALUE_CAP_MINOR); };

export const OpenDisputeSchema = z.object({
  title: z.string().min(3).max(200).describe(DESC.title),
  claim: z.string().min(1).max(8000).describe(DESC.claim),
  respondent: z.object({ username: z.string().min(1).max(180).describe(DESC.respondentUsername) }).strict().describe(DESC.respondent),
  claimantLabel: z.string().min(1).max(255).describe(DESC.claimantLabel),
  respondentLabel: z.string().min(1).max(255).describe(DESC.respondentLabel),
  panel: z.enum(['fast_track', 'human']).describe(DESC.panel),
  valueMinor: z.string().regex(/^[0-9]{1,38}$/, 'valueMinor must be a decimal string of minor units, e.g. "1500000"')
    .refine(atMostCap, 'valueMinor exceeds the 2000 USDC cap (2000000000 minor units)').optional().describe(DESC.valueMinor),
  asset: z.literal('USDC').default('USDC').describe(DESC.asset),
  x402Receipt: X402ReceiptSchema.optional(),
});
export const SubmitEvidenceSchema = z.object({
  disputeUuid: disputeUuid(DESC.disputeUuid),
  text: z.string().min(1).max(5000).optional().describe(DESC.text),
  x402Receipt: X402ReceiptSchema.optional(),
}).refine((p) => (p.text === undefined) !== (p.x402Receipt === undefined), 'Pass exactly one of text or x402Receipt');
export const AwaitRulingSchema = z.object({
  disputeUuid: disputeUuid(DESC.disputeUuid),
  until: z.enum(['provisional', 'final']).default('provisional').describe(DESC.until),
  timeoutSeconds: z.number().int().min(5).max(170).default(150).describe(DESC.timeoutSeconds),
});
export const VerifyRulingSchema = z.object({
  decisionUuid: z.string().regex(UUID_RE, 'decisionUuid must be a UUID').optional().describe(DESC.decisionUuid),
  bundleUrl: z.string().url().optional().describe(DESC.bundleUrl),
  rpcUrl: z.string().url().refine((u) => /^https:\/\//.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u + '/'),
    'rpcUrl must be https (or http on localhost)').optional().describe(DESC.rpcUrl),
}).refine((p) => (p.decisionUuid === undefined) !== (p.bundleUrl === undefined), 'Pass exactly one of decisionUuid or bundleUrl');
export const AppealRulingSchema = z.object({
  disputeUuid: disputeUuid(DESC.disputeUuid),
  reason: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(500)
    .refine((s) => !/\p{Cc}/u.test(s), 'reason must be one line with no control characters')).describe(DESC.reason),
});

export type X402ReceiptInput = z.infer<typeof X402ReceiptSchema>;

/**
 * The six honesty rows (master-plan §4, spec §10), byte-identical to that
 * table: the five tool rows plus the AI fast-track panel row that
 * tribeunal_open_dispute's description also carries. Every dispute result's
 * `honesty` field is its tool's row, never a paraphrase.
 */
export const HONESTY = {
  openDispute: {
    proves: 'The case exists, is private, and the value is ≤ cap',
    doesNotProve: "Respondent consent; any enforcement when `bindingBasis:'advisory'`",
  },
  submitEvidence: {
    proves: 'The filing is hashed into the record the panel sees and the verdict commits to',
    doesNotProve: "That the content is true; the x402 receipt is unchecked unless `receiptCheck:'ok'`; a receipt proves payment, not delivery",
  },
  awaitRuling: {
    proves: "`provisional` = a signed round verdict; `final` = no further appeal under Tribeunal's rules",
    doesNotProve: 'That money moved (see `execution`)',
  },
  verifyRuling: {
    proves: 'Cryptographic consistency against the published signer, the log and optionally the chain',
    doesNotProve: 'Independence (`independent:false`); no witness cosigns the log yet',
  },
  appealRuling: {
    proves: 'A fresh, larger, human-only round opened',
    doesNotProve: 'That humans will show up (a Void appeal round keeps the standing ruling, I9)',
  },
  aiPanel: {
    proves: '3 AI personas voted, with provenance and model alias',
    doesNotProve: 'Independence (shared provider); resistance to prompt injection; human judgment. **Every AI ruling is appealable to humans**',
  },
} as const;

// disputeApiError() — spec §3.5 hint table. Every dispute-route call is
// wrapped with this so the shared `catch` in dispatchToolCall (which prints
// `API Error: ${error.message}`) surfaces `<code> (<status>): <message> —
// <hint>` — code first, as skills/using-tribeunal/references/errors.md
// teaches — rather than a bare message.
function hintFor(code: string, details: { limit?: number }): string {
  if (code.startsWith('invalid_') || code === 'asset_unsupported') {
    return 'fix that argument; an unchanged retry cannot work';
  }
  if (code === 'dispute_value_over_cap' || code === 'dispute_value_exceeds_receipt') {
    return 'lower valueMinor';
  }
  if (code === 'respondent_unknown' || code === 'respondent_is_self' || code === 'respondent_is_system') {
    return "name the counterparty's own, active account (account-less respondents are unsupported)";
  }
  if (code === 'daily_limit_exceeded') {
    return `${details.limit ?? 'the configured number of'} disputes per account per rolling 24 h`;
  }
  if (code === 'dispute_not_found') {
    return 'unknown, or you are not a party; identical by design';
  }
  if (code === 'not_a_party') {
    return 'an admin who is not a party cannot file or appeal';
  }
  if (['dispute_filings_closed', 'appeal_window_closed', 'max_rounds', 'dispute_final'].includes(code)) {
    return 'never, for this round or dispute';
  }
  if (code === 'round_not_closed') {
    return 'await the provisional ruling first';
  }
  if (code === 'appeal_not_losing_party') {
    return 'only the party the standing ruling goes against';
  }
  if (code === 'origin_not_offchain') {
    return 'a chain dispute is appealed on chain';
  }
  if (code === 'appeal_pool_unconfigured' || code === 'arbiter_unavailable') {
    return 'operator configuration; tell a human, do not loop';
  }
  if (code === 'ruling_not_found') {
    return 'unknown decision, or a private ruling you cannot view';
  }
  if (code === 'insufficient_scope') {
    return 're-consent with the named scope';
  }
  return 'report this to Tribeunal support';
}

/**
 * Wraps every `TribeunalAPIError` a dispute route call throws, reading
 * `details.error` (the code) and `details.message`, into one whose `.message`
 * is `<code> (<status>): <message> — <hint>`. A non-`TribeunalAPIError`
 * rethrows unchanged; a code-less 404 (a server that predates disputes)
 * becomes `404: this server has no dispute endpoints yet`.
 */
export function disputeApiError(e: unknown): never {
  if (!(e instanceof TribeunalAPIError)) {
    throw e;
  }
  const details = (e.details ?? {}) as { error?: string; message?: string; limit?: number };
  const code = details.error;
  if (!code) {
    if (e.statusCode === 404) {
      throw new TribeunalAPIError('404: this server has no dispute endpoints yet', e.statusCode, e.details);
    }
    throw e;
  }
  const hint = hintFor(code, details);
  throw new TribeunalAPIError(`${code} (${e.statusCode}): ${details.message ?? ''} — ${hint}`, e.statusCode, e.details);
}

// Result shaping (spec §3.5). Each builds the tool's exact result-key set
// from the frozen API response, never forwarding stray fields.

export type OpenDisputeParsed = z.infer<typeof OpenDisputeSchema>;

/** Body POST /disputes receives — the parsed input verbatim, `valueMinor`/`x402Receipt` omitted when absent. */
export function buildOpenBody(p: OpenDisputeParsed): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: p.title,
    claim: p.claim,
    respondent: { username: p.respondent.username },
    claimantLabel: p.claimantLabel,
    respondentLabel: p.respondentLabel,
    panel: p.panel,
    asset: p.asset,
  };
  if (p.valueMinor !== undefined) body.valueMinor = p.valueMinor;
  if (p.x402Receipt !== undefined) body.x402Receipt = p.x402Receipt;
  return body;
}

export function openResult(doc: DisputeDocument) {
  const round0 = doc.rounds[0];
  return {
    disputeUuid: doc.disputeUuid,
    caseUuid: doc.round0CaseUuid,
    caseUrl: round0.caseUrl,
    panel: doc.panel,
    panelOpensAt: round0.panelOpensAt,
    endsAt: round0.endsAt,
    appealWindow: { seconds: round0.appealWindowSeconds, deadline: null },
    bindingBasis: doc.bindingBasis,
    enforcement: doc.enforcement,
    consent: doc.consent,
    value: doc.value,
    receiptFiling: doc.receiptFiling,
    honesty: HONESTY.openDispute,
  };
}

export type SubmitEvidenceParsed = z.infer<typeof SubmitEvidenceSchema>;

/** Body POST /disputes/{uuid}/filings receives — exactly one of `text` or `x402Receipt`. */
export function buildFilingBody(p: SubmitEvidenceParsed): { text: string } | { x402Receipt: X402ReceiptInput } {
  return p.text !== undefined ? { text: p.text } : { x402Receipt: p.x402Receipt as X402ReceiptInput };
}

export function filingResult(api: DisputeFilingResult, localHash: string) {
  return {
    filingUuid: api.filingUuid,
    contentHash: api.contentHash,
    contentHashCheck: (api.contentHash === localHash ? 'match' : 'mismatch') as 'match' | 'mismatch',
    inRecord: true as const,
    round: api.round,
    caseUuid: api.caseUuid,
    kind: api.kind,
    receiptCheck: api.receiptCheck,
    honesty: HONESTY.submitEvidence,
  };
}

export function appealResult(api: DisputeAppealResult) {
  return {
    disputeUuid: api.disputeUuid,
    round: api.round,
    caseUuid: api.caseUuid,
    caseUrl: api.caseUrl,
    endsAt: api.endsAt,
    jurorCount: api.jurorCount,
    minVotes: api.minVotes,
    invited: api.invited,
    standing: api.standing,
    priorRound: api.priorRound,
    record: api.record,
    appealDeadline: null,
    honesty: HONESTY.appealRuling,
  };
}

// Local content hash (spec §4.2) — recomputed client-side so
// tribeunal_submit_evidence's `contentHashCheck` can catch a server/client
// disagreement on what was actually filed, instead of trusting the echoed
// `contentHash` blindly.

/** PHP `trim()`'s default character set: space, tab, newline, CR, NUL, vertical tab — NOT Unicode whitespace (so a leading/trailing NBSP is left alone, unlike JS's own `String.prototype.trim()`). */
const PHP_TRIM_CODES = new Set([0x20, 0x09, 0x0a, 0x0d, 0x00, 0x0b]);

function phpTrim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && PHP_TRIM_CODES.has(s.charCodeAt(start))) start++;
  while (end > start && PHP_TRIM_CODES.has(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 of the text trimmed with PHP `trim()`'s character set, or of the
 * canonical JSON of the x402 receipt's ten keys (hex fields lowercased) plus
 * `type:"tribeunal.x402-receipt/1"`, keys sorted — the app's `CanonicalJson`
 * bytes for the printable-ASCII content these fields are restricted to.
 */
export async function localContentHash(input: { text: string } | { x402Receipt: X402ReceiptInput }): Promise<string> {
  const crypto = await subtle();
  if ('text' in input) {
    const digest = await crypto.digest('SHA-256', utf8Bytes(phpTrim(input.text)));
    return toHex(digest);
  }
  const r = input.x402Receipt;
  const canonical = {
    asset: r.asset.toLowerCase(),
    network: r.network,
    nonce: r.nonce.toLowerCase(),
    payTo: r.payTo.toLowerCase(),
    payer: r.payer.toLowerCase(),
    resource: r.resource,
    transaction: r.transaction.toLowerCase(),
    type: 'tribeunal.x402-receipt/1',
    validAfter: r.validAfter,
    validBefore: r.validBefore,
    value: r.value,
  };
  const digest = await crypto.digest('SHA-256', utf8Bytes(JSON.stringify(canonical)));
  return toHex(digest);
}
