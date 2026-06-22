# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start development server with hot reload
- `npm run build` - Compile TypeScript to dist/
- `npm start` - Run compiled production code
- `npm run lint` - Run ESLint with TypeScript rules
- `npm run format` - Format code with Prettier

### Testing
- `npm test` - Run Jest tests (currently no tests implemented)

## Architecture Overview

This is a **Model Context Protocol (MCP) Server** that provides programmatic access to the Tribeunal platform - a community-driven decision-making system. The server enables AI agents to interact with Tribeunal's voting, trial management, and community features.

### Key Components

**Entry Point**: `src/index.ts` - MCP stdio transport setup
**Core Server**: `src/server.ts` - Tool registration and request handling with Zod validation
**API Client**: `src/client/api-client.ts` - Axios-based HTTP client with Bearer token auth
**Tools**: `src/tools/` - MCP tool schemas organized by domain:
- `trials.ts` - Trial/decision management
- `votes.ts` - Voting system  
- `tribes.ts` - Community management
- `users.ts` - User profiles
- `decisions.ts` - Decision-focused workflows

### Authentication
- Uses Bearer token authentication via `TRIBEUNAL_API_KEY` environment variable
- API client in `src/client/api-client.ts` handles auth headers automatically
- SSL verification configurable via `TRIBEUNAL_SSL_VERIFY` env var

### Data Flow
1. MCP tools defined in `src/tools/` with Zod schemas
2. Server in `src/server.ts` registers tools and validates requests
3. API client in `src/client/api-client.ts` makes authenticated HTTP calls
4. Responses formatted via `src/utils/format.ts`

### Cloudflare Worker (`worker/`)

An alternative deployment of the Tribeunal MCP tools as a Cloudflare Worker using `workers-mcp`.

**Entry Point**: `worker/src/index.ts` - `WorkerEntrypoint` class with JSDoc-annotated methods
**Config**: `worker/wrangler.jsonc` - Cloudflare Worker configuration
**Docs Generation**: `workers-mcp docgen` parses JSDoc comments into MCP tool metadata

Key differences from the stdio server:
- Uses `fetch()` instead of `axios` (Workers runtime)
- Auth via Cloudflare secrets (`TRIBEUNAL_API_KEY`, `TRIBEUNAL_API_BASE_URL`, `SHARED_SECRET`)
- Methods return `string` (JSON-serialized) — required by `workers-mcp`
- Tool definitions derived from JSDoc annotations, not Zod schemas
- Deployed to Cloudflare's edge network

#### Worker Commands
- `cd worker && npm run dev` - Local development with Wrangler
- `cd worker && npm run deploy` - Generate docs and deploy to Cloudflare
- `cd worker && npx workers-mcp secret generate` - Generate shared secret
- `cd worker && npx workers-mcp secret upload` - Upload shared secret to Cloudflare
- `cd worker && npx wrangler secret put <NAME>` - Set environment secrets

### Error Handling
- Custom `TribeunalAPIError` class for API errors (stdio server)
- Workers throw errors with status code and response body
- Comprehensive error propagation through MCP protocol
- Request/response interceptors in API client

## Related Repositories

**Main Tribeunal Application**: [pentarim/tribeunal](https://github.com/pentarim/tribeunal)
- Contains the core Tribeunal platform implementation
- Web application with user interface and API endpoints
- Database models and business logic
- Useful for understanding the full system architecture and API contracts

## Development Notes

### Environment Setup
- Requires Node.js 18+
- Uses TypeScript with strict mode and ES2022 target
- Environment variables in `.env` file (see `.env.example`)

### Code Organization
- Modular tool architecture allows easy extension
- Type-safe parameter validation with Zod
- Consistent error handling patterns
- ESM modules throughout

### Key Dependencies
- `@modelcontextprotocol/sdk` - MCP protocol implementation (stdio server)
- `workers-mcp` - Cloudflare Worker MCP integration (worker)
- `axios` - HTTP client (stdio server)
- `zod` - Schema validation (stdio server)
- `dotenv` - Environment management (stdio server)
- `wrangler` - Cloudflare Workers CLI (worker)

### Testing
- Jest configured but no tests implemented yet
- Test structure exists in project but needs implementation
- Focus areas: tool schemas, API client, MCP protocol compliance