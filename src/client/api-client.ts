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

  constructor(baseURL: string = process.env.TRIBEUNAL_API_BASE_URL || 'https://tribeunal.test/api') {
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

  // Vote endpoints
  async castVote(trialId: string, sideId: string) {
    const response = await this.client.post(`/cases/${trialId}/vote`, { side_id: sideId });
    return response.data;
  }

  async revokeVote(trialId: string, voteId: string) {
    const response = await this.client.delete(`/cases/${trialId}/vote/${voteId}`);
    return response.data;
  }

  async getVoteStats(trialId: string) {
    const response = await this.client.get(`/cases/${trialId}/votes`);
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