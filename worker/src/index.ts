import { WorkerEntrypoint } from 'cloudflare:workers';
import { WorkerMCP } from 'workers-mcp';

interface Env {
  SHARED_SECRET: string;
  TRIBEUNAL_API_BASE_URL: string;
  TRIBEUNAL_API_KEY: string;
}

export default class TribeunalMCP extends WorkerEntrypoint<Env> {
  private get baseURL(): string {
    return this.env.TRIBEUNAL_API_BASE_URL || 'https://tribeunal.test/api';
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.env.TRIBEUNAL_API_KEY}`,
    };
  }

  /** @ignore */
  private async request(path: string, options?: RequestInit): Promise<unknown> {
    const url = `${this.baseURL}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...(options?.headers as Record<string, string>) },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tribeunal API error ${res.status}: ${body}`);
    }
    return res.json();
  }

  /**
   * Search for active decisions/trials on Tribeunal with optional filters.
   *
   * @param query {string} Search query for title or description
   * @param status {string} Filter by status: init, open, closed, expired, suspended
   * @param type {string} Filter by type: case, advice, poll
   * @param page {number} Page number for pagination
   * @param limit {number} Results per page (max 100)
   * @return {string} JSON list of matching decisions
   */
  async searchDecisions(
    query?: string,
    status?: string,
    type?: string,
    page?: number,
    limit?: number,
  ): Promise<string> {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (page) params.set('page', String(page));
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    const data = await this.request(`/cases${qs ? `?${qs}` : ''}`);
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get detailed information about a specific decision/trial.
   *
   * @param id {string} Decision ID or UUID
   * @return {string} JSON with full decision details
   */
  async getDecision(id: string): Promise<string> {
    const data = await this.request(`/cases/${id}`);
    return JSON.stringify(data, null, 2);
  }

  /**
   * Create a new decision/trial for community voting.
   *
   * @param title {string} Decision title (3-200 chars)
   * @param description {string} Detailed description (min 10 chars)
   * @param type {string} Type: case (binding), advice (input), or poll (opinion)
   * @param sides {string} JSON array of options, e.g. [{"name":"Option A"},{"name":"Option B"}]
   * @param juryType {string} Participation: public or invited
   * @param trialLength {number} Duration in seconds (default 86400)
   * @return {string} JSON with created decision details including UUID and URL
   */
  async createDecision(
    title: string,
    description: string,
    type: string,
    sides: string,
    juryType?: string,
    trialLength?: number,
  ): Promise<string> {
    const data = await this.request('/cases', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description,
        type,
        sides: JSON.parse(sides),
        juryType: juryType || 'public',
        trialLength: trialLength || 86400,
      }),
    });
    return JSON.stringify(data, null, 2);
  }

  /**
   * Cast a vote on a decision for a specific option/side.
   *
   * @param trialId {string} Decision/trial ID to vote on
   * @param sideId {string} Option/side ID to vote for
   * @return {string} JSON with vote confirmation
   */
  async castVote(trialId: string, sideId: string): Promise<string> {
    const baseOrigin = new URL(this.baseURL).origin;
    const params = new URLSearchParams();
    params.set('side_id', sideId);
    const res = await fetch(`${baseOrigin}/cases/${trialId}/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${this.env.TRIBEUNAL_API_KEY}`,
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Vote failed ${res.status}: ${body}`);
    }
    const data = await res.json();
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get real-time voting statistics for a decision.
   *
   * @param trialId {string} Decision/trial ID
   * @return {string} JSON with vote counts and statistics
   */
  async getVoteStats(trialId: string): Promise<string> {
    const baseOrigin = new URL(this.baseURL).origin;
    const res = await fetch(`${baseOrigin}/cases/${trialId}/votes`, {
      headers: this.headers,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get vote stats ${res.status}: ${body}`);
    }
    const data = await res.json();
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get all evidence submitted for a decision.
   *
   * @param trialId {string} Decision/trial ID
   * @return {string} JSON array of evidence items
   */
  async getEvidence(trialId: string): Promise<string> {
    const data = await this.request(`/cases/${trialId}/evidence`);
    return JSON.stringify(data, null, 2);
  }

  /**
   * Submit evidence or supporting information for a decision.
   *
   * @param trialId {string} Decision/trial ID
   * @param content {string} Evidence content
   * @param type {string} Evidence type: text, link, or image
   * @param sideId {string} Optional side ID this evidence supports
   * @return {string} JSON with submitted evidence details
   */
  async submitEvidence(
    trialId: string,
    content: string,
    type?: string,
    sideId?: string,
  ): Promise<string> {
    const body: Record<string, string> = { content, type: type || 'text' };
    if (sideId) body.sideId = sideId;
    const data = await this.request(`/cases/${trialId}/evidence`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return JSON.stringify(data, null, 2);
  }

  /**
   * Browse available tribes/communities on Tribeunal.
   *
   * @param query {string} Search query for tribe name or description
   * @param page {number} Page number
   * @param limit {number} Results per page
   * @return {string} JSON list of tribes
   */
  async listTribes(query?: string, page?: number, limit?: number): Promise<string> {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (page) params.set('page', String(page));
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    const data = await this.request(`/tribes${qs ? `?${qs}` : ''}`);
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get detailed information about a specific tribe.
   *
   * @param id {string} Tribe ID or slug
   * @return {string} JSON with tribe details, members, and structure
   */
  async getTribe(id: string): Promise<string> {
    const data = await this.request(`/tribes/${id}`);
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get the current authenticated user's profile.
   *
   * @return {string} JSON with user profile information
   */
  async getCurrentUser(): Promise<string> {
    const data = await this.request('/users/me');
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get a user's public profile by ID or username.
   *
   * @param id {string} User ID or username
   * @return {string} JSON with public user profile
   */
  async getUser(id: string): Promise<string> {
    const data = await this.request(`/users/${id}`);
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get current jury duty status, queue position, and active assignments.
   *
   * @return {string} JSON with jury duty status
   */
  async getJuryDutyStatus(): Promise<string> {
    const data = await this.request('/jury-duty/status');
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get jury duty dashboard with assignments, allowance, and active requests.
   *
   * @return {string} JSON with full jury duty dashboard
   */
  async getJuryDutyDashboard(): Promise<string> {
    const data = await this.request('/jury-duty/index');
    return JSON.stringify(data, null, 2);
  }

  /**
   * Start a jury duty search to be assigned to a trial needing jurors.
   *
   * @return {string} JSON with jury duty request status
   */
  async startJuryDuty(): Promise<string> {
    const data = await this.request('/jury-duty/start', { method: 'POST' });
    return JSON.stringify(data, null, 2);
  }

  /**
   * Cancel an active jury duty search request.
   *
   * @return {string} JSON confirmation of cancellation
   */
  async cancelJuryDuty(): Promise<string> {
    const data = await this.request('/jury-duty/cancel', { method: 'DELETE' });
    return JSON.stringify(data, null, 2);
  }

  /**
   * Accept a jury duty assignment to serve on a trial.
   *
   * @param memberId {string} Member ID from the jury assignment
   * @return {string} JSON with accepted assignment details
   */
  async acceptJuryDuty(memberId: string): Promise<string> {
    const data = await this.request(`/jury-duty/accept/${memberId}`, { method: 'POST' });
    return JSON.stringify(data, null, 2);
  }

  /**
   * Reject a jury duty assignment and return to the queue.
   *
   * @param memberId {string} Member ID from the jury assignment
   * @return {string} JSON confirmation of rejection
   */
  async rejectJuryDuty(memberId: string): Promise<string> {
    const data = await this.request(`/jury-duty/reject/${memberId}`, { method: 'POST' });
    return JSON.stringify(data, null, 2);
  }

  /**
   * @ignore
   */
  async fetch(request: Request): Promise<Response> {
    return new WorkerMCP(this).fetch(request);
  }
}
