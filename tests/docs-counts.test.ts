import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * The "41 tools" claim is scattered across every doc surface. This pins the
 * whole set to 47 in one place so a future tool count cannot go stale in one
 * file while the pin in tests/tribe-members.test.ts moves.
 */

const STALE = /\b4[16] tools|same 4[16]\b|the 4[16]\b|4[16] total|4[16]-tool/;

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('doc surfaces name 47 tools, not 41 or 46', () => {
  for (const path of ['README.md', 'llms-install.md', 'worker/README.md', 'SUMMARY.md', 'server.json']) {
    const text = read(path);
    assert.doesNotMatch(text, STALE, `${path} still claims the old tool count`);
    assert.match(text, /47/, `${path} must mention the current tool count, 47`);
  }
});

test('README.md and llms-install.md name the three open-world tools', () => {
  const needle = 'three are open-world (`create_case`, `update_side_image`, `verify_ruling`)';
  for (const path of ['README.md', 'llms-install.md']) {
    assert.ok(read(path).includes(needle), `${path} must name the three open-world tools`);
  }
});

test('arbitrating-a-dispute no longer says the verdict is unsigned', () => {
  const text = read('skills/arbitrating-a-dispute/SKILL.md');
  assert.ok(
    !text.includes('the verdict itself is not signed today'),
    'the pre-existing false claim must be gone',
  );
  assert.match(text, /tribeunal_verify_ruling/, 'must point at the new verify tool');
  assert.match(
    text,
    /## Disputes with a named counterparty/,
    'must gain the new section on the two-party flow',
  );
});

test('references/errors.md documents every dispute error code', () => {
  const text = read('skills/using-tribeunal/references/errors.md');
  for (const code of [
    'invalid_title',
    'invalid_claim',
    'invalid_label',
    'invalid_panel',
    'asset_unsupported',
    'invalid_value',
    'invalid_x402_receipt',
    'dispute_value_exceeds_receipt',
    'dispute_value_over_cap',
    'respondent_unknown',
    'respondent_is_self',
    'respondent_is_system',
    'daily_limit_exceeded',
    'dispute_not_found',
    'not_a_party',
    'invalid_filing',
    'dispute_filings_closed',
    'invalid_json',
    'invalid_reason',
    'origin_not_offchain',
    'dispute_final',
    'round_not_closed',
    'max_rounds',
    'appeal_window_closed',
    'appeal_not_losing_party',
    'appeal_pool_unconfigured',
    'arbiter_unavailable',
    'disputes_unavailable',
    'ruling_not_found',
    'insufficient_scope',
  ]) {
    assert.ok(text.includes(code), `errors.md must document ${code}`);
  }
});

test('CHANGELOG.md opens with the 2.2.0 release', () => {
  const text = read('CHANGELOG.md');
  const firstRelease = text.split('\n').find((line) => /^## \[/.test(line));
  assert.equal(firstRelease, '## [2.2.0]', 'the newest release section must be 2.2.0');
});

test('CHANGELOG.md 2.2.0 notes match the spec byte-exactly', () => {
  const text = read('CHANGELOG.md');
  assert.ok(
    text.includes('- `viem` is a new runtime dependency, loaded only when `tribeunal_verify_ruling` runs.'),
    'the viem bullet must not wrap the backticks in bold markers',
  );
  assert.ok(
    text.includes(
      '- **`tribeunal_create_webhook`**\'s "Events are owner-scoped" sentence now names the dispute events a party\n' +
        '  (never a bystander) receives.',
    ),
    'the webhook Changed bullet must name the "Events are owner-scoped" sentence',
  );
});

test('references/errors.md documents every deal error code', () => {
  const text = read('skills/using-tribeunal/references/errors.md');
  assert.ok(text.includes('## Deals'), 'errors.md must gain a ## Deals section');
  for (const code of [
    'invalid_json',
    'deals_unavailable',
    'deal_daily_limit',
    'invalid_payer',
    'invalid_payee',
    'payee_is_zero',
    'same_party',
    'invalid_amount',
    'amount_out_of_range',
    'invalid_description',
    'invalid_delivery_days',
    'invalid_panel',
  ]) {
    assert.ok(text.includes(code), `errors.md must document ${code}`);
  }
});

test('CHANGELOG.md 2.2.0 names tribeunal_create_deal and 47 tools', () => {
  const text = read('CHANGELOG.md');
  const section = text.slice(0, text.indexOf('## [2.1.0]'));
  assert.ok(section.includes('**`tribeunal_create_deal`**'), 'the 2.2.0 section must name the deal tool');
  assert.ok(section.includes('47 tools, up from 41'), 'the 2.2.0 section must say 47 tools, up from 41');
});

test('the deal skill section names the tool and stays honest', () => {
  const banned = [
    /\b(enforc\w*|binding|guarantee\w*|final\w*)\b/i,
    /\b(protect\w*|safe\w*|secur\w*|insur\w*)\b/i,
    /Tribeunal (holds|keeps|stores|has) (your|the) money/i,
  ];
  const skill = read('skills/arbitrating-a-dispute/SKILL.md');
  const start = skill.indexOf('## Escrow deal requests');
  assert.ok(start >= 0, 'arbitrating-a-dispute must gain a ## Escrow deal requests section');
  const rest = skill.slice(start + 3);
  const next = rest.indexOf('\n## ');
  const section = next === -1 ? rest : rest.slice(0, next);
  for (const phrase of ['tribeunal_create_deal', 'Tribeunal never holds the money', 'It creates a request only.']) {
    assert.ok(section.includes(phrase), `the deal skill section must contain: ${phrase}`);
  }
  const errors = read('skills/using-tribeunal/references/errors.md');
  const errStart = errors.indexOf('## Deals');
  const errRest = errors.slice(errStart + 3);
  const errNext = errRest.indexOf('\n## ');
  const errSection = errNext === -1 ? errRest : errRest.slice(0, errNext);
  const changelog = read('CHANGELOG.md');
  const bulletStart = changelog.indexOf('- **`tribeunal_create_deal`**');
  const bullet = changelog.slice(bulletStart, changelog.indexOf('\n- ', bulletStart + 3));
  for (const [label, text] of [['skill section', section], ['errors.md ## Deals', errSection], ['CHANGELOG bullet', bullet]] as const) {
    for (const re of banned) assert.ok(!re.test(text), `${label} matches ${re}`);
  }
});
