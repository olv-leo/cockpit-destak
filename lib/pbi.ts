import crypto from 'node:crypto';

const TENANT_ID     = process.env.AZURE_TENANT_ID     ?? '';
const CLIENT_ID     = process.env.AZURE_CLIENT_ID     ?? '';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? '';

export const PBI_WORKSPACE_ID = process.env.POWERBI_WORKSPACE_ID ?? '';
export const PBI_DATASET_ID   = process.env.POWERBI_DATASET_ID   ?? '';

const SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'https://analysis.windows.net/powerbi/api/Dataset.ReadWrite.All',
].join(' ');

export function mkVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function mkChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest().toString('base64url');
}

export function mkAuthUrl(redirectUri: string, challenge: string, state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    response_mode: 'query',
  });
  return `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${p}`;
}

type RawTokens = { access_token: string; refresh_token: string; expires_in: number; id_token?: string };

export async function exchangeCode(code: string, redirectUri: string, verifier: string): Promise<RawTokens> {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      code_verifier: verifier,
      scope:         SCOPES,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function doRefresh(rt: string): Promise<RawTokens> {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: rt,
      scope:         SCOPES,
    }),
  });
  if (!r.ok) throw new Error('Falha ao renovar token do Power BI');
  return r.json();
}

export function parseIdToken(idToken: string): { name: string; email: string } {
  try {
    const p = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
    return { name: p.name || p.preferred_username || 'Usuário', email: p.preferred_username || p.email || '' };
  } catch {
    return { name: 'Usuário', email: '' };
  }
}

export async function checkDatasetAccess(accessToken: string): Promise<{ ok: boolean; datasetName?: string }> {
  if (!PBI_WORKSPACE_ID || !PBI_DATASET_ID) return { ok: false };
  try {
    const r = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${PBI_WORKSPACE_ID}/datasets/${PBI_DATASET_ID}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (r.ok) {
      const d = await r.json();
      return { ok: true, datasetName: d.name };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
