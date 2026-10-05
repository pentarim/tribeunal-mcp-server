import { z } from 'zod';

import { TribeunalAPIError } from '../client/api-client.js';
import type { DealCreateResult, DealDocument } from '../client/api-client.js';

// tribeunal_create_deal — schema, descriptions, honesty row, error wrapping and
// result shaping (design spec 2026-10-02-mcp-create-deal-tool). The tool creates
// a deal REQUEST through POST /api/deals; every on-chain step stays a wallet
// action a party takes on the deal page. tribeunal_get_deal (2.3.0) reads one
// back through GET /api/deals/{slug} and changes nothing either.

/** The app's DisputeValueCap (DISPUTE_MAX_VALUE_MINOR default), mirrored so an over-cap amount never reaches the network. */
export const DEAL_AMOUNT_CAP_MINOR = 2000000000n;

export const DEAL_DESC = {
  payer: "The payer's wallet address: 0x + 40 hex, not the zero address; a mixed-case address must carry a correct EIP-55 checksum. Only this wallet can deposit, on the deal page. Ask the payer for it.",
  payee: "The payee's wallet address: 0x + 40 hex, not the zero address and not the payer; a mixed-case address must carry a correct EIP-55 checksum. Nothing checks that it is the right person's wallet.",
  amount: 'The USDC amount as a decimal string with at most 6 decimal places, such as "150" or "99.5" (not minor units), above 0 and at most "2000". The escrow program also sets its own minimum and maximum; outside them the server refuses with amount_out_of_range.',
  description: 'What the payee delivers, as plain text, 10-2000 characters. It is copied into the hashed terms: anyone holding the link and every juror can read it, and it survives account deletion, so no secrets or personal data. No tabs, control or invisible characters, and no line that starts with a number and a dot such as "1." (use "-" for lists).',
  deliveryDays: 'Whole days from now until the release date, 2-90. Disputes can be raised only before it; after it, if none was raised, anyone can release the money to the payee. Deposits close earlier than that date; the deal page shows when.',
  panel: '"fast_track": the first round of a dispute is decided by three AI jurors and every appeal round by people. "human": every round is decided by people. Required, no default.',
  slug: "The deal's slug: the 16 characters after /deals/ in its url or shareUrl (slug from tribeunal_create_deal). Not the whole URL and not a UUID.",
  share: 'The ?share= value of the shareUrl you were sent: 64 hex characters. Leave it out for a request your own account created; anyone else needs it, and a link the creator has rotated since no longer works.',
} as const;

export const DEAL_HONESTY = {
  createDeal: {
    proves: "A deal request is stored with these terms, and termsHash is the keccak-256 of the exact terms text the payer's browser re-checks before it signs",
    doesNotProve: 'That anything is paid or held; that the payee accepted the terms; that either address belongs to the person you think; that the description is true; that a court would uphold the deal; that the network is not a test network',
  },
  getDeal: {
    proves: "The stored terms and their hash, and the status Tribeunal's indexer had recorded as of live.bridge.updatedAt",
    doesNotProve: 'The state on the network right now (the indexer trails it by minutes, and live.bridge.stale true means it has not kept up); that the payee accepted the terms; that either address belongs to the person you think; that the description is true',
  },
} as const;

export const DEAL_HEADLINE = 'Deal request created; nothing is paid or held yet. Send shareUrl to the payer and the payee: the payer deposits from that page with their own wallet.';

export const CREATE_DEAL_DESCRIPTION = "Create an escrow deal request: the terms under which a payer wallet pays a payee wallet in USDC for work delivered within deliveryDays, with a Tribeunal jury as arbiter of any dispute. It creates a request only. Nothing is paid or held until the payer opens shareUrl and deposits with their own browser wallet on the deal page; Tribeunal never holds the money, and no Tribeunal tool can fund, release, refund or dispute a deal, since each is a wallet action a party takes on that page. Send shareUrl to the payer and the payee only; url opens only for the account that created the request. Ask the parties for their wallet addresses (0x + 40 hex, not usernames) and never guess one. description is written into the hashed terms: anyone holding the link and every juror can read it, and it survives account deletion, so put no secrets or personal data in it. If no dispute is raised by the release date (deliveryDays from now), anyone can release the money to the payee. A request cannot be edited or deleted; create a new one to change anything. Refused: 503 deals_unavailable (this server does not offer deals right now: tell a human, do not retry); 429 deal_daily_limit; 422 invalid_payer, invalid_payee, payee_is_zero, same_party, invalid_amount, amount_out_of_range, invalid_description, invalid_delivery_days, invalid_panel; 403 insufficient_scope; 404 on a server with no deal endpoints. Returns {slug, url, shareUrl, termsHash, honesty}. Proves: A deal request is stored with these terms, and termsHash is the keccak-256 of the exact terms text the payer's browser re-checks before it signs. Does NOT prove: That anything is paid or held; that the payee accepted the terms; that either address belongs to the person you think; that the description is true; that a court would uphold the deal; that the network is not a test network";

export const GET_DEAL_DESCRIPTION = `Read one escrow deal request by its slug: the hashed terms, both wallets, the amount and dates, and the status Tribeunal's indexer last recorded. Use it after tribeunal_create_deal to see whether the payer has deposited, or to read a deal whose shareUrl you were sent; it only reads, and no Tribeunal tool can fund, release, refund or dispute a deal. status is awaiting_deposit, expired (the deposit deadline passed with none recorded), funded, disputed, released, refunded, released_after_deadline, executed (a ruling was applied) or timed_out (no ruling in time, so the money was split). It is built from deposits and outcomes the indexer has recorded, which trail the network by minutes; live.bridge.stale true means the indexer has not kept up and the status may be older still. The account that created the request reads it with slug alone; anyone else must also pass share. Refused: 404 deal_not_found (unknown slug, or not yours to read without a current share value: identical by design); 404 with no code on a server with no deal endpoints. Returns {slug, status, chain, terms: {version, text, hash, metaEvidenceUri}, deal: {payer, payee, amountMinor, amount, asset, decimals, releaseAfter, fundBy, createdAt, panel, description}, params, live, onchain, dispute, resolution, viewer: {isCreator}, shareUrl, honesty}; onchain, dispute and resolution are null until a deposit, a dispute or an outcome is recorded, shareUrl is null unless you created the request, and releaseAfter, fundBy and createdAt are unix seconds. Proves: ${DEAL_HONESTY.getDeal.proves}. Does NOT prove: ${DEAL_HONESTY.getDeal.doesNotProve}`;

/** The app's slug alphabet (base32, lower case) and share token (bin2hex of 32 bytes), mirrored so a pasted URL is refused here with a usable message. */
export const DEAL_SLUG_PATTERN = '^[a-z2-7]{16}$';
export const DEAL_SHARE_PATTERN = '^[0-9a-f]{64}$';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_RE = /^0x0{40}$/;
const AMOUNT_RE = /^([0-9]{1,13})(?:\.([0-9]{1,6}))?$/;
// App\Deal\DealTerms::FORBIDDEN minus \p{Cn}: Node's and PCRE's Unicode tables differ, so the server alone judges unassigned code points.
// \p{Cs} adds what the server never sees as text: a lone UTF-16 surrogate is sent as a JSON "\ud800" escape, PHP json_decode turns that into invalid_json (400) before the description is checked, so it is refused here with a field-level message instead. A valid pair such as U+1F600 is one code point and is not matched.
const FORBIDDEN_RE = /[\x00-\x09\x0B-\x1F\x7F-\x9F\p{Zl}\p{Zp}\p{Cf}\p{Co}\p{Cs}]/u;
const CLAUSE_RE = /^[0-9]+\./;

/** USDC minor units of a decimal that already matched AMOUNT_RE (App\Deal\UsdcAmount::parse). */
export function toMinorUnits(amount: string): bigint {
  const m = AMOUNT_RE.exec(amount);
  if (!m) throw new Error('not a decimal amount');
  return BigInt(m[1] + (m[2] ?? '').padEnd(6, '0'));
}

/** The client-side mirror of DealTerms::canonicalDescription() up to (not including) the server's refusals: NFC, CR LF and CR to LF, trailing spaces per line stripped, blank edge lines dropped. */
export function canonicalLines(description: string): string[] {
  const lines = description.normalize('NFC').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/ +$/, ''));
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const address = (field: 'payer' | 'payee') =>
  z.string()
    .regex(ADDRESS_RE, `${field} must be a wallet address: 0x followed by 40 hex characters`)
    .refine((v) => !ZERO_RE.test(v), `${field} must not be the zero address`)
    .describe(DEAL_DESC[field]);

/** The object shape alone, so tests can compare its keys with the advertised JSON Schema. */
export const CreateDealShape = z.object({
  payer: address('payer'),
  payee: address('payee'),
  amount: z.string()
    .regex(AMOUNT_RE, 'amount must be a decimal string of USDC with at most 6 decimal places, such as "150" or "99.5"')
    .refine((v) => !AMOUNT_RE.test(v) || toMinorUnits(v) > 0n, 'amount must be above 0')
    .refine((v) => !AMOUNT_RE.test(v) || toMinorUnits(v) <= DEAL_AMOUNT_CAP_MINOR, 'amount must be at most "2000" (the 2000 USDC cap)')
    .describe(DEAL_DESC.amount),
  description: z.string()
    .refine((v) => !FORBIDDEN_RE.test(v.normalize('NFC').replace(/\r\n?/g, '\n')), 'description must not contain tabs, control or invisible characters; use spaces and line breaks only')
    .refine((v) => { const n = [...canonicalLines(v).join('\n')].length; return n >= 10 && n <= 2000; }, 'description must be 10-2000 characters once trailing spaces and blank first and last lines are removed')
    .refine((v) => canonicalLines(v).every((l) => !CLAUSE_RE.test(l.normalize('NFKC').replace(/^[\s\p{Z}]+/u, ''))), 'no line of description may start with a number and a dot, such as "1."; use "-" for lists')
    .describe(DEAL_DESC.description),
  deliveryDays: z.number().int('deliveryDays must be a whole number').min(2, 'deliveryDays must be at least 2').max(90, 'deliveryDays must be at most 90').describe(DEAL_DESC.deliveryDays),
  panel: z.enum(['fast_track', 'human']).describe(DEAL_DESC.panel),
});

export const CreateDealSchema = CreateDealShape.refine(
  (p) => p.payer.toLowerCase() !== p.payee.toLowerCase(),
  { message: 'payer and payee must be different wallets', path: ['payee'] },
);

export type CreateDealParsed = z.infer<typeof CreateDealSchema>;

export const GetDealSchema = z.object({
  slug: z.string().regex(new RegExp(DEAL_SLUG_PATTERN), 'slug must be the 16 characters after /deals/ in the deal URL, not the whole URL').describe(DEAL_DESC.slug),
  share: z.string().regex(new RegExp(DEAL_SHARE_PATTERN), 'share must be the 64 hex characters after ?share= in the shareUrl').optional().describe(DEAL_DESC.share),
});

/** Body POST /api/deals receives: exactly the six fields, description raw (the server canonicalises and hashes it). */
export function buildDealBody(p: CreateDealParsed) {
  return { payer: p.payer, payee: p.payee, amount: p.amount, description: p.description, deliveryDays: p.deliveryDays, panel: p.panel };
}

export function createDealResult(api: DealCreateResult) {
  return { slug: api.slug, url: api.url, shareUrl: api.shareUrl, termsHash: api.termsHash, honesty: DEAL_HONESTY.createDeal };
}

/** tribeunal_get_deal's result: the deal document's own keys in its own order; shareUrl is null for a reader the server did not send it to. */
export function getDealResult(api: DealDocument) {
  return {
    slug: api.slug,
    status: api.status,
    chain: api.chain,
    terms: api.terms,
    deal: api.deal,
    params: api.params,
    live: api.live,
    onchain: api.onchain,
    dispute: api.dispute,
    resolution: api.resolution,
    viewer: api.viewer,
    shareUrl: api.shareUrl ?? null,
    honesty: DEAL_HONESTY.getDeal,
  };
}

export function dealHeadline(api: DealDocument): string {
  const stale = api.live?.bridge?.stale === true ? ' (the indexer is stale, so this may be behind the network)' : '';
  return `Deal ${api.slug}: ${api.status}, as Tribeunal's indexer last recorded it${stale}.`;
}

const HINTS: Record<string, string> = {
  invalid_json: 'a tool bug; report it',
  invalid_payer: 'ask the payer for their wallet address again: 0x + 40 hex, not zero; a mixed-case address must carry its EIP-55 checksum',
  invalid_payee: "ask for the payee's wallet address again: 0x + 40 hex; a mixed-case address must carry its EIP-55 checksum",
  payee_is_zero: "the zero address can never withdraw; ask for the payee's real wallet",
  same_party: 'payer and payee must be two different wallets',
  invalid_amount: 'send a decimal string of USDC with at most 6 decimal places, such as "150" or "99.5"',
  amount_out_of_range: 'this escrow program refuses that amount (each has its own minimum and maximum, never above 2000 USDC); agree a different amount with the payer',
  invalid_description: 'rewrite it as 10-2000 characters of plain text with no tabs, control or invisible characters and no line starting with a number and a dot',
  invalid_delivery_days: 'use a whole number of days from 2 to 90',
  invalid_panel: 'use "fast_track" or "human"',
  deals_unavailable: 'this server does not offer deals right now (not configured, or its escrow check failed); tell a human, do not retry in a loop',
  deal_not_found: 'unknown slug, or not yours to read: unless your account created the request, pass share, the ?share= value of the shareUrl you were sent (a rotated link no longer works)',
};

function hintFor(code: string, status: number | undefined, details: { limit?: number; required_scope?: string | null }): string {
  if (HINTS[code]) return HINTS[code];
  if (code === 'deal_daily_limit') return `${details.limit ?? 'the configured number of'} deals per account per rolling 24 h; retry once the window frees a slot`;
  if (code === 'insufficient_scope') {
    return details.required_scope
      ? 're-consent with the named scope'
      : 'this server does not yet accept deal creation from a remote (OAuth) sign-in; use the stdio server with an API key';
  }
  if (status === 401) return 'the credential was not accepted (TRIBEUNAL_API_KEY on stdio, the sign-in on the remote server); an unchanged retry cannot work';
  if (status === 429) return 'the API allows 100 requests/hour; wait before retrying';
  return '';
}

/** Wraps a TribeunalAPIError from a deal route as `<code> (<status>): <message> — <hint>` (the disputeApiError shape); a code-less 404 means a server without deal endpoints. */
export function dealApiError(e: unknown): never {
  if (!(e instanceof TribeunalAPIError)) throw e;
  const details = (e.details ?? {}) as { error?: unknown; message?: unknown; limit?: number; required_scope?: string | null };
  const code = typeof details.error === 'string' ? details.error : undefined;
  if (!code) {
    if (e.statusCode === 404) throw new TribeunalAPIError('404: this server has no deal endpoints yet', e.statusCode, e.details);
    throw e;
  }
  const hint = hintFor(code, e.statusCode, details);
  const message = typeof details.message === 'string' && details.message ? `: ${details.message}` : '';
  throw new TribeunalAPIError(`${code} (${e.statusCode})${message}${hint ? ` — ${hint}` : ''}`, e.statusCode, e.details);
}
