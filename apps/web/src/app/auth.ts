/**
 * Glane JWT auth — localStorage token shared with sync / publish.
 */
const JWT_KEY = "glane.jwt";
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export type AuthMe = {
  authenticated: boolean;
  username?: string;
  roles?: string[];
};

function apiBase(): string {
  return API_BASE.replace(/\/+$/, "");
}

function getJwt(): string | null {
  return localStorage.getItem(JWT_KEY);
}

function setJwt(token: string | null): void {
  if (token) localStorage.setItem(JWT_KEY, token);
  else localStorage.removeItem(JWT_KEY);
}

function authHeaders(): HeadersInit {
  const token = getJwt();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function isApiConfigured(): boolean {
  return Boolean(apiBase());
}

async function login(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!apiBase()) return { ok: false, error: "api_not_configured" };
  try {
    const res = await fetch(`${apiBase()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return { ok: false, error: "login_failed" };
    const data = (await res.json()) as { token?: string };
    if (!data.token) return { ok: false, error: "login_failed" };
    setJwt(data.token);
    return { ok: true };
  } catch {
    return { ok: false, error: "login_failed" };
  }
}

async function register(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!apiBase()) return { ok: false, error: "api_not_configured" };
  try {
    const res = await fetch(`${apiBase()}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? "register_failed" };
    }
    const data = (await res.json()) as { token?: string };
    if (data.token) {
      setJwt(data.token);
      return { ok: true };
    }
    return login(username, password);
  } catch {
    return { ok: false, error: "register_failed" };
  }
}

function logout(): void {
  setJwt(null);
}

async function me(): Promise<AuthMe> {
  if (!apiBase() || !getJwt()) return { authenticated: false };
  try {
    const res = await fetch(`${apiBase()}/api/me`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401) setJwt(null);
      return { authenticated: false };
    }
    return (await res.json()) as AuthMe;
  } catch {
    return { authenticated: false };
  }
}

export const auth = {
  getJwt,
  setJwt,
  authHeaders,
  isApiConfigured,
  apiBase,
  login,
  register,
  logout,
  me,
} as const;
