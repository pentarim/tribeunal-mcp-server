import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { SERVER_INSTRUCTIONS } from '../src/core/instructions.js';

/**
 * `instructions` is the only server-level prose an MCP client puts in front of
 * the model, and it is the handshake's advert for the skills. Both transports
 * must carry it, and it must stay short enough that clients keep it.
 */

test('the instructions are short enough to survive every client', () => {
  const lines = SERVER_INSTRUCTIONS.split('\n');
  assert.ok(lines.length <= 8, `instructions must stay within 8 lines, got ${lines.length}`);
  assert.ok(SERVER_INSTRUCTIONS.length < 1200, 'instructions are a brief, not a manual');
});

test('the instructions name the facts an agent otherwise gets wrong', () => {
  // Each of these cost a real debugging session before it was written down.
  assert.match(SERVER_INSTRUCTIONS, /UUID/, 'ids are UUID-only');
  assert.match(SERVER_INSTRUCTIONS, /timeLeft/, '"open" past the deadline is the silent failure');
  assert.match(SERVER_INSTRUCTIONS, /tribeunal_await_verdict/, 'verdicts are asynchronous');
  assert.match(SERVER_INSTRUCTIONS, /shareUrl/, 'a private case url is a login wall / access-denied dead end for everyone else');
  assert.match(SERVER_INSTRUCTIONS, /using-tribeunal/, 'the handshake must point at the skills');
  assert.match(SERVER_INSTRUCTIONS, /tribeunal_verify_ruling/, 'arbitration verdicts are signed and verifiable');
});

test('both transports pass the same instructions to their constructor', () => {
  // Neither entry point is importable here — the stdio one connects a
  // transport on import and the worker one needs the Cloudflare runtime — so
  // this asserts on the source. It exists because the version literals in
  // exactly these two constructors went stale three times.
  for (const path of ['../src/index.ts', '../worker/src/mcp-agent.ts']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /SERVER_INSTRUCTIONS/, `${path} must import the shared instructions`);
    assert.match(
      source,
      /instructions:\s*SERVER_INSTRUCTIONS/,
      `${path} must pass instructions to its server constructor`,
    );
  }
});
