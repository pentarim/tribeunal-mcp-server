import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { TribeunalAPIClient } from '../client/api-client.js';
import type { AwaitContext } from '../tools/activity.js';
import { TOOL_DEFINITIONS, dispatchToolCall } from './tools.js';

/**
 * Register the 34 Tribeunal tools on a low-level MCP `Server` (the stdio
 * transport) using an injected API client.
 *
 * This file is the ONLY core module that imports the low-level `Server` from
 * `@modelcontextprotocol/sdk`. It is used exclusively by the stdio entry point
 * (`src/index.ts`). The Cloudflare worker registers the same TOOL_DEFINITIONS
 * through its own agent (see worker/src/mcp-agent.ts) so the 34 tools stay
 * byte-identical across both transports.
 */
export function registerTools(server: Server, apiClient: TribeunalAPIClient): void {
  // tools/list — advertise the shared tool definitions verbatim.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS as unknown as Array<{
      name: string;
      title?: string;
      description?: string;
      inputSchema: Record<string, unknown>;
      annotations?: Record<string, unknown>;
    }>,
  }));

  // tools/call — route through the injected client. The long-poll await tools
  // get a ctx so progress streams to the client (progressToken) and client
  // cancellation aborts the wait (extra.signal); other tools ignore it.
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    const progressToken = request.params._meta?.progressToken;
    const ctx: AwaitContext = {
      signal: extra.signal,
      reportProgress:
        progressToken === undefined
          ? undefined
          : async (elapsedS, timeoutS, message) => {
              await extra.sendNotification({
                method: 'notifications/progress',
                params: { progressToken, progress: elapsedS, total: timeoutS, message },
              });
            },
    };

    return dispatchToolCall(apiClient, name, args, ctx);
  });

  console.error('All tools registered successfully');
}
