import axios, { AxiosInstance, AxiosError } from 'axios';
import https from 'https';
import { z } from 'zod';

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

export class TribeunalAPIClient {
  private client: AxiosInstance;
  private apiKey: string | undefined;
  private baseOrigin: string;

  constructor(baseURL: string = process.env.TRIBEUNAL_API_BASE_URL || 'https://tribeunal.test/api') {
    this.baseOrigin = new URL(baseURL).origin;
    this.apiKey = process.env.TRIBEUNAL_API_KEY;
    
    // Create HTTPS agent with optional certificate verification
    const httpsAgent = new https.Agent({
      rejectUnauthorized: process.env.TRIBEUNAL_VERIFY_SSL !== 'false'
    });
    
    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000,
      httpsAgent: httpsAgent,
    });

    // Add auth interceptor
    this.client.interceptors.request.use((config) => {
      if (this.apiKey) {
        config.headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      return config;
    });

    // Add error interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const errorData = error.response?.data as any;
        const message = errorData?.message || error.message;
        const statusCode = error.response?.status;
        throw new TribeunalAPIError(message, statusCode, error.response?.data);
      }
    );
  }

  // Trial endpoints
  async searchTrials(params: {
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

  async getTrial(id: string) {
    const response = await this.client.get(`/cases/${id}`);
    return response.data;
  }

  async createTrial(data: {
    title: string;
    description: string;
    type: 'case' | 'advice' | 'poll';
    juryType: 'public' | 'invited';
    sides: Array<{ name: string; description?: string }>;
    trialLength?: number;
    decisionRequirement?: string;
    tags?: string[];
  }) {
    const response = await this.client.post('/cases', data);
    return response.data;
  }

  // Vote endpoints (these routes have no /api/ prefix)
  async castVote(trialId: string, sideId: string) {
    const params = new URLSearchParams();
    params.append('side_id', sideId);
    const response = await this.client.post(`${this.baseOrigin}/cases/${trialId}/vote`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data;
  }

  async revokeVote(trialId: string, voteId: string) {
    const response = await this.client.delete(`${this.baseOrigin}/cases/${trialId}/vote/${voteId}`);
    return response.data;
  }

  async getVoteStats(trialId: string) {
    const response = await this.client.get(`${this.baseOrigin}/cases/${trialId}/votes`);
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
  async getTrialEvidence(trialId: string) {
    const response = await this.client.get(`/cases/${trialId}/evidence`);
    return response.data;
  }

  async submitEvidence(trialId: string, data: {
    content: string;
    type: 'text' | 'link' | 'image';
    sideId?: string;
  }) {
    const response = await this.client.post(`/cases/${trialId}/evidence`, data);
    return response.data;
  }

  async rateEvidence(evidenceId: string, rating: number) {
    const response = await this.client.post(`/evidence/${evidenceId}/rate`, { rating });
    return response.data;
  }
}

// Export singleton instance
export const apiClient = new TribeunalAPIClient();