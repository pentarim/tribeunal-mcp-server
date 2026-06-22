import https from 'node:https';
import { TribeunalAPIClient } from './api-client.js';

/**
 * Build a client from `process.env` for the stdio / persona transport.
 *
 * Node-only: this module reads `process.env` and is therefore imported solely by
 * the stdio entry point. The Cloudflare worker NEVER imports it — the worker
 * constructs its client directly with the logged-in user's Auth0 access token,
 * which keeps Node globals (`process`) out of the worker's type-check/bundle.
 *
 * Preserves the historical environment-variable contract so the local/persona
 * path keeps working unchanged:
 *   - TRIBEUNAL_API_BASE_URL  (default: https://tribeunal.test/api)
 *   - TRIBEUNAL_API_KEY       (sent as a Bearer token — legacy per-persona key)
 *   - TRIBEUNAL_VERIFY_SSL    ('false' disables TLS verification)
 */
export function createApiClientFromEnv(): TribeunalAPIClient {
  const verifySsl = process.env.TRIBEUNAL_VERIFY_SSL !== 'false';
  return new TribeunalAPIClient({
    baseURL: process.env.TRIBEUNAL_API_BASE_URL || 'https://tribeunal.test/api',
    bearerToken: process.env.TRIBEUNAL_API_KEY,
    httpsAgent: new https.Agent({ rejectUnauthorized: verifySsl }),
  });
}
