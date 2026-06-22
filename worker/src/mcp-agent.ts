import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpAgent } from 'agents/mcp';
import { TribeunalAPIClient } from '../../src/client/api-client';
import { dispatchToolCall, TOOL_DEFINITIONS } from '../../src/core/tools';
import type { Env, UserProps } from './types';

/**
 * Remote Tribeunal MCP server, one Durable Object per session.
 *
 * Authentication is handled upstream by `@cloudflare/workers-oauth-provider`
 * (see `index.ts` + `auth0-handler.ts`): by the time `init()` runs, the user has
 * completed Auth0 Universal Login and `this.props` carries their Auth0 access
 * token. Every one of the 32 shared tools is therefore executed AS the
 * logged-in human — the API client forwards `props.upstreamAccessToken` as a
 * Bearer token, which the Symfony resource server validates and maps to that
 * user.
 *
 * Tools are registered on the low-level MCP `Server` (exposed by `McpServer` as
 * `.server`) using the SAME JSON-Schema `TOOL_DEFINITIONS` and `dispatchToolCall`
 * the stdio transport uses. This keeps the 32 tools byte-identical across both
 * transports and sidesteps re-deriving Zod shapes for the high-level helper.
 */
export class TribeunalMCP extends McpAgent<Env, Record<string, never>, UserProps> {
  server = new McpServer(
    {
      name: 'tribeunal-mcp-server',
      version: '1.0.0',
    },
    // We register tools on the low-level server via setRequestHandler (below),
    // so the `tools` capability must be declared explicitly — McpServer only
    // auto-declares it when you use its high-level registerTool() helper.
    { capabilities: { tools: {} } },
  );

  /** Build a per-session API client bound to the logged-in user's token. */
  private apiClient(): TribeunalAPIClient {
    return new TribeunalAPIClient({
      baseURL: this.env.TRIBEUNAL_API_BASE_URL,
      // The Auth0 access token minted for this user (audience = Tribeunal API).
      bearerToken: this.props?.upstreamAccessToken,
      // No https.Agent on Workers — the runtime handles TLS to tribeunal.com.
    });
  }

  async init(): Promise<void> {
    const lowLevel = this.server.server;

    // tools/list — advertise the shared 32 tool definitions verbatim.
    lowLevel.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOL_DEFINITIONS as unknown as Array<{
        name: string;
        description?: string;
        inputSchema: Record<string, unknown>;
      }>,
    }));

    // tools/call — route every call through the per-user API client.
    lowLevel.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return dispatchToolCall(this.apiClient(), name, args);
    });
  }
}
