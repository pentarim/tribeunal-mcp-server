import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall, TOOL_DEFINITIONS } from '../src/core/tools.js';
import { CreateWebhookSchema, WEBHOOK_EVENTS } from '../src/tools/webhooks.js';
import { GetCaseActivitySchema, ACTIVITY_TYPES } from '../src/tools/activity.js';
import type { TribeunalAPIClient } from '../src/client/api-client.js';

const CASE_UUID = '8415a252-5e41-4db6-bd5d-ee5b5ad95dd4';

const NEW_WEBHOOK_EVENTS = ['dispute.opened', 'appeal.filed', 'ruling.final'];
const NEW_ACTIVITY_TYPES = ['dispute_opened', 'appeal_filed', 'ruling_final'];

function byName(name: string) {
  const def = TOOL_DEFINITIONS.find((d) => d.name === name);
  assert.ok(def, `${name} not found in TOOL_DEFINITIONS`);
  return def as (typeof TOOL_DEFINITIONS)[number];
}

// --- catalogs ----------------------------------------------------------------

test('WEBHOOK_EVENTS gains the three dispute events after ping, twelve total', () => {
  assert.equal(WEBHOOK_EVENTS.length, 12);
  assert.deepEqual(WEBHOOK_EVENTS.slice(-3), NEW_WEBHOOK_EVENTS);
  assert.equal(WEBHOOK_EVENTS[8], 'ping');
});

test('ACTIVITY_TYPES gains the three dispute types, thirteen total', () => {
  assert.equal(ACTIVITY_TYPES.length, 13);
  assert.deepEqual(ACTIVITY_TYPES.slice(-3), NEW_ACTIVITY_TYPES);
});

// --- JSON-Schema mirrors -------------------------------------------------------

test('create_webhook and update_webhook event enums mirror WEBHOOK_EVENTS exactly', () => {
  const create = byName('tribeunal_create_webhook');
  const update = byName('tribeunal_update_webhook');
  const createEnum = (create.inputSchema as { properties: { events: { items: { enum: string[] } } } }).properties.events.items.enum;
  const updateEnum = (update.inputSchema as { properties: { events: { items: { enum: string[] } } } }).properties.events.items.enum;
  assert.deepEqual(createEnum, [...WEBHOOK_EVENTS]);
  assert.deepEqual(updateEnum, [...WEBHOOK_EVENTS]);
});

test('get_case_activity and await_case_activity types enums mirror ACTIVITY_TYPES exactly', () => {
  const get = byName('tribeunal_get_case_activity');
  const await_ = byName('tribeunal_await_case_activity');
  const getEnum = (get.inputSchema as { properties: { types: { items: { enum: string[] } } } }).properties.types.items.enum;
  const awaitEnum = (await_.inputSchema as { properties: { types: { items: { enum: string[] } } } }).properties.types.items.enum;
  assert.deepEqual(getEnum, [...ACTIVITY_TYPES]);
  assert.deepEqual(awaitEnum, [...ACTIVITY_TYPES]);
});

// --- prose lists name the new catalog entries ---------------------------------

test('webhook prose (zod describe + tools.ts property description) names all three dispute webhook events', () => {
  const zodProse = CreateWebhookSchema.shape.events.description ?? '';
  const jsonProse = (byName('tribeunal_create_webhook').inputSchema as { properties: { events: { description: string } } }).properties.events
    .description;
  for (const name of NEW_WEBHOOK_EVENTS) {
    assert.ok(zodProse.includes(name), `webhooks.ts events .describe() missing ${name}`);
    assert.ok(jsonProse.includes(name), `tools.ts create_webhook events property description missing ${name}`);
  }
});

test('activity prose (zod describe + tools.ts property description) names all three dispute activity types', () => {
  const zodProse = GetCaseActivitySchema.shape.types.description ?? '';
  const jsonProse = (byName('tribeunal_get_case_activity').inputSchema as { properties: { types: { description: string } } }).properties.types
    .description;
  for (const name of NEW_ACTIVITY_TYPES) {
    assert.ok(zodProse.includes(name), `activity.ts types .describe() missing ${name}`);
    assert.ok(jsonProse.includes(name), `tools.ts get_case_activity types property description missing ${name}`);
  }
});

// --- owner-scope sentence, verbatim -------------------------------------------

test('tribeunal_create_webhook describes the party-scoped exception verbatim and drops the old sentence', () => {
  const description = byName('tribeunal_create_webhook').description;
  assert.ok(
    description.includes(
      'Events are owner-scoped: an endpoint receives events for cases YOU own, and, for a dispute you are a party to, dispute.opened, comment.created, evidence.marked, case.closed, appeal.filed and ruling.final (never votes or jury events).',
    ),
  );
  assert.ok(!description.includes('receives events only for cases YOU own'));
});

// --- dispute seat refusals, verbatim ------------------------------------------

test('tribeunal_cast_vote names the dispute-seat refusals verbatim', () => {
  const description = byName('tribeunal_cast_vote').description;
  assert.ok(description.includes(', 403 dispute_party (you are a party to this dispute), 403 dispute_prior_juror (you sat on an earlier round)'));
});

test('tribeunal_join_jury names the dispute-seat refusals verbatim', () => {
  const description = byName('tribeunal_join_jury').description;
  assert.ok(description.includes('; 403 `dispute_party` and `dispute_prior_juror` block parties and earlier-round jurors of a dispute'));
});

// --- dispatch still accepts the new names -------------------------------------

test('tribeunal_create_webhook dispatch forwards the new event names to the client', async () => {
  let forwarded: { url: string; events: string[] } | undefined;
  const client = {
    createWebhook: async (data: { url: string; events: string[] }) => {
      forwarded = data;
      return { uuid: '01a03e2c-a314-7884-88d7-15faa67e2101', url: data.url, events: data.events, active: true, secret: 'x' };
    },
  } as unknown as TribeunalAPIClient;

  await dispatchToolCall(client, 'tribeunal_create_webhook', {
    url: 'https://example.com/hooks/tribeunal',
    events: ['appeal.filed', 'ruling.final'],
  });

  assert.deepEqual(forwarded?.events, ['appeal.filed', 'ruling.final']);
});

test('tribeunal_get_case_activity dispatch forwards the new activity type to the client', async () => {
  let forwardedTypes: string[] | undefined;
  const client = {
    getCaseActivity: async (_caseId: string, opts: { types?: string[] }) => {
      forwardedTypes = opts.types;
      return { events: [], latestCursor: null, hasMore: false, verdict: null };
    },
  } as unknown as TribeunalAPIClient;

  await dispatchToolCall(client, 'tribeunal_get_case_activity', { caseId: CASE_UUID, types: ['ruling_final'] });

  assert.deepEqual(forwardedTypes, ['ruling_final']);
});
