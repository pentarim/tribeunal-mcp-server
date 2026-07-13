# Security Policy

## Reporting a vulnerability

Please report security issues privately to **pentarim@gmail.com** (subject: `[SECURITY] tribeunal-mcp-server`). Do not open public GitHub issues for vulnerabilities. You should receive a response within 72 hours.

## Authentication model

- **Remote server** (`mcp.tribeunal.com`): OAuth 2.1 with PKCE via Auth0. Access tokens are audience-restricted RS256 JWTs validated by the Tribeunal API; every tool call executes as the signed-in user. The Worker holds no shared credentials. OAuth grants are stored in Cloudflare KV; sessions are isolated per Durable Object.
- **Local stdio server** (npm): a personal API key passed as `TRIBEUNAL_API_KEY`, sent as a Bearer token. Keys are stored Argon2ID-hashed server-side, displayed exactly once at generation, and can be rotated or revoked at any time at [tribeunal.com/profile/api-key](https://tribeunal.com/profile/api-key).

## Rate limits

- 100 API requests/hour per IP
- 10 failed authentication attempts/minute per IP
- 5 API-key generations/hour per user

## Scope

This policy covers the code in this repository (stdio server + Cloudflare Worker). For issues in the Tribeunal platform itself (tribeunal.com), use the same contact address.
