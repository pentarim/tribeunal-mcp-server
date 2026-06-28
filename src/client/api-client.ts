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
    if (typeof d.title === 'string' && d.title.trim()) return d.title;
  }
  return fallback;
}

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

  async createCase(data: {
    title: string;
    description: string;
    type: 'case' | 'advice' | 'poll';
    juryType: 'public' | 'invited';
    sides: Array<{ name: string; description?: string }>;
    caseLength?: number;
    tags?: string[];
  }) {
    const { caseLength, ...rest } = data;
    // The backend's create contract still names the duration `trialLength`; this
    // is the single internal mapping from the user-facing `caseLength`.
    const body = caseLength === undefined ? rest : { ...rest, trialLength: caseLength };
    const response = await this.client.post('/cases', body);
    return response.data;
  }

  // Vote endpoints (these routes have no /api/ prefix)
  async castVote(caseId: string, sideId: string) {
    const params = new URLSearchParams();
    params.append('side_id', sideId);
    const response = await this.client.post(`${this.baseOrigin}/cases/${caseId}/vote`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data;
  }

  async revokeVote(caseId: string, sideId: string) {
    // The trailing segment is the SIDE uuid (the API looks up the caller's vote
    // by (user, case)); this vote route has no /api/ prefix.
    const response = await this.client.delete(`${this.baseOrigin}/cases/${caseId}/vote/${sideId}`);
    return response.data;
  }

  async getVoteStats(caseId: string) {
    // Served by GET /api/cases/{uuid}/votes (uses the /api baseURL, not baseOrigin).
    const response = await this.client.get(`/cases/${caseId}/votes`);
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
  }) {
    const response = await this.client.post('/tribes', data);
    return response.data;
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

  async getJuryDutyAllowance() {
    const response = await this.client.get('/jury-duty/allowance');
    return response.data;
  }

  async getJuryDutyDashboard() {
    const response = await this.client.get('/jury-duty/index');
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

  async acceptJuryDuty(memberId: string) {
    const response = await this.client.post(`/jury-duty/accept/${memberId}`);
    return response.data;
  }

  async rejectJuryDuty(memberId: string) {
    const response = await this.client.post(`/jury-duty/reject/${memberId}`);
    return response.data;
  }

  async getJuryDutyHistory(days: number = 7) {
    const response = await this.client.get('/jury-duty/allowance/history', { params: { days } });
    return response.data;
  }

  // Evidence endpoints
  async getCaseEvidence(caseId: string) {
    const response = await this.client.get(`/cases/${caseId}/evidence`);
    return response.data;
  }

  async submitEvidence(caseId: string, data: {
    content: string;
    type: 'text' | 'link' | 'image';
    sideId?: string;
  }) {
    const response = await this.client.post(`/cases/${caseId}/evidence`, data);
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

