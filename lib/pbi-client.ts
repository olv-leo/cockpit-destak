'use client';

export interface PBISession {
  at: string;
  rt: string;
  exp: number;
  name: string;
  email: string;
  hasPermission: boolean;
  datasetName: string | null;
}

const KEY = 'destak_pbi_session';

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? m[1] : null;
}

export function loadPBISession(): PBISession | null {
  if (typeof window === 'undefined') return null;

  // Migrate from OAuth callback cookie to localStorage
  const pending = readCookie('_pbi_pending');
  if (pending) {
    try {
      const s = JSON.parse(decodeURIComponent(pending)) as PBISession;
      localStorage.setItem(KEY, JSON.stringify(s));
      document.cookie = '_pbi_pending=; path=/; max-age=0';
      return s;
    } catch { /* ignore malformed */ }
  }

  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as PBISession; } catch { return null; }
}

export function savePBISession(s: PBISession): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearPBISession(): void {
  localStorage.removeItem(KEY);
}

export function isSessionValid(s: PBISession | null): boolean {
  return !!s && Date.now() < s.exp;
}

export async function getFreshToken(s: PBISession): Promise<PBISession | null> {
  if (isSessionValid(s)) return s;
  try {
    const res = await fetch('/api/auth/powerbi/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: s.rt }),
    });
    if (!res.ok) { clearPBISession(); return null; }
    const { accessToken, refreshToken, expiresAt } = await res.json();
    const updated: PBISession = { ...s, at: accessToken, rt: refreshToken, exp: expiresAt };
    savePBISession(updated);
    return updated;
  } catch {
    return null;
  }
}
