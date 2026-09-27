import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { REFERENCE_PATH, renderToolsReference } from '../scripts/gen-skill-reference.js';
import { TOOL_DEFINITIONS } from '../src/core/tools.js';

/**
 * The skills deliberately never restate parameter constraints — they point at
 * the generated catalogue instead. These tests are the reason that is safe:
 * add, rename or re-annotate a tool without running `npm run gen:skills` and
 * the suite goes red here rather than shipping a stale reference.
 */

test('the committed tools reference is exactly what the generator renders', () => {
  const committed = readFileSync(REFERENCE_PATH, 'utf8');
  assert.equal(
    committed,
    renderToolsReference(),
    'skills/using-tribeunal/references/tools.md is stale — run `npm run gen:skills`',
  );
});

test('the reference has one row per advertised tool', () => {
  const committed = readFileSync(REFERENCE_PATH, 'utf8');
  const rows = committed.split('\n').filter((line) => line.startsWith('| tribeunal_'));
  assert.equal(rows.length, TOOL_DEFINITIONS.length, 'every tool needs a row, and only tools get rows');

  const names = rows.map((row) => row.split('|')[1].trim());
  assert.deepEqual(names, TOOL_DEFINITIONS.map((d) => d.name), 'rows must follow TOOL_DEFINITIONS order');
});

test('the first column is a bare tool name a reader can copy', () => {
  const committed = readFileSync(REFERENCE_PATH, 'utf8');
  for (const row of committed.split('\n').filter((line) => line.startsWith('| tribeunal_'))) {
    const name = row.split('|')[1].trim();
    assert.match(name, /^tribeunal_[a-z_]+$/, `"${name}" must be the bare tool name, no backticks or prefix`);
  }
});

test('a pipe inside a description cannot break the table', () => {
  // tribeunal_list_evidence says "(kind: comment|file)". Rendered raw, that
  // splits the row into a sixth column and the table silently loses a cell.
  const rendered = renderToolsReference([
    {
      name: 'tribeunal_fake_tool',
      title: 'Fake',
      annotations: { title: 'Fake', readOnlyHint: true, openWorldHint: false },
      description: 'Takes a kind: comment|file. And more.',
      inputSchema: { type: 'object', properties: {}, required: ['caseId'] },
    },
  ] as unknown as typeof TOOL_DEFINITIONS);
  const row = rendered.split('\n').find((line) => line.startsWith('| tribeunal_fake_tool'));
  assert.ok(row, 'the fake tool must render a row');
  assert.equal(row.split(/(?<!\\)\|/).length - 2, 5, 'a row has exactly five cells');
  assert.match(row, /comment\\\|file/, 'the pipe must be escaped');
});

test('the plugin manifest version tracks the package version', () => {
  // plugin.json, marketplace.json and package.json are bumped by hand in three
  // places; they went out of sync three times before this test existed.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const plugin = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  const marketplace = JSON.parse(
    readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'),
  );

  assert.equal(plugin.version, pkg.version, '.claude-plugin/plugin.json version must equal package.json');
  assert.equal(plugin.name, 'tribeunal');

  // The plugin declares its MCP server inline rather than through a root
  // .mcp.json, because that file is this repo's own developer config — six
  // local servers that must never ship to a plugin user. Inline registration
  // is verified to work: it loads as `plugin:tribeunal:tribeunal`.
  assert.equal(plugin.mcpServers?.tribeunal?.type, 'http', 'the plugin must bring the remote MCP server');
  assert.equal(plugin.mcpServers.tribeunal.url, 'https://mcp.tribeunal.com/mcp');
  // Both entries are load-bearing. Without './' the repo-root SKILL.md — the
  // entry skill served at tribeunal.com/skill.md — is not part of the plugin at
  // all; without './skills/' the eight workflow skills are not. Verified: the
  // pair inventories as nine skills with no duplicates.
  assert.deepEqual(
    plugin.skills,
    ['./', './skills/'],
    'the plugin must ship the root entry skill and the shared skills directory',
  );
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'tribeunal');
  assert.equal(marketplace.plugins[0].version, pkg.version, 'the marketplace entry must equal package.json');
});

test('every server constructor and manifest carries the 2.2.0 package version', () => {
  // The nine literals a version bump must touch by hand (spec §2.1). The two
  // Server constructors (stdio, worker) are source-read because neither entry
  // point is importable here, and they went untested through three stale bumps.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '2.2.0');

  for (const path of ['../src/index.ts', '../worker/src/mcp-agent.ts']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /version:\s*'2\.2\.0'/, `${path} must construct its Server with version: '2.2.0'`);
  }

  const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
  assert.equal(server.version, '2.2.0', 'server.json top-level version must equal package.json');
  assert.equal(
    server.packages?.[0]?.version,
    '2.2.0',
    'server.json packages[0].version must equal package.json',
  );
});
