import crypto from 'node:crypto';

const TENANT_ID     = process.env.AZURE_TENANT_ID     ?? '';
const CLIENT_ID     = process.env.AZURE_CLIENT_ID     ?? '';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET ?? '';

export const PBI_WORKSPACE_ID = process.env.POWERBI_WORKSPACE_ID ?? '';
export const PBI_DATASET_IDS  = (process.env.POWERBI_DATASET_IDS ?? process.env.POWERBI_DATASET_ID ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

const SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'https://analysis.windows.net/powerbi/api/Dataset.ReadWrite.All',
].join(' ');

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

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

// ─── Token exchange ───────────────────────────────────────────────────────────

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

// ─── Power BI API (user-delegated token) ──────────────────────────────────────

export async function checkDatasetsAccess(
  accessToken: string,
): Promise<{ ok: boolean; datasets: { id: string; name: string }[] }> {
  if (!PBI_WORKSPACE_ID || PBI_DATASET_IDS.length === 0) return { ok: false, datasets: [] };
  const results = await Promise.all(
    PBI_DATASET_IDS.map(async (id) => {
      try {
        const r = await fetch(
          `https://api.powerbi.com/v1.0/myorg/groups/${PBI_WORKSPACE_ID}/datasets/${id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (r.ok) {
          const d = await r.json();
          return { id, name: d.name as string };
        }
      } catch { /* skip */ }
      return null;
    }),
  );
  const datasets = results.filter((d): d is { id: string; name: string } => d !== null);
  return { ok: datasets.length > 0, datasets };
}

// ─── Power BI API (service principal token) ───────────────────────────────────

export async function getServiceToken(): Promise<string> {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'client_credentials',
      scope:         'https://analysis.windows.net/powerbi/api/.default',
    }),
  });
  if (!r.ok) throw new Error('Falha ao obter token de service principal');
  const data = await r.json();
  return data.access_token as string;
}

export interface DatasetStatus {
  id: string;
  name: string;
  lastRefresh: { status: string; startTime: string; endTime: string } | null;
}

export async function getDatasetStatuses(): Promise<DatasetStatus[]> {
  const token   = await getServiceToken();
  const headers = { Authorization: `Bearer ${token}` };
  const base    = `https://api.powerbi.com/v1.0/myorg/groups/${PBI_WORKSPACE_ID}/datasets`;

  return Promise.all(
    PBI_DATASET_IDS.map(async (id) => {
      const [dsRes, refRes] = await Promise.all([
        fetch(`${base}/${id}`,                  { headers }),
        fetch(`${base}/${id}/refreshes?$top=1`, { headers }),
      ]);
      const name = dsRes.ok ? ((await dsRes.json()).name as string) : `Dataset ${id.slice(0, 8)}`;
      let lastRefresh: DatasetStatus['lastRefresh'] = null;
      if (refRes.ok) {
        const data = await refRes.json();
        if (data.value?.length > 0) {
          const v = data.value[0];
          lastRefresh = { status: v.status, startTime: v.startTime, endTime: v.endTime };
        }
      }
      return { id, name, lastRefresh };
    }),
  );
}
