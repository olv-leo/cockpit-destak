'use client';

export interface PBISession {
  name: string;
  email: string;
  hasPermission: boolean;
  datasetName: string | null;
  loggedAt: number;
}

const KEY = 'destak_pbi_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours, matches cookie maxAge

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]*)|(?:^|; )${name}=([^;]*)`));
  return m ? (m[1] ?? m[2] ?? null) : null;
}

export function loadPBISession(): PBISession | null {
  if (typeof window === 'undefined') return null;

  // Check for fresh session cookie set by OAuth callback
  const cookieVal = readCookie('_pbi_session');
  if (cookieVal) {
    try {
      const s = JSON.parse(decodeURIComponent(cookieVal)) as PBISession;
      localStorage.setItem(KEY, JSON.stringify(s));
      // Clear the relay cookie — data is now in localStorage
      document.cookie = '_pbi_session=; path=/; max-age=0';
      return s;
    } catch { /* ignore malformed */ }
  }

  // Fall back to localStorage (persists across refreshes within TTL)
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PBISession;
  } catch {
    return null;
  }
}

export function clearPBISession(): void {
  localStorage.removeItem(KEY);
  document.cookie = '_pbi_session=; path=/; max-age=0';
}

export function isSessionValid(s: PBISession | null): boolean {
  if (!s) return false;
  return Date.now() - s.loggedAt < SESSION_TTL_MS;
}
