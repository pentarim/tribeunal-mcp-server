import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { TribeunalAPIClient } from '../client/api-client.js';
import { TOOL_DEFINITIONS, dispatchToolCall } from './tools.js';

/**
 * Register the 32 Tribeunal tools on a low-level MCP `Server` (the stdio
 * transport) using an injected API client.
 *
 * This file is the ONLY core module that imports the low-level `Server` from
 * `@modelcontextprotocol/sdk`. It is used exclusively by the stdio entry point
 * (`src/index.ts`). The Cloudflare worker does NOT import this file — it uses
 * the high-level `McpServer` from `agents/mcp` and registers tools directly via
 * `TOOL_DEFINITIONS` + `dispatchToolCall`, which keeps the worker's newer SDK
 * major from having to type-check the stdio server's API surface.
 */
export function registerTools(server: Server, apiClient: TribeunalAPIClient): void {
  // tools/call
  server.setRequestHandler(
    z.object({
      method: z.literal('tools/call'),
      params: z.object({ name: z.string(), arguments: z.unknown() }),
    }),
    async (request) => dispatchToolCall(apiClient, request.params.name, request.params.arguments),
  );

  // tools/list
  server.setRequestHandler(
    z.object({ method: z.literal('tools/list') }),
    async () => ({ tools: TOOL_DEFINITIONS }),
  );

  console.error('All tools registered successfully');
}
