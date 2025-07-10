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

### Error Handling
- Custom `TribeunalAPIError` class for API errors
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
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `axios` - HTTP client
- `zod` - Schema validation
- `dotenv` - Environment management

### Testing
- Jest configured but no tests implemented yet
- Test structure exists in project but needs implementation
- Focus areas: tool schemas, API client, MCP protocol compliance