#!/usr/bin/env -S node --import tsx
/**
 * Dispatch a single MCP tool from the CLI, against the stdio/persona API client
 * built from environment variables. This is the thin harness the agent-await
 * gate and manual debugging use to exercise a tool end-to-end without an MCP
 * client:
 *
 *   TRIBEUNAL_API_BASE_URL=https://tribeunal.test/api \
 *   TRIBEUNAL_API_KEY=<key> NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *   npx tsx scripts/dispatch.ts tribeunal_await_verdict '{"caseId":"<uuid>","timeoutS":10}'
 *
 * Prints the tool's text content to stdout; exits non-zero on error.
 */
import { createApiClientFromEnv } from '../src/client/from-env.js';
import { dispatchToolCall } from '../src/core/tools.js';

async function main(): Promise<void> {
  const [, , toolName, jsonArgs] = process.argv;
  if (!toolName) {
    console.error('Usage: tsx scripts/dispatch.ts <toolName> [json-args]');
    process.exit(1);
  }

  const args = jsonArgs ? JSON.parse(jsonArgs) : {};
  const apiClient = createApiClientFromEnv();
  const result = await dispatchToolCall(apiClient, toolName, args);

  for (const part of result.content) {
    if (part.type === 'text') console.log(part.text);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
