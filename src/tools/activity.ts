import { z } from 'zod';
import type { CaseActivityPage, TribeunalAPIClient } from '../client/api-client.js';

// Case-activity feed + agent-await tools.
//
// These are the propagation channel an executor agent uses to REACT to human
// decisions. MCP has no server->model push that reaches a running turn, and
// Claude Desktop hard-caps a single remote tool call at ~4 minutes, so the
// design is long-poll: the tool blocks (fetching on a fixed 5s interval) and
// returns either the awaited change or a `timedOut` result the agent re-arms.

/** Activity types the feed emits — mirrors the backend TrialActivity::TYPES. */
const ACTIVITY_TYPES = [
  'vote',
  'vote_revoked',
  'comment',
  'evidence_marked',
  'evidence_unmarked',
  'jury_joined',
  'trial_closed',
] as const;

export const GetCaseActivitySchema = z.object({
  caseId: z.string().describe('Case ID or UUID whose activity feed to read'),
  after: z
    .string()
    .optional()
    .describe('Opaque cursor from a previous response (latestCursor or an event cursor). Omit to get the tail (latest events).'),
  types: z
    .array(z.enum(ACTIVITY_TYPES))
    .optional()
    .describe('Restrict to these event types (e.g. ["vote","trial_closed"]). Omit for all.'),
  limit: z.number().int().min(1).max(100).optional().describe('Max events to return (1-100, default 50)'),
});

export const AwaitCaseActivitySchema = z.object({
  caseId: z.string().describe('Case ID or UUID to watch'),
  after: z
    .string()
    .optional()
    .describe('Cursor to watch from; omit to anchor at the current tail ("watch from now"). On re-arm, pass the previous latestCursor.'),
  types: z
    .array(z.enum(ACTIVITY_TYPES))
    .optional()
    .describe('Only wake for these event types (e.g. ["vote"] to wait for the next vote)'),
  timeoutS: z
    .number()
    .int()
    .min(5)
    .max(170)
    .default(120)
    .describe('Seconds to block waiting for new events (5-170, default 120). On timeout the result has timedOut:true — re-arm with the returned latestCursor.'),
});

export const AwaitVerdictSchema = z.object({
  caseId: z.string().describe('Case ID or UUID whose verdict to await'),
  timeoutS: z
    .number()
    .int()
    .min(5)
    .max(170)
    .default(150)
    .describe('Seconds to block waiting for the case to reach a verdict (5-170, default 150). Returns instantly if the case is already terminal.'),
});

/** Injectable side-channel so the worker can stream progress and cancellation, and tests can run deterministically. */
export interface AwaitContext {
  /** Called each poll tick with (elapsedSeconds, timeoutSeconds, message). */
  reportProgress?: (elapsedS: number, timeoutS: number, message: string) => void | Promise<void>;
  /** Cooperative cancellation; an AbortSignal satisfies this shape. */
  signal?: { aborted: boolean };
  /** Sleep hook (ms). Defaults to setTimeout; tests inject an instant stub. */
  sleep?: (ms: number) => Promise<void>;
}

/** Result of an await tool: the last fetched page plus the wait outcome. */
export type AwaitResult = CaseActivityPage & { timedOut: boolean; waitedS: number };

const POLL_INTERVAL_S = 5;

/**
 * Poll `fetchPage` on a fixed 5s interval until `isDone(page)` or the timeout
 * budget is spent. First fetch is at t=0; each subsequent tick sleeps
 * min(5, remaining) so the total wait lands exactly on `timeoutS`. Honors
 * `signal.aborted` and reports progress each tick.
 */
async function poll(
  fetchPage: () => Promise<CaseActivityPage>,
  isDone: (page: CaseActivityPage) => boolean,
  timeoutS: number,
  ctx: AwaitContext,
  label: string,
): Promise<AwaitResult> {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let elapsedS = 0;
  let page = await fetchPage();

  while (!isDone(page)) {
    if (ctx.signal?.aborted) break;
    const remaining = timeoutS - elapsedS;
    if (remaining <= 0) break;

    const waitS = Math.min(POLL_INTERVAL_S, remaining);
    await sleep(waitS * 1000);
    elapsedS += waitS;
    await ctx.reportProgress?.(elapsedS, timeoutS, `${label}: waiting ${elapsedS}/${timeoutS}s`);

    if (ctx.signal?.aborted) break;
    page = await fetchPage();
  }

  return { ...page, timedOut: !isDone(page), waitedS: elapsedS };
}

/**
 * Block until a NEW event appears on the case feed after the anchor cursor.
 * With `after` omitted, anchors at the current tail so only events created from
 * now on wake the caller. On timeout, latestCursor === the anchor (gapless
 * re-arm): pass it straight back into the next call.
 */
export async function awaitCaseActivity(
  apiClient: TribeunalAPIClient,
  args: { caseId: string; after?: string; types?: string[]; timeoutS: number },
  ctx: AwaitContext = {},
): Promise<AwaitResult> {
  let after = args.after;
  if (after === undefined) {
    const anchor = await apiClient.getCaseActivity(args.caseId, { types: args.types, limit: 1 });
    after = anchor.latestCursor ?? undefined;
  }

  return poll(
    () => apiClient.getCaseActivity(args.caseId, { after, types: args.types }),
    (page) => page.events.length > 0,
    args.timeoutS,
    ctx,
    'await_case_activity',
  );
}

/**
 * Block until the case reaches a verdict (terminal state). STATE-based, not
 * cursor-based: it re-reads the tail and returns as soon as `verdict != null`,
 * so it returns instantly when the case is already terminal — a cursor-await
 * armed after closure would hang forever, which is why this tool exists.
 */
export async function awaitVerdict(
  apiClient: TribeunalAPIClient,
  args: { caseId: string; timeoutS: number },
  ctx: AwaitContext = {},
): Promise<AwaitResult> {
  return poll(
    () => apiClient.getCaseActivity(args.caseId, { limit: 1 }),
    (page) => page.verdict !== null,
    args.timeoutS,
    ctx,
    'await_verdict',
  );
}

/**
 * One-line human summary of a verdict result, e.g.
 * `Verdict: "Ship it" by unanimous (1/1)`. Prepended to await_verdict output so
 * the outcome is legible before the JSON. Returns null when there is no verdict
 * yet (timed out short of terminal).
 */
export function verdictHeadline(result: AwaitResult): string | null {
  const v = result.verdict;
  if (v === null) return null;
  const winnerVotes = v.sides.filter((s) => s.isWinner).reduce((n, s) => n + s.totalVotes, 0);
  return `Verdict: "${v.name ?? '—'}" by ${v.typeName} (${winnerVotes}/${v.totalVotes})`;
}
