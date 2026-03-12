import axios from 'axios';
import { notifyUnauthorized } from './auth.events';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (() => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    return base ? `${base}/api` : '/api';
  })();

export class ApiService {
  public client = axios.create({
    baseURL: API_BASE_URL,
    timeout: Number.isFinite(Number(import.meta.env.VITE_API_TIMEOUT_MS || 0)) ? Number(import.meta.env.VITE_API_TIMEOUT_MS) : 0,
    headers: { 'Content-Type': 'application/json' },
  });

  phoenixEndpoint = '/phoenix';

  constructor() {
    this.client.interceptors.request.use(
      (config) => {
        // console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error?.response?.status;
        if (status === 401) {
          try { notifyUnauthorized(); } catch {}
        }
        return Promise.reject(error);
      }
    );
  }

  submitQuery(userQuery: string, sessionData: Record<string, unknown> = {}) {
    return this.client.post(`${this.phoenixEndpoint}/query`, { userQuery, sessionData }).then(r => r.data);
  }

  submitDisambiguation(conversationId: string, responses: string[]) {
    return this.client.post(`${this.phoenixEndpoint}/disambiguate`, { conversationId, responses }).then(r => r.data);
  }

  getConversations(params: Record<string, unknown> = {}) {
    return this.client.get(`${this.phoenixEndpoint}/conversations`, { params }).then(r => r.data);
  }

  getConversation(conversationId: string) {
    return this.client.get(`${this.phoenixEndpoint}/conversations/${conversationId}`).then(r => r.data);
  }

  togglePin(conversationId: string, pinned: boolean) {
    return this.client.patch(`${this.phoenixEndpoint}/conversations/${conversationId}/pin`, { pinned }).then(r => r.data);
  }

  deleteConversation(conversationId: string) {
    return this.client.delete(`${this.phoenixEndpoint}/conversations/${conversationId}`).then(r => r.data);
  }

  healthCheck() {
    return this.client.get('/health').then(r => r.data);
  }

  createEventSource(url: string, options: EventSourceInit = {}) {
    const fullUrl = `${API_BASE_URL}${url}`;
    return new EventSource(fullUrl, options);
  }
}

const apiService = new ApiService();
export default apiService;

