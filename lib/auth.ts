const AUTH_KEY = 'destak_cockpit_auth';
const EXPIRY_DAYS = 90;

interface AuthData {
  code: string;
  expiresAt: string;
}

export function saveAuth(code: string): void {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + EXPIRY_DAYS);
  const data: AuthData = { code, expiresAt: expiresAt.toISOString() };
  localStorage.setItem(AUTH_KEY, JSON.stringify(data));
}

export function getAuth(): AuthData | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const data: AuthData = JSON.parse(raw);
    if (new Date() > new Date(data.expiresAt)) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEY);
}

export function isAuthenticated(): boolean {
  return getAuth() !== null;
}

export function getExpiryInfo(): { daysLeft: number; expiresAt: Date } | null {
  const auth = getAuth();
  if (!auth) return null;
  const expiresAt = new Date(auth.expiresAt);
  const msLeft = expiresAt.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  return { daysLeft, expiresAt };
}
