import axios, { AxiosInstance, AxiosError } from 'axios';

export class TribeunalAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'TribeunalAPIError';
  }
}

/**
 * Pull a human-readable message out of a Tribeunal API error body.
 *
 * The API renders errors via API Platform, so the useful text lives in
 * `detail` (problem+json / APIP 4) or `hydra:description` (Hydra / APIP 3),
 * with field-level issues in `violations` — NOT in a top-level `message`.
 * Reading only `message` (the previous behaviour) collapsed every failure to a
 * bare "Request failed with status code 400", which is what made callers guess
 * blindly. Falls back through the older shapes and finally `fallback`.
 */
export function extractApiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, any>;
    if (typeof d.reason === 'string' && d.reason.trim()) {
      return typeof d.message === 'string' && d.message.trim() ? `${d.reason}: ${d.message}` : d.reason;
    }
    if (typeof d.detail === 'string' && d.detail.trim()) return d.detail;
    if (typeof d['hydra:description'] === 'string' && d['hydra:description'].trim()) return d['hydra:description'];
    if (Array.isArray(d.violations) && d.violations.length) {
      const msg = d.violations
        .map((v: any) => (v?.propertyPath ? `${v.propertyPath}: ${v.message}` : v?.message))
        .filter(Boolean)
        .join('; ');
      if (msg) return msg;
    }
    if (typeof d.error === 'string' && d.error.trim()) return d.error;
    if (d.error && typeof d.error.message === 'string' && d.error.message.trim()) return d.error.message;
    if (typeof d.message === 'string' && d.message.trim()) return d.message;
    if (typeof d.title === 'string' && d.title.trim()) {
      const title = d.title.trim();
      // API Platform's generic problem+json title for an unhandled HttpException
      // (a plain 404 on a deleted/unknown resource, for instance) is the
      // carries-no-information "An error occurred" -- worse than useless once
      // wrapped as "API Error: An error occurred", since every status then
      // reads the same. Swap it for the status code plus its standard reason
      // phrase so a 404 is never indistinguishable from a 403 or a 500.
      if (title.toLowerCase() === 'an error occurred' && typeof d.status === 'number') {
        return `${d.status} ${HTTP_STATUS_TEXT[d.status] ?? title}`;
      }
      return title;
    }
    if (typeof d.status === 'number') return `${d.status} ${HTTP_STATUS_TEXT[d.status] ?? 'request failed'}`;
  }
  return fallback;
}

const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

export interface TribeunalAPIClientConfig {
  /** Base URL of the Tribeunal API, e.g. https://tribeunal.com/api */
  baseURL: string;
  /**
   * Bearer token sent as `Authorization: Bearer <token>` on every request.
   * For the stdio/persona path this is a legacy API key; for the Cloudflare
   * worker path this is the per-user Auth0 access token.
   */
  bearerToken?: string;
  /**
   * Optional pre-built Node `https.Agent` (typed loosely so this file carries no
   * dependency on Node's type declarations and stays compilable in the
   * Cloudflare Workers type environment). The stdio path injects one via
   * `createApiClientFromEnv()` to control TLS verification; the worker omits it
   * and lets the Workers runtime handle TLS.
   */
  httpsAgent?: unknown;
}

/** One event in the case-activity feed. */
export interface CaseActivityEvent {
  cursor: string;
  type: string;
  actorUsername: string;
  /** The actor's persona full name when actorIsAi and not anonymized; identical to actorUsername otherwise (a human, or an anonymized juror). */
  actorDisplayName: string;
  actorIsAi: boolean;
  sideUuid: string | null;
  sideName: string | null;
  sideColor: number | null;
  text: string | null;
  refUuid: string | null;
  createdAt: string;
}

/** The machine-readable verdict block (non-null once the case is terminal). */
export interface CaseVerdict {
  decided: boolean;
  decisionUuid: string | null;
  type: number;
  typeName: string;
  name: string | null;
  text: string | null;
  winningSides: Array<{ uuid: string; name: string | null }>;
  sides: Array<{ uuid: string; name: string | null; totalVotes: number; votePercentage: number; isWinner: boolean }>;
  totalVotes: number;
  decidedAt: string | null;
  /** 1 for a case decided once; increments per reopen. */
  version: number;
  /** Verdicts reached before the most recent reopen, oldest first. */
  supersededVerdicts: Array<{ decisionUuid: string; type: number; typeName: string; name: string | null; decidedAt: string | null }>;
  /** Why the verdict is Void, or null on an ordinary verdict (a plain tie included). */
  voidReason: 'quorum_not_met' | 'requirement_not_met' | null;
  /** required is the case's minVotes (0 when it set none). */
  quorum: { required: number; received: number };
  /** A guest vote has no owner; every other vote is a person or an AI persona. */
  voterBreakdown: { human: number; ai: number; guest: number };
}

/** Response of GET /api/cases/{uuid}/activity. */
export interface CaseActivityPage {
  caseUuid: string;
  caseState: string;
  caseEndsAt: string | null;
  events: CaseActivityEvent[];
  latestCursor: string | null;
  hasMore: boolean;
  verdict: CaseVerdict | null;
}

export class TribeunalAPIClient {
  private client: AxiosInstance;
  private bearerToken: string | undefined;
  private baseOrigin: string;

  constructor(config: TribeunalAPIClientConfig) {
    const { baseURL, bearerToken, httpsAgent } = config;
    this.baseOrigin = new URL(baseURL).origin;
    this.bearerToken = bearerToken;

    const axiosConfig: Parameters<typeof axios.create>[0] = {
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000,
    };

    // The stdio path may inject a Node `https.Agent` (e.g. to allow the
    // self-signed tribeunal.test cert in dev). On Cloudflare Workers no agent is
    // passed and the runtime handles TLS natively.
    if (httpsAgent) {
      axiosConfig.httpsAgent = httpsAgent;
    }

    this.client = axios.create(axiosConfig);

    // Add auth interceptor
    this.client.interceptors.request.use((requestConfig) => {
      if (this.bearerToken) {
        requestConfig.headers['Authorization'] = `Bearer ${this.bearerToken}`;
      }
      return requestConfig;
    });

    // Add error interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const message = extractApiErrorMessage(error.response?.data, error.message);
        const statusCode = error.response?.status;
        throw new TribeunalAPIError(message, statusCode, error.response?.data);
      }
    );
  }

  /**
   * PATCH helper with a per-request Content-Type override. Most PATCH bodies are
   * plain JSON; the Tribe PATCH op uses default (de)serialization and therefore
   * requires `application/merge-patch+json` (an ApiResource Patch with
   * `deserialize:false`, like the case/comment PATCHes here, does not).
   */
  private async patch<T = unknown>(path: string, body: unknown, contentType: string = 'application/json'): Promise<T> {
    const response = await this.client.patch(path, body, {
      headers: { 'Content-Type': contentType },
    });
    return response.data as T;
  }

  // Case endpoints
  async searchCases(params: {
    query?: string;
    status?: string;
    type?: string;
    tags?: string[];
    page?: number;
    limit?: number;
  }) {
    const response = await this.client.get('/cases', { params });
    return response.data;
  }

  async getCase(id: string) {
    const response = await this.client.get(`/cases/${id}`);
    return response.data;
  }

  /**
   * Fetch a page of the case-activity feed. Each call is a sub-second request,
   * far under the 30s axios timeout, so the await tools can poll it on a fixed
   * interval. `after` is an opaque cursor (omitted = tail of the latest events).
   */
  async getCaseActivity(
    caseId: string,
    opts: { after?: string; types?: string[]; limit?: number } = {},
  ): Promise<CaseActivityPage> {
    const params: Record<string, string | number> = {};
    if (opts.after) params.after = opts.after;
    if (opts.types && opts.types.length) params.types = opts.types.join(',');
    if (opts.limit !== undefined) params.limit = opts.limit;
    const response = await this.client.get(`/cases/${caseId}/activity`, { params });
    return response.data as CaseActivityPage;
  }

  async createCase(data: {
    title: string;
    description: string;
    type: 'case' | 'advice' | 'poll';
    juryType?: 'public' | 'invited';
    visibility?: 'public' | 'private';
    sides: Array<{ name: string; description?: string; image?: string }>;
    caseLength?: number;
    maxAiJurorPercentage?: number;
    jurorCount?: number;
    openImmediately?: boolean;
    allowsGuestVotes?: boolean;
    arbitrationMode?: boolean;
    decisionRequirement?: 'any' | 'simple' | 'qualified' | 'unanimous';
    minVotes?: number;
    tags?: string[];
  }) {
    const { caseLength, ...rest } = data;
    // The backend's create contract still names the duration `trialLength`; this
    // is the single internal mapping from the user-facing `caseLength`. Every other
    // field (openImmediately, allowsGuestVotes and the three arbitration fields
    // included) forwards verbatim;
    // omitting either lets the backend default it — true and false respectively.
    // Each side's `image` maps to the backend's `imageUrl` field the same way.
    const sides = rest.sides.map(({ image, ...side }) => (image === undefined ? side : { ...side, imageUrl: image }));
    const body = caseLength === undefined ? { ...rest, sides } : { ...rest, sides, trialLength: caseLength };
    const response = await this.client.post('/cases', body);
    return response.data;
  }

  async closeCase(caseId: string) {
    // POST /api/cases/{uuid}/close — the API Platform close operation (uses the /api
    // baseURL like createCase, not baseOrigin). No request body. Owner/admin only,
    // open cases only; the verdict is determined asynchronously by the backend pipeline.
    const response = await this.client.post(`/cases/${caseId}/close`);
    return response.data;
  }

  async updateSideImage(sideId: string, imageUrl: string) {
    // POST /api/sides/{uuid}/image {url} — owner-only, uuid-only. Uses the /api baseURL
    // like createCase. A 422 carries {reason, message}; the response interceptor surfaces it.
    const response = await this.client.post(`/sides/${sideId}/image`, { url: imageUrl });
    return response.data;
  }

  /** PATCH /api/cases/{uuid} — owner/admin only; body is {title?, description?} plain JSON. */
  async updateCase(caseId: string, body: { title?: string; description?: string }) {
    return this.patch(`/cases/${caseId}`, body);
  }

  /** DELETE /api/cases/{uuid} → 204 — owner/admin only, and only while the case has no vote history. */
  async deleteCase(caseId: string) {
    const response = await this.client.delete(`/cases/${caseId}`);
    return response.data;
  }

  // Vote endpoints (these routes have no /api/ prefix)
  async castVote(caseId: string, sideId: string, comment?: string) {
    const params = new URLSearchParams();
    params.append('side_id', sideId);
    // Optional rationale: stored server-side as a vote-linked comment shown
    // in the case activity feed.
    if (comment && comment.trim() !== '') {
      params.append('comment', comment.trim());
    }
    const response = await this.client.post(`${this.baseOrigin}/cases/${caseId}/vote`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data;
  }

  async joinJury(caseId: string) {
    // Seats the caller on a case's jury. Like the vote routes this lives on the
    // web origin, NOT under /api, and needs no body — the caller is the subject.
    const response = await this.client.post(`${this.baseOrigin}/cases/${caseId}/jury/join`, undefined);
    return response.data;
  }

  /**
   * POST /api/cases/{uuid}/jury/leave — unlike joinJury/castVote/revokeVote, this
   * route IS under /api (uses the /api baseURL like createCase, not baseOrigin).
   * Frees the caller's own jury seat; requeues or cancels a matched matchmaking
   * request server-side.
   */
  async leaveJury(caseId: string) {
    const response = await this.client.post(`/cases/${caseId}/jury/leave`);
    return response.data;
  }

  async revokeVote(caseId: string, sideId: string) {
    // The trailing segment is the SIDE uuid (the API looks up the caller's vote
    // by (user, case)); this vote route has no /api/ prefix.
    const response = await this.client.delete(`${this.baseOrigin}/cases/${caseId}/vote/${sideId}`);
    return response.data;
  }

  // Tribe endpoints
  async listTribes(params: {
    query?: string;
    page?: number;
    limit?: number;
  }) {
    const response = await this.client.get('/tribes', { params });
    return response.data;
  }

  async getTribe(id: string) {
    const response = await this.client.get(`/tribes/${id}`);
    return response.data;
  }

  /**
   * PATCH /api/tribes/{uuid} with Content-Type application/merge-patch+json — the
   * existing ApiResource Patch op (default deserialization, unlike the case/comment
   * PATCHes), so unlike those this one needs the merge-patch header. `body` is
   * already mapped to backend keys by the caller (visibility -> type as an int).
   * Owner or admin only.
   */
  async updateTribe(tribeId: string, body: Record<string, unknown>) {
    return this.patch(`/tribes/${tribeId}`, body, 'application/merge-patch+json');
  }

  /** DELETE /api/tribes/{uuid} → 204 — owner or admin only. Permanent. */
  async deleteTribe(tribeId: string) {
    const response = await this.client.delete(`/tribes/${tribeId}`);
    return response.data;
  }

  /**
   * Backs tribeunal_list_tribe_members via GET /api/tribes/{uuid}/members. Roster
   * is member-only: a private tribe the caller cannot view 404s, a viewable tribe
   * they are not in 403s. Hand-built scalars only — no member credentials.
   */
  async listTribeMembers(tribeId: string, params: { page?: number; limit?: number }) {
    const response = await this.client.get(`/tribes/${tribeId}/members`, { params });
    return response.data;
  }

  /**
   * DELETE /api/tribes/{uuid}/members/{user} — owner or admin only. `{user}` resolves
   * a username or a UUID on the backend; `username` is URL-encoded since it can carry
   * characters (e.g. a dot or plus in an email-shaped name) that would otherwise break
   * the path segment.
   */
  async removeTribeMember(tribeId: string, username: string) {
    const response = await this.client.delete(`/tribes/${tribeId}/members/${encodeURIComponent(username)}`);
    return response.data;
  }

  async joinTribe(tribeId: string) {
    const response = await this.client.post(`/tribes/${tribeId}/join`);
    return response.data;
  }

  async leaveTribe(tribeId: string) {
    const response = await this.client.post(`/tribes/${tribeId}/leave`);
    return response.data;
  }

  async createTribe(data: {
    name: string;
    description: string;
    tags?: string[];
    isPublic?: boolean;
  }) {
    const response = await this.client.post('/tribes', data);
    return response.data;
  }

  /**
   * Backs the tribeunal_invite_tribe_members tool via POST /api/tribes/{uuid}/invite.
   * Owner-only; a public tribe answers 400 because it is already open to everyone.
   */
  async inviteTribeMembers(tribeId: string, invitees: string[]) {
    const response = await this.client.post(`/tribes/${tribeId}/invite`, { invitees });
    return response.data;
  }

  /**
   * Backs tribeunal_create_webhook via POST /api/webhooks. The response is the
   * ONLY place the signing secret ever appears (besides an explicit rotate), so
   * it is returned to the caller verbatim rather than summarised away.
   */
  async createWebhook(data: { url: string; events: string[] }) {
    const response = await this.client.post('/webhooks', data);
    return response.data;
  }

  /** Backs tribeunal_list_webhooks via GET /api/webhooks. Never carries secrets. */
  async listWebhooks() {
    const response = await this.client.get('/webhooks');
    return response.data;
  }

  /**
   * Backs tribeunal_delete_webhook via DELETE /api/webhooks/{uuid}. Endpoints are
   * owner-scoped: someone else's uuid answers 404, exactly like an unknown one.
   */
  async deleteWebhook(webhookId: string) {
    const response = await this.client.delete(`/webhooks/${webhookId}`);
    return response.data;
  }

  /**
   * PATCH /api/webhooks/{uuid}/delivery — the narrow update route (events and/or
   * active only); the wide PATCH /api/webhooks/{uuid} (url) and POST .../rotate
   * are deliberately not called from the MCP surface (see ScopeMap). Owner only.
   */
  async updateWebhookDelivery(webhookId: string, body: { events?: string[]; active?: boolean }) {
    return this.patch(`/webhooks/${webhookId}/delivery`, body);
  }

  // User endpoints
  async getUser(id: string) {
    const response = await this.client.get(`/users/${id}`);
    return response.data;
  }

  async getCurrentUser() {
    const response = await this.client.get('/users/me');
    return response.data;
  }

  // Jury Duty endpoints
  async getJuryDutyStatus() {
    const response = await this.client.get('/jury-duty/status');
    return response.data;
  }

  /** GET /api/jury-duty/index?page=&limit= — cases the caller currently sits on. */
  async getJuryDutyIndex(page?: number, limit?: number) {
    const params: Record<string, number> = {};
    if (page !== undefined) params.page = page;
    if (limit !== undefined) params.limit = limit;
    const response = await this.client.get('/jury-duty/index', { params });
    return response.data;
  }

  async startJuryDuty() {
    const response = await this.client.post('/jury-duty/start');
    return response.data;
  }

  async cancelJuryDuty() {
    const response = await this.client.delete('/jury-duty/cancel');
    return response.data;
  }

  async getJuryDutyHistory(days: number = 7) {
    const response = await this.client.get('/jury-duty/allowance/history', { params: { days } });
    return response.data;
  }

  async inviteJurors(caseId: string, invitees?: string[], tribeId?: string) {
    // POST /api/cases/{uuid}/jury/invite — owner/admin only; works on any jury
    // type. An invite recruits, it never restricts public participation. Unknown
    // names don't fail the batch: each invitee is resolved independently and
    // reported back in `results`/`summary` as invited/duplicate/not_found. A
    // tribeId recruits the whole tribe (members + chieftain); at least one of the
    // two is required (the backend 400s `no_invitees` otherwise).
    const body: Record<string, unknown> = {};
    if (invitees !== undefined && invitees.length > 0) {
      body.invitees = invitees;
    }
    if (tribeId !== undefined) {
      body.tribeId = tribeId;
    }
    const response = await this.client.post(`/cases/${caseId}/jury/invite`, body);
    return response.data;
  }

  // Evidence endpoints
  async getCaseEvidence(caseId: string) {
    const response = await this.client.get(`/cases/${caseId}/evidence`);
    return response.data;
  }

  // Comment & evidence-mark endpoints. Evidence is marked, not submitted:
  // post a comment, then the case owner/jury can mark it (or a case file).
  async postComment(caseId: string, text: string) {
    const response = await this.client.post(`/cases/${caseId}/comments`, { text });
    return response.data;
  }

  async listComments(caseId: string) {
    const response = await this.client.get(`/cases/${caseId}/comments`);
    return response.data;
  }

  /** PATCH /api/comments/{id} — author only. */
  async updateComment(commentId: string, text: string) {
    return this.patch(`/comments/${commentId}`, { text });
  }

  /** DELETE /api/comments/{id} → 204 — author, case owner, or admin. */
  async deleteComment(commentId: string) {
    const response = await this.client.delete(`/comments/${commentId}`);
    return response.data;
  }

  async markEvidence(kind: 'comment' | 'file', id: string) {
    const path = kind === 'comment' ? `/comments/${id}/mark` : `/case-files/${id}/mark`;
    const response = await this.client.post(path);
    return response.data;
  }

  async unmarkEvidence(kind: 'comment' | 'file', id: string) {
    const path = kind === 'comment' ? `/comments/${id}/mark` : `/case-files/${id}/mark`;
    const response = await this.client.delete(path);
    return response.data;
  }

  async rateEvidence(evidenceId: string, rating: number, sideId?: string) {
    // rating is a domain value: 1 (up) / 0 (irrelevant) / -1 (down).
    // Served by POST /api/evidence/{id}/rate.
    const body: { rating: number; sideId?: string } = { rating };
    if (sideId) {
      body.sideId = sideId;
    }
    const response = await this.client.post(`/evidence/${evidenceId}/rate`, body);
    return response.data;
  }
}

