import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * The "41 tools" claim is scattered across every doc surface. This pins the
 * whole set to 46 in one place so a future tool count cannot go stale in one
 * file while the pin in tests/tribe-members.test.ts moves.
 */

const STALE_41 = /41 tools|same 41|the 41/;

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('doc surfaces name 46 tools, not 41', () => {
  for (const path of ['README.md', 'llms-install.md', 'worker/README.md', 'SUMMARY.md', 'server.json']) {
    const text = read(path);
    assert.doesNotMatch(text, STALE_41, `${path} still claims the old tool count`);
    assert.match(text, /46/, `${path} must mention the current tool count, 46`);
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
