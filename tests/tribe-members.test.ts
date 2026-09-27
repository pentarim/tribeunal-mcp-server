import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchToolCall, TOOL_DEFINITIONS } from '../src/core/tools.js';
import { ListTribeMembersSchema } from '../src/tools/tribes.js';
import { TribeunalAPIError, type TribeunalAPIClient } from '../src/client/api-client.js';

const TRIBE_UUID = '1f185d65-4764-614a-8052-1da3f306fec7';
const CASE_UUID = '8415a252-5e41-4db6-bd5d-ee5b5ad95dd4';

/** Fake client recording roster + invite-jurors calls. */
function fakeClient(record: {
  listArgs?: { tribeId: string; params: { page?: number; limit?: number } };
  listError?: Error;
  inviteJurorsArgs?: { caseId: string; invitees?: string[]; tribeId?: string };
} = {}): TribeunalAPIClient {
  return {
    listTribeMembers: async (tribeId: string, params: { page?: number; limit?: number }) => {
      record.listArgs = { tribeId, params };
      if (record.listError) throw record.listError;
      return {
        tribe: tribeId,
        chieftain: { username: 'bigchief', isAi: false },
        members: [
          { username: 'alice', role: 1, isAi: false, joinedAt: '2026-07-23T10:00:00+00:00' },
          { username: 'botbob', role: 1, isAi: true, joinedAt: '2026-07-23T11:00:00+00:00' },
        ],
        total: 2,
        page: 1,
        limit: 20,
      };
    },
    inviteJurors: async (caseId: string, invitees?: string[], tribeId?: string) => {
      record.inviteJurorsArgs = { caseId, invitees, tribeId };
      return { status: 'success', results: [], summary: { invited: 0, duplicate: 0, not_found: 0 } };
    },
  } as unknown as TribeunalAPIClient;
}

// --- list_tribe_members: happy path -----------------------------------------

test('list_tribe_members prints the chieftain, each member and the total', async () => {
  const record = {};
  const result = await dispatchToolCall(fakeClient(record), 'tribeunal_list_tribe_members', {
    tribeId: TRIBE_UUID,
  });

  const text = result.content[0].text;
  assert.match(text, /Chieftain: bigchief/);
  assert.match(text, /alice/);
  assert.match(text, /botbob/);
  assert.match(text, /\(AI\)/, 'an AI member is flagged');
  assert.match(text, /Total members: 2/);
});

// --- list_tribe_members: display name rendering ------------------------------

test('list_tribe_members prefers an AI persona\'s display name, keeping its @username handle', async () => {
  const client = {
    listTribeMembers: async () => ({
      tribe: TRIBE_UUID,
      chieftain: { username: 'bigchief', displayName: 'bigchief', isAi: false },
      members: [
        { username: '9ad1c1d4c1ed9b89_ai', displayName: 'Anika Vogel', role: 1, isAi: true, joinedAt: '2026-07-23T10:00:00+00:00' },
      ],
      total: 1, page: 1, limit: 20,
    }),
  } as unknown as TribeunalAPIClient;

  const result = await dispatchToolCall(client, 'tribeunal_list_tribe_members', { tribeId: TRIBE_UUID });
  const text = result.content[0].text;

  assert.match(text, /- Anika Vogel \(AI, @9ad1c1d4c1ed9b89_ai\)/, 'AI member shows persona name plus its @handle');
  assert.match(text, /Chieftain: bigchief/, 'a human display name is just the username');
  assert.doesNotMatch(text, /Chieftain: bigchief \(AI/, 'a human chieftain never gets an AI tag');
});

test('list_tribe_members drops the redundant @handle when an AI has no distinct display name', async () => {
  const client = {
    listTribeMembers: async () => ({
      tribe: TRIBE_UUID,
      chieftain: null,
      members: [
        { username: 'botbob', displayName: 'botbob', role: 1, isAi: true, joinedAt: '2026-07-23T11:00:00+00:00' },
      ],
      total: 1, page: 1, limit: 20,
    }),
  } as unknown as TribeunalAPIClient;

  const result = await dispatchToolCall(client, 'tribeunal_list_tribe_members', { tribeId: TRIBE_UUID });
  const text = result.content[0].text;

  assert.match(text, /- botbob \(AI\)/);
  assert.doesNotMatch(text, /@botbob/, 'no "(AI, @botbob)" when the display name already is the username');
});

test('list_tribe_members forwards tribeId and pagination to the client', async () => {
  const record: { listArgs?: { tribeId: string; params: { page?: number; limit?: number } } } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_list_tribe_members', {
    tribeId: TRIBE_UUID,
    page: 2,
    limit: 5,
  });

  assert.equal(record.listArgs?.tribeId, TRIBE_UUID);
  assert.deepEqual(record.listArgs?.params, { page: 2, limit: 5 });
});

// --- list_tribe_members: access denial surfacing -----------------------------

test('a 403 not_tribe_member surfaces through the API-error wrapper', async () => {
  const record = { listError: new TribeunalAPIError('not_tribe_member', 403) };
  await assert.rejects(
    () => dispatchToolCall(fakeClient(record), 'tribeunal_list_tribe_members', { tribeId: TRIBE_UUID }),
    /API Error: not_tribe_member/,
    'a non-member must see the roster refusal, not a silent empty list',
  );
});

test('a 404 masked private tribe surfaces as tribe_not_found', async () => {
  const record = { listError: new TribeunalAPIError('tribe_not_found', 404) };
  await assert.rejects(
    () => dispatchToolCall(fakeClient(record), 'tribeunal_list_tribe_members', { tribeId: TRIBE_UUID }),
    /API Error: tribe_not_found/,
  );
});

// --- list_tribe_members: UUID-only boundary ----------------------------------

test('list_tribe_members rejects a slug or numeric id before any request', async () => {
  const record: { listArgs?: unknown } = {};
  for (const bad of ['some-tribe-slug', '12345', 'not-a-uuid']) {
    await assert.rejects(
      () => dispatchToolCall(fakeClient(record), 'tribeunal_list_tribe_members', { tribeId: bad }),
      /Invalid parameters/,
      `expected ${bad} to be rejected as a tribe identifier`,
    );
  }
  assert.equal(record.listArgs, undefined, 'nothing may reach the API client');
});

test('list_tribe_members is advertised with a UUID pattern on tribeId', () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === 'tribeunal_list_tribe_members');
  assert.ok(def, 'the roster tool must be advertised to clients');
  const props = (def as { inputSchema: { properties: Record<string, { pattern?: string }>; required: string[] } }).inputSchema;
  assert.ok(props.properties.tribeId?.pattern, 'tribeId must advertise a UUID pattern');
  assert.deepEqual(props.required, ['tribeId']);
});

test('the tool count is 44', () => {
  // The count is pinned so a new tool cannot land without also updating the
  // "N tools" claims across the whole surface: README.md, SUMMARY.md, SKILL.md, llms.txt,
  // llms-install.md, docs/examples.md, worker/README.md, server.json,
  // gemini-extension.json, openclaw.plugin.json, the app's
  // templates/page/mcp.html.twig, and the app's docs (docs/AUTH0_CONTRACT.md,
  // docs/TRIALS.md, docs/JURIES.md, docs/WEBHOOKS.md, docs/INTEGRATION.md).
  // Raised 35 -> 38 by the three webhook tools, 38 -> 39 by tribeunal_join_jury,
  // then 39 -> 41 by the TDQS tool-surface redesign (2026-09-15): removed
  // tribeunal_get_vote_stats, tribeunal_get_current_user, and
  // tribeunal_jury_duty_dashboard/allowance/history/accept/reject (7 gone);
  // renamed tribeunal_jury_duty_status -> tribeunal_get_jury_duty_status,
  // tribeunal_jury_duty_start/cancel -> tribeunal_start_jury_duty/
  // tribeunal_cancel_jury_duty, tribeunal_set_side_image ->
  // tribeunal_update_side_image (net zero); added tribeunal_update_case,
  // tribeunal_delete_case, tribeunal_update_comment, tribeunal_delete_comment,
  // tribeunal_leave_jury, tribeunal_update_tribe, tribeunal_delete_tribe,
  // tribeunal_remove_tribe_member, tribeunal_update_webhook (9 new).
  // 41 -> 44 by the three dispute write tools (tribeunal_open_dispute,
  // tribeunal_submit_evidence, tribeunal_appeal_ruling); tribeunal_await_ruling
  // and tribeunal_verify_ruling land in later tasks, moving this to 45 then 46.
  assert.equal(TOOL_DEFINITIONS.length, 44, 'the shared tool count is 44');
  assert.ok(TOOL_DEFINITIONS.find((d) => d.name === 'tribeunal_list_tribe_members'));
});

// --- invite_jurors gains tribeId --------------------------------------------

test('invite_jurors forwards a tribeId to the client', async () => {
  const record: { inviteJurorsArgs?: { caseId: string; invitees?: string[]; tribeId?: string } } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_invite_jurors', {
    caseId: CASE_UUID,
    tribeId: TRIBE_UUID,
  });

  assert.equal(record.inviteJurorsArgs?.caseId, CASE_UUID);
  assert.equal(record.inviteJurorsArgs?.tribeId, TRIBE_UUID);
  assert.equal(record.inviteJurorsArgs?.invitees, undefined, 'a tribeId-only invite carries no explicit invitees');
});

test('invite_jurors forwards invitees and tribeId together', async () => {
  const record: { inviteJurorsArgs?: { caseId: string; invitees?: string[]; tribeId?: string } } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_invite_jurors', {
    caseId: CASE_UUID,
    invitees: ['alice'],
    tribeId: TRIBE_UUID,
  });

  assert.deepEqual(record.inviteJurorsArgs?.invitees, ['alice']);
  assert.equal(record.inviteJurorsArgs?.tribeId, TRIBE_UUID);
});

test('invite_jurors still works with invitees alone (regression)', async () => {
  const record: { inviteJurorsArgs?: { caseId: string; invitees?: string[]; tribeId?: string } } = {};
  await dispatchToolCall(fakeClient(record), 'tribeunal_invite_jurors', {
    caseId: CASE_UUID,
    invitees: ['alice', 'bob@example.com'],
  });

  assert.deepEqual(record.inviteJurorsArgs?.invitees, ['alice', 'bob@example.com']);
  assert.equal(record.inviteJurorsArgs?.tribeId, undefined);
});

test('invite_jurors with neither invitees nor tribeId is rejected before any request', async () => {
  const record: { inviteJurorsArgs?: unknown } = {};
  await assert.rejects(
    () => dispatchToolCall(fakeClient(record), 'tribeunal_invite_jurors', { caseId: CASE_UUID }),
    /Invalid parameters/,
    'the endpoint requires at least one recruitment source',
  );
  assert.equal(record.inviteJurorsArgs, undefined, 'nothing may reach the API client');
});

test('invite_jurors rejects a non-UUID tribeId', async () => {
  const record: { inviteJurorsArgs?: unknown } = {};
  await assert.rejects(
    () => dispatchToolCall(fakeClient(record), 'tribeunal_invite_jurors', { caseId: CASE_UUID, tribeId: 'some-slug' }),
    /Invalid parameters/,
  );
  assert.equal(record.inviteJurorsArgs, undefined);
});

// A guard that the schema default page/limit come through when omitted.
test('ListTribeMembersSchema defaults page and limit', () => {
  const parsed = ListTribeMembersSchema.parse({ tribeId: TRIBE_UUID });
  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, 20);
});

// The renderer branches on an empty roster and a null chieftain — exercise both so
// a future change to those guards can't silently break the empty-tribe output.
test('list_tribe_members renders an empty roster without a chieftain safely', async () => {
  const client = {
    listTribeMembers: async () => ({ tribe: TRIBE_UUID, chieftain: null, members: [], total: 0, page: 1, limit: 20 }),
  } as unknown as TribeunalAPIClient;

  const result = await dispatchToolCall(client, 'tribeunal_list_tribe_members', { tribeId: TRIBE_UUID });
  const text = result.content[0].text;

  assert.doesNotMatch(text, /Chieftain:/, 'no chieftain line when chieftain is null');
  assert.match(text, /no members have joined yet/i);
  assert.match(text, /Total members: 0/);
});

// The member line renders role and survives a null username (backend getMember() can
// be null for a stale row) without printing the literal "undefined".
test('list_tribe_members renders role and guards a null username', async () => {
  const client = {
    listTribeMembers: async () => ({
      tribe: TRIBE_UUID,
      chieftain: { username: 'chief', isAi: false },
      members: [{ username: null, role: 1, isAi: false, joinedAt: '2026-07-23T10:00:00+00:00' }],
      total: 1, page: 1, limit: 20,
    }),
  } as unknown as TribeunalAPIClient;

  const result = await dispatchToolCall(client, 'tribeunal_list_tribe_members', { tribeId: TRIBE_UUID });
  const text = result.content[0].text;

  assert.match(text, /role 1/, 'the promised role field is rendered');
  assert.doesNotMatch(text, /undefined/, 'a null username never renders as the string "undefined"');
  assert.match(text, /\(unknown user\)/);
});
