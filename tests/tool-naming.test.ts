import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_DEFINITIONS } from '../src/core/tools.js';

/**
 * Naming and annotation discipline for the whole tool surface (design spec
 * §3/§6/§7). One tool name must never drift into `noun_verb` or an
 * un-catalogued verb, and every tool must carry the full annotation set the
 * house pattern requires.
 */

// The exact verb allow-list from spec §7.
const VERBS = [
  'create', 'get', 'search', 'update', 'delete', 'close', 'await', 'cast',
  'revoke', 'post', 'list', 'mark', 'unmark', 'rate', 'invite', 'join',
  'leave', 'start', 'cancel', 'remove', 'open', 'submit', 'appeal', 'verify',
];
const NAME_RE = new RegExp(`^tribeunal_(${VERBS.join('|')})_[a-z_]+$`);

// spec §6: destructiveHint: true exactly on this set.
const EXPECTED_DESTRUCTIVE = [
  'tribeunal_delete_case',
  'tribeunal_delete_comment',
  'tribeunal_delete_tribe',
  'tribeunal_delete_webhook',
  'tribeunal_remove_tribe_member',
  'tribeunal_leave_tribe',
  'tribeunal_leave_jury',
  'tribeunal_close_case',
  'tribeunal_revoke_vote',
  'tribeunal_cancel_jury_duty',
].sort();

test('every tool name matches tribeunal_<verb>_<noun> with a catalogued verb', () => {
  for (const def of TOOL_DEFINITIONS) {
    assert.match(def.name, NAME_RE, `${def.name} must match ${NAME_RE}`);
  }
});

test('every tool name is unique', () => {
  const names = TOOL_DEFINITIONS.map((d) => d.name);
  assert.equal(new Set(names).size, names.length, 'no two tools may share a name');
});

test('every tool has a non-empty title and the five required annotations', () => {
  for (const def of TOOL_DEFINITIONS) {
    assert.equal(typeof def.title, 'string');
    assert.ok(def.title.length > 0, `${def.name} must have a non-empty title`);

    const a = def.annotations as Record<string, unknown>;
    for (const key of ['title', 'readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.ok(key in a, `${def.name}.annotations is missing "${key}"`);
    }
    assert.equal(typeof a.readOnlyHint, 'boolean', `${def.name}.annotations.readOnlyHint must be boolean`);
    assert.equal(typeof a.destructiveHint, 'boolean', `${def.name}.annotations.destructiveHint must be boolean`);
    assert.equal(typeof a.idempotentHint, 'boolean', `${def.name}.annotations.idempotentHint must be boolean`);
    assert.equal(typeof a.openWorldHint, 'boolean', `${def.name}.annotations.openWorldHint must be boolean`);
  }
});

test('every readOnlyHint tool has destructiveHint false', () => {
  for (const def of TOOL_DEFINITIONS) {
    const a = def.annotations as { readOnlyHint?: boolean; destructiveHint?: boolean };
    if (a.readOnlyHint === true) {
      assert.equal(a.destructiveHint, false, `${def.name} is read-only, so destructiveHint must be false`);
    }
  }
});

test('the destructiveHint:true set equals exactly the spec §6 list', () => {
  const actual = TOOL_DEFINITIONS
    .filter((d) => (d.annotations as { destructiveHint?: boolean }).destructiveHint === true)
    .map((d) => d.name)
    .sort();
  assert.deepEqual(actual, EXPECTED_DESTRUCTIVE);
});
