import { z } from 'zod';

import { webhookUuid } from './uuid.js';

/**
 * The complete catalog the backend accepts. It is spelled out rather than left
 * as a free string so a typo is refused here, with the valid names in the error,
 * instead of arriving as an opaque 400 invalid_events.
 */
export const WEBHOOK_EVENTS = [
  'case.opened',
  'case.closed',
  'vote.cast',
  'vote.revoked',
  'comment.created',
  'evidence.marked',
  'evidence.unmarked',
  'jury.joined',
  'ping',
  'dispute.opened',
  'appeal.filed',
  'ruling.final',
] as const;

// The URL is checked again server-side (and once more at delivery): it must be an
// absolute https URL that does not resolve to a private, loopback, link-local or
// CGNAT address, and must not carry credentials. Checking the scheme here turns
// the most common mistake into an immediate, readable failure.
export const CreateWebhookSchema = z.object({
  url: z
    .string()
    .url()
    .startsWith('https://', 'Webhook URLs must be absolute https URLs.')
    .max(2048)
    .describe('Absolute https URL to receive the signed POST deliveries; rejected (400 invalid_url / url_not_allowed) if it isn\'t https, carries embedded credentials, or resolves to a private, loopback, link-local, or CGNAT address.'),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1)
    .describe("One or more of case.opened, case.closed, vote.cast, vote.revoked, comment.created, evidence.marked, evidence.unmarked, jury.joined, ping, dispute.opened, appeal.filed, ruling.final; an unknown name answers 400 invalid_events. 'ping' fires only when the endpoint is pinged from the web dashboard or API — no MCP tool sends it."),
});

export const ListWebhooksSchema = z.object({});

export const DeleteWebhookSchema = z.object({
  webhookId: webhookUuid("Endpoint UUID, from tribeunal_list_webhooks or the tribeunal_create_webhook response. An endpoint you don't own, or an unknown uuid, both answer 404 webhook_not_found."),
});

export const UpdateWebhookSchema = z.object({
  webhookId: webhookUuid("Endpoint UUID, from tribeunal_list_webhooks or the tribeunal_create_webhook response. An endpoint you don't own, or an unknown uuid, both answer 404 webhook_not_found."),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1)
    .optional()
    .describe("Replaces the endpoint's entire subscribed-event list (not merged) — pass every event you still want, from the same catalog as tribeunal_create_webhook. Omit to leave the current subscription untouched."),
  active: z.boolean().optional()
    .describe('false pauses delivery without deleting the endpoint; true resumes it. Independent of events — pass either, both, or (refused) neither.'),
}).refine((v) => v.events !== undefined || v.active !== undefined, {
  message: 'Provide events and/or active to update the webhook',
});
