import axios from 'axios';
import { API_BASE_URL } from './api.service';

export type LoginBody = {
  email: string;
  password: string;
  captchaSessionId: string;
  captchaInput: string;
};

export class AuthService {
  private client = axios.create({ baseURL: API_BASE_URL, withCredentials: true });

  async generateCaptcha() {
    const { data } = await this.client.get(`/auth/captcha/generate`);
    return data as { sessionId: string; svg: string; expiresIn: number };
  }

  async refreshCaptcha(sessionId: string) {
    const { data } = await this.client.post(`/auth/captcha/refresh`, { sessionId });
    return data as { sessionId: string; svg: string; expiresIn: number };
  }

  async login(body: LoginBody) {
    const { data } = await this.client.post(`/auth/login`, body);
    return data as { user: any; expiresIn: number; sessionTimeout: number };
  }

  async check() {
    try {
      const { data } = await this.client.get('/auth/check-auth');
      return { 
        authenticated: !!data?.user, 
        user: data?.user, 
        expiresIn: data?.expiresIn 
      };
    } catch {
      return { authenticated: false };
    }
  }

  async logout() {
    const { data } = await this.client.post('/auth/logout');
    return data;
  }
}

export const authService = new AuthService();

