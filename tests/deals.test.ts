import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall, TOOL_DEFINITIONS } from '../src/core/tools.js';
import {
  CREATE_DEAL_DESCRIPTION,
  CreateDealShape,
  DEAL_DESC,
  DEAL_HEADLINE,
  DEAL_HONESTY,
  dealApiError,
} from '../src/tools/deals.js';
import { TribeunalAPIError, type TribeunalAPIClient } from '../src/client/api-client.js';

/**
 * design spec 2026-10-02-mcp-create-deal-tool §7.1 `tests/deals.test.ts`.
 * Special characters are written as escapes inside STRING literals (never
 * regex literals, never raw) so no editor can turn them into line breaks.
 */

const TOOL = 'tribeunal_create_deal';

const DEFAULT_201 = {
  slug: 'abcdefghijklmnop',
  url: 'https://tribeunal.test/deals/abcdefghijklmnop',
  shareUrl: 'https://tribeunal.test/deals/abcdefghijklmnop?share=tok',
  termsHash: '0x' + 'a'.repeat(64),
};

const PAYER = '0x' + '1'.repeat(40);
const PAYEE = '0x' + '2'.repeat(40);
const ZERO = '0x' + '0'.repeat(40);

const VALID = {
  payer: PAYER,
  payee: PAYEE,
  amount: '150',
  description: 'Logo design, three revisions.',
  deliveryDays: 7,
  panel: 'fast_track',
};

const EXPECTED_DESCRIPTION =
  "Create an escrow deal request: the terms under which a payer wallet pays a payee wallet in USDC for work delivered within deliveryDays, with a Tribeunal jury as arbiter of any dispute. It creates a request only. Nothing is paid or held until the payer opens shareUrl and deposits with their own browser wallet on the deal page; Tribeunal never holds the money, and no Tribeunal tool can fund, release, refund or dispute a deal, since each is a wallet action a party takes on that page. Send shareUrl to the payer and the payee only; url opens only for the account that created the request. Ask the parties for their wallet addresses (0x + 40 hex, not usernames) and never guess one. description is written into the hashed terms: anyone holding the link and every juror can read it, and it survives account deletion, so put no secrets or personal data in it. If no dispute is raised by the release date (deliveryDays from now), anyone can release the money to the payee. A request cannot be edited or deleted; create a new one to change anything. Refused: 503 deals_unavailable (this server does not offer deals right now: tell a human, do not retry); 429 deal_daily_limit; 422 invalid_payer, invalid_payee, payee_is_zero, same_party, invalid_amount, amount_out_of_range, invalid_description, invalid_delivery_days, invalid_panel; 403 insufficient_scope; 404 on a server with no deal endpoints. Returns {slug, url, shareUrl, termsHash, honesty}. Proves: A deal request is stored with these terms, and termsHash is the keccak-256 of the exact terms text the payer's browser re-checks before it signs. Does NOT prove: That anything is paid or held; that the payee accepted the terms; that either address belongs to the person you think; that the description is true; that a court would uphold the deal; that the network is not a test network";

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

function fakeClient(fake201: Record<string, unknown> = DEFAULT_201): { calls: unknown[]; client: TribeunalAPIClient } {
  const calls: unknown[] = [];
  const client = {
    createDeal: async (body: unknown) => {
      calls.push(body);
      return fake201;
    },
  } as unknown as TribeunalAPIClient;
  return { calls, client };
}

function throwingClient(status: number | undefined, body: unknown): TribeunalAPIClient {
  return {
    createDeal: async () => {
      throw new TribeunalAPIError('x', status, body);
    },
  } as unknown as TribeunalAPIClient;
}

async function refused(args: Record<string, unknown>, message: string): Promise<void> {
  const { calls, client } = fakeClient();
  await assert.rejects(
    () => dispatchToolCall(client, TOOL, args),
    (e: Error) => {
      assert.ok(e.message.startsWith('Invalid parameters: '), e.message);
      assert.ok(e.message.includes(message), `expected "${message}" in "${e.message}"`);
      return true;
    },
  );
  assert.equal(calls.length, 0, 'a refused call must send no request');
}

async function accepted(args: Record<string, unknown>): Promise<void> {
  const { calls, client } = fakeClient();
  await dispatchToolCall(client, TOOL, args);
  assert.equal(calls.length, 1);
}

async function apiError(status: number | undefined, body: unknown): Promise<string> {
  try {
    await dispatchToolCall(throwingClient(status, body), TOOL, VALID);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected a refusal');
}

// ---------------------------------------------------------------- Definition

test('1. tribeunal_create_deal exists once with the title and annotations of the spec', () => {
  assert.equal(TOOL_DEFINITIONS.filter((d) => d.name === TOOL).length, 1);
  const def = findTool()!;
  assert.equal(def.title, 'Create deal');
  assert.deepEqual(def.annotations, {
    title: 'Create deal',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  });
});

test('2. the advertised input schema mirrors the zod shape and every controller bound', () => {
  const schema = findTool()!.inputSchema as unknown as {
    type: string;
    properties: Record<string, Record<string, unknown>>;
    required: string[];
  };
  const keys = Object.keys(CreateDealShape.shape);
  assert.deepEqual(Object.keys(schema.properties), keys);
  assert.deepEqual(schema.required, keys);
  assert.equal(keys.length, 6);
  for (const k of ['oneOf', 'anyOf', 'allOf']) assert.ok(!(k in schema), `no top-level ${k}`);
  assert.equal(schema.properties.payer.pattern, '^0x[0-9a-fA-F]{40}$');
  assert.equal(schema.properties.payee.pattern, '^0x[0-9a-fA-F]{40}$');
  assert.equal(schema.properties.amount.pattern, '^[0-9]{1,13}(\\.[0-9]{1,6})?$');
  assert.equal(schema.properties.description.minLength, 10);
  assert.equal(schema.properties.description.maxLength, 2000);
  assert.equal(schema.properties.deliveryDays.type, 'integer');
  assert.equal(schema.properties.deliveryDays.minimum, 2);
  assert.equal(schema.properties.deliveryDays.maximum, 90);
  assert.deepEqual(schema.properties.panel.enum, ['fast_track', 'human']);
  assert.ok(!('default' in schema.properties.panel), 'panel has no default');
});

test('3. the description is the spec text byte for byte and carries the honesty row', () => {
  const def = findTool()!;
  assert.equal(def.description, EXPECTED_DESCRIPTION);
  assert.equal(CREATE_DEAL_DESCRIPTION, EXPECTED_DESCRIPTION);
  assert.match(def.description, /^[^.]+dispute\. It creates a request only\./);
  const { proves, doesNotProve } = DEAL_HONESTY.createDeal;
  assert.ok(def.description.includes(`Proves: ${proves}. Does NOT prove: ${doesNotProve}`));
});

test('4. the description carries the load-bearing phrases', () => {
  const d = findTool()!.description;
  for (const phrase of [
    'It creates a request only.',
    'Tribeunal never holds the money',
    'their own browser wallet',
    '503 deals_unavailable',
    'anyone holding the link and every juror',
    'survives account deletion',
  ]) {
    assert.ok(d.includes(phrase), phrase);
  }
});

test('5. no added string overclaims', async () => {
  assertClean(findTool()!.description, 'description');
  assertClean(DEAL_HEADLINE, 'headline');
  for (const [k, v] of Object.entries(DEAL_DESC)) assertClean(v, `DEAL_DESC.${k}`);
  assertClean(DEAL_HONESTY.createDeal.proves, 'proves');
  assertClean(DEAL_HONESTY.createDeal.doesNotProve, 'doesNotProve');
  const bodies: Array<[number, Record<string, unknown>]> = [
    [400, { error: 'invalid_json', message: 'm' }],
    [503, { error: 'deals_unavailable', message: 'm' }],
    [429, { error: 'deal_daily_limit', message: 'm', limit: 10 }],
    [429, { error: 'deal_daily_limit', message: 'm' }],
    [422, { error: 'invalid_payer', message: 'm' }],
    [422, { error: 'invalid_payee', message: 'm' }],
    [422, { error: 'payee_is_zero', message: 'm' }],
    [422, { error: 'same_party', message: 'm' }],
    [422, { error: 'invalid_amount', message: 'm' }],
    [422, { error: 'amount_out_of_range', message: 'm' }],
    [422, { error: 'invalid_description', message: 'm' }],
    [422, { error: 'invalid_delivery_days', message: 'm' }],
    [422, { error: 'invalid_panel', message: 'm' }],
    [403, { error: 'insufficient_scope', required_scope: null }],
    [403, { error: 'insufficient_scope', required_scope: 'create:trials' }],
    [429, { error: 'Too Many Requests' }],
    [401, { error: 'Authentication failed' }],
  ];
  for (const [status, body] of bodies) assertClean(await apiError(status, body), `hint for ${body.error}`);
  assertClean(await apiError(404, { title: 'An error occurred', status: 404 }), 'code-less 404');
});

// ------------------------------------------------------------------- Success

test('6. a valid call sends exactly one createDeal with the six fields, description raw', async () => {
  const { calls, client } = fakeClient();
  await dispatchToolCall(client, TOOL, VALID);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], VALID);
});

test('7. stray arguments are not forwarded', async () => {
  const { calls, client } = fakeClient();
  await dispatchToolCall(client, TOOL, { ...VALID, asset: 'USDC', extra: 1 });
  assert.deepEqual(Object.keys(calls[0] as object).sort(), ['amount', 'deliveryDays', 'description', 'panel', 'payee', 'payer']);
});

test('8. a CR LF description passes and is forwarded unchanged', async () => {
  const { calls, client } = fakeClient();
  const description = 'Logo design\r\n- three revisions';
  await dispatchToolCall(client, TOOL, { ...VALID, description });
  assert.equal((calls[0] as { description: string }).description, description);
});

test('9. the text is the headline plus exactly {slug,url,shareUrl,termsHash,honesty}', async () => {
  const { client } = fakeClient({ ...DEFAULT_201, status: 'x' });
  const res = await dispatchToolCall(client, TOOL, VALID);
  assert.equal(res.content.length, 1);
  const text = res.content[0].text;
  assert.ok(text.startsWith(`${DEAL_HEADLINE}\n\n`));
  const json = JSON.parse(text.slice(DEAL_HEADLINE.length + 2));
  assert.deepEqual(Object.keys(json), ['slug', 'url', 'shareUrl', 'termsHash', 'honesty']);
  assert.equal(json.slug, DEFAULT_201.slug);
  assert.equal(json.url, DEFAULT_201.url);
  assert.equal(json.shareUrl, DEFAULT_201.shareUrl);
  assert.equal(json.termsHash, DEFAULT_201.termsHash);
  assert.deepEqual(json.honesty, DEAL_HONESTY.createDeal);
  assert.ok(!('status' in json));
});

// ---------------------------------------------------------- Input validation

test('10. a malformed address names the field', async () => {
  await refused({ ...VALID, payer: '0x123' }, 'payer must be a wallet address: 0x followed by 40 hex characters');
  await refused({ ...VALID, payee: '2'.repeat(40) }, 'payee must be a wallet address: 0x followed by 40 hex characters');
});

test('11. the zero address is refused for payer and payee', async () => {
  await refused({ ...VALID, payer: ZERO }, 'payer must not be the zero address');
  await refused({ ...VALID, payee: ZERO }, 'payee must not be the zero address');
});

test('12. payer and payee must differ, compared case-insensitively', async () => {
  await refused({ ...VALID, payee: '0x' + PAYER.slice(2).toUpperCase() }, 'payer and payee must be different wallets');
});

test('13. amount refusals', async () => {
  for (const amount of ['0', '0.000000']) await refused({ ...VALID, amount }, 'amount must be above 0');
  for (const amount of ['2000.000001', '2001']) await refused({ ...VALID, amount }, 'amount must be at most "2000" (the 2000 USDC cap)');
  for (const amount of ['1e3', '-5', '1.1234567', '12345678901234']) {
    await refused({ ...VALID, amount }, 'amount must be a decimal string of USDC with at most 6 decimal places');
  }
  await refused({ ...VALID, amount: 150 }, 'Expected string');
});

test('14. amount acceptances', async () => {
  for (const amount of ['2000', '2000.000000', '0.000001', '99.5']) await accepted({ ...VALID, amount });
});

test('15. description length counts code points after canonicalisation', async () => {
  const msg = 'description must be 10-2000 characters once trailing spaces and blank first and last lines are removed';
  await refused({ ...VALID, description: 'a'.repeat(9) }, msg);
  await accepted({ ...VALID, description: '\u{1F600}'.repeat(10) });
  await refused({ ...VALID, description: 'a'.repeat(2001) }, msg);
  await accepted({ ...VALID, description: 'a'.repeat(2000) + '   ' });
  await refused({ ...VALID, description: '\n\n' + 'a'.repeat(9) + '\n\n' }, msg);
});

test('16. forbidden characters are refused', async () => {
  const msg = 'description must not contain tabs, control or invisible characters; use spaces and line breaks only';
  for (const bad of ['\t', '\u200b', '\u202e', '\u2028', '\ue000', '\x7f', '\ud800', '\udfff']) {
    await refused({ ...VALID, description: `Logo${bad} design, three revisions.` }, msg);
  }
});

test('17. a line that starts with a number and a dot is refused', async () => {
  const msg = 'no line of description may start with a number and a dot, such as "1."; use "-" for lists';
  await refused({ ...VALID, description: 'Intro line\n1. deliver logo' }, msg);
  await refused({ ...VALID, description: 'Intro line\n   12. deliver' }, msg);
  await refused({ ...VALID, description: 'Intro line\n\uff11. deliver' }, msg);
  await accepted({ ...VALID, description: 'Version 1.5 of the logo' });
  await accepted({ ...VALID, description: '- 1. not first' });
});

test('18. deliveryDays bounds', async () => {
  await refused({ ...VALID, deliveryDays: 1 }, 'deliveryDays must be at least 2');
  await refused({ ...VALID, deliveryDays: 91 }, 'deliveryDays must be at most 90');
  await refused({ ...VALID, deliveryDays: 7.5 }, 'deliveryDays must be a whole number');
  await refused({ ...VALID, deliveryDays: '7' }, 'Expected number');
  await accepted({ ...VALID, deliveryDays: 2 });
  await accepted({ ...VALID, deliveryDays: 90 });
});

test('19. panel is required and enumerated', async () => {
  const { panel: _omit, ...noPanel } = VALID;
  await refused(noPanel, 'Required');
  await refused({ ...VALID, panel: 'ai' }, 'Invalid enum value');
  await accepted({ ...VALID, panel: 'human' });
});

// -------------------------------------------------------------------- Errors

test('20. deals_unavailable says so plainly', async () => {
  const msg = await apiError(503, { error: 'deals_unavailable', message: 'Deals are not available right now.' });
  assert.equal(
    msg,
    'API Error: deals_unavailable (503): Deals are not available right now. — this server does not offer deals right now (not configured, or its escrow check failed); tell a human, do not retry in a loop',
  );
});

test('21. deal_daily_limit names the limit when the app sends it', async () => {
  const withLimit = await apiError(429, { error: 'deal_daily_limit', message: 'You have reached the daily limit of 10 deals.', limit: 10 });
  assert.ok(withLimit.includes(' — 10 deals per account per rolling 24 h'), withLimit);
  const without = await apiError(429, { error: 'deal_daily_limit', message: 'You have reached the daily limit of deals.' });
  assert.ok(without.includes(' — the configured number of deals per account per rolling 24 h'), without);
});

test('22. every 422 code maps to its message and hint', async () => {
  const rows: Array<[string, string, string]> = [
    ['invalid_payer', 'payer must be a valid, non-zero wallet address (a mixed-case address needs a correct checksum).', 'ask the payer for their wallet address again: 0x + 40 hex, not zero; a mixed-case address must carry its EIP-55 checksum'],
    ['invalid_payee', 'payee must be a valid wallet address (a mixed-case address needs a correct checksum).', "ask for the payee's wallet address again: 0x + 40 hex; a mixed-case address must carry its EIP-55 checksum"],
    ['payee_is_zero', 'payee must not be the zero address.', "the zero address can never withdraw; ask for the payee's real wallet"],
    ['same_party', 'payer and payee must be different wallets.', 'payer and payee must be two different wallets'],
    ['invalid_amount', 'amount must be a decimal string with at most 6 places, such as "100.5".', 'send a decimal string of USDC with at most 6 decimal places, such as "150" or "99.5"'],
    ['amount_out_of_range', 'amount is outside what this escrow accepts.', 'this escrow program refuses that amount (each has its own minimum and maximum, never above 2000 USDC); agree a different amount with the payer'],
    ['invalid_description', 'description must be 10 to 2000 characters of plain text, without control or invisible characters or numbered headings.', 'rewrite it as 10-2000 characters of plain text with no tabs, control or invisible characters and no line starting with a number and a dot'],
    ['invalid_delivery_days', 'deliveryDays must be a whole number from 2 to 90.', 'use a whole number of days from 2 to 90'],
    ['invalid_panel', 'panel must be "fast_track" or "human".', 'use "fast_track" or "human"'],
  ];
  for (const [code, message, hint] of rows) {
    assert.equal(await apiError(422, { error: code, message }), `API Error: ${code} (422): ${message} — ${hint}`);
  }
});

test('23. invalid_json is a tool bug', async () => {
  const msg = await apiError(400, { error: 'invalid_json', message: 'The request body must be a JSON object.' });
  assert.equal(msg, 'API Error: invalid_json (400): The request body must be a JSON object. — a tool bug; report it');
});

test('24. insufficient_scope distinguishes an unmapped route from a named scope', async () => {
  const unmapped = await apiError(403, { error: 'insufficient_scope', required_scope: null, route: 'api_deals_create', message: 'No scope grants this route' });
  assert.equal(
    unmapped,
    'API Error: insufficient_scope (403): No scope grants this route — this server does not yet accept deal creation from a remote (OAuth) sign-in; use the stdio server with an API key',
  );
  const named = await apiError(403, { error: 'insufficient_scope', required_scope: 'create:trials', message: 'Missing scope' });
  assert.equal(named, 'API Error: insufficient_scope (403): Missing scope — re-consent with the named scope');
});

test('25. the rate limit names the hourly budget', async () => {
  const msg = await apiError(429, { error: 'Too Many Requests', message: 'API rate limit exceeded. Please try again later.' });
  assert.equal(msg, 'API Error: Too Many Requests (429): API rate limit exceeded. Please try again later. — the API allows 100 requests/hour; wait before retrying');
});

test('26. a 401 says the credential was not accepted', async () => {
  const msg = await apiError(401, { error: 'Authentication failed' });
  assert.equal(
    msg,
    'API Error: Authentication failed (401) — the credential was not accepted (TRIBEUNAL_API_KEY on stdio, the sign-in on the remote server); an unchanged retry cannot work',
  );
});

test('27. a code-less 404 means no deal endpoints', async () => {
  const msg = await apiError(404, { title: 'An error occurred', status: 404, detail: 'No route found' });
  assert.equal(msg, 'API Error: 404: this server has no deal endpoints yet');
});

test('28. an unlisted code gets no invented hint', async () => {
  assert.equal(await apiError(500, { error: 'mystery' }), 'API Error: mystery (500)');
});

test('29. dealApiError rethrows a non-API error unchanged', () => {
  const boom = new Error('boom');
  assert.throws(() => dealApiError(boom), (e) => e === boom);
});

test('source files carry none of the characters the editor hazard converts', async () => {
  const { readFileSync } = await import('node:fs');
  const bad = /[\u200b\u202e\ue000\uff11\u2028\u2029]/;
  for (const f of ['../src/tools/deals.ts', './deals.test.ts']) {
    assert.ok(!bad.test(readFileSync(new URL(f, import.meta.url), 'utf8')), f);
  }
});
