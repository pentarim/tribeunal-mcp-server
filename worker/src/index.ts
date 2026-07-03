import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { env } from 'cloudflare:workers';
import { Auth0Handler, makeTokenExchangeCallback } from './auth0-handler';
import { TribeunalMCP } from './mcp-agent';
import type { Env } from './types';

// Re-export the Durable Object class so the runtime can instantiate it
// (the wrangler `durable_objects` binding `MCP_OBJECT` points at this class).
export { TribeunalMCP };

// The ten Tribeunal resource scopes plus the OIDC standard scopes.
// MUST stay in sync with docs/AUTH0_CONTRACT.md §4.1 / the worker's AUTH0_SCOPE.
const SCOPES_SUPPORTED = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'read:trials',
  'create:trials',
  'vote:cast',
  'vote:revoke',
  'post:comments',
  'mark:evidence',
  'rate:evidence',
  'manage:tribes',
  'jury:duty',
  'read:profile',
];

export default new OAuthProvider({
  // Two MCP transports: SSE (legacy clients / mcp-remote) and Streamable HTTP.
  apiHandlers: {
    '/sse': TribeunalMCP.serveSSE('/sse'),
    '/mcp': TribeunalMCP.serve('/mcp'),
  },
  // Auth0 Universal Login + consent + callback live in the Hono app.
  defaultHandler: Auth0Handler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: SCOPES_SUPPORTED,
  // Keep the upstream Auth0 tokens fresh and mirror their TTL onto MCP tokens.
  tokenExchangeCallback: makeTokenExchangeCallback(env as Env),
});
