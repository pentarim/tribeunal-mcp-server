import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createApiClientFromEnv } from './client/from-env.js';
import { registerTools } from './core/stdio-register.js';

/**
 * Backwards-compatible entry point for the stdio server.
 *
 * Historically this file held the entire `tools/call` switch and `tools/list`
 * definitions against a module-level singleton API client. That logic now lives
 * in the transport-agnostic core (`src/core/tools.ts`) so the stdio server and
 * the Cloudflare worker register the SAME tools against an injected client.
 *
 * This wrapper preserves the previous behaviour for the local/persona stdio
 * path: it builds an API client from the process environment
 * (`TRIBEUNAL_API_BASE_URL` / `TRIBEUNAL_API_KEY`) and registers the core tools.
 */
export function setupTools(server: Server): void {
  const apiClient = createApiClientFromEnv();
  registerTools(server, apiClient);
}
