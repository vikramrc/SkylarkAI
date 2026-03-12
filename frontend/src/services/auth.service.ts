const SESSION_KEY = 'skylarkai.mock.session';

export interface User {
  email: string;
  displayName: string;
}

export interface LoginBody {
  email: string;
  password: string;
  captchaSessionId: string;
  captchaInput: string;
}

interface SessionPayload {
  user: User;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readSession(): SessionPayload | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SessionPayload;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export const authService = {
  async check() {
    await delay(420);
    const session = readSession();
    return {
      authenticated: Boolean(session),
      user: session?.user,
    };
  },

  async login(body: LoginBody) {
    await delay(650);

    if (!/.+@.+\..+/.test(body.email) || body.password.trim().length < 6) {
      throw new Error('Use a valid email and a password of at least 6 characters.');
    }

    const user = {
      email: body.email.trim().toLowerCase(),
      displayName: body.email.split('@')[0],
    } satisfies User;

    localStorage.setItem(SESSION_KEY, JSON.stringify({ user }));
    return { user };
  },

  async logout() {
    await delay(250);
    localStorage.removeItem(SESSION_KEY);
  },

  async generateCaptcha() {
    await delay(300);
    return {
      sessionId: `mock-session-${Date.now()}`,
      svg: '<svg width="200" height="40" viewBox="0 0 200 40" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" font-family="monospace" font-size="20" text-anchor="middle" dominant-baseline="middle" fill="#333">MOCK-731</text></svg>',
      expiresIn: 300,
    };
  },

  async refreshCaptcha(sessionId: string) {
    await delay(300);
    return {
      sessionId: `mock-session-${Date.now()}`,
      svg: '<svg width="200" height="40" viewBox="0 0 200 40" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" font-family="monospace" font-size="20" text-anchor="middle" dominant-baseline="middle" fill="#333">REFRESH-731</text></svg>',
      expiresIn: 300,
    };
  },
};