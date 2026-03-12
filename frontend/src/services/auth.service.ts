const SESSION_KEY = 'skylarkai.mock.session';

export interface User {
  email: string;
  displayName: string;
}

export interface LoginBody {
  email: string;
  password: string;
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
};