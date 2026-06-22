'use client';

export interface PBISession {
  name: string;
  email: string;
  hasPermission: boolean;
  datasets: { id: string; name: string }[];
  loggedAt: number;
}

export interface DatasetStatus {
  id: string;
  name: string;
  lastRefresh: { status: string; startTime: string; endTime: string } | null;
}

const KEY = 'destak_pbi_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export function loadPBISession(): PBISession | null {
  if (typeof window === 'undefined') return null;

  // Check for session passed as ?pbi_data=<base64url> from OAuth callback
  const params = new URLSearchParams(window.location.search);
  const pbiData = params.get('pbi_data');
  if (pbiData) {
    try {
      const binary = atob(pbiData.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes  = Uint8Array.from(binary, c => c.charCodeAt(0));
      const json   = new TextDecoder().decode(bytes);
      const s = JSON.parse(json) as PBISession;
      localStorage.setItem(KEY, JSON.stringify(s));
      // Remove the param from URL without reloading
      params.delete('pbi_data');
      const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
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
}

export function isSessionValid(s: PBISession | null): boolean {
  if (!s) return false;
  return Date.now() - s.loggedAt < SESSION_TTL_MS;
}
