import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, parseIdToken, checkDatasetsAccess } from '@/lib/pbi';

export async function GET(request: NextRequest) {
  const { searchParams, origin, protocol } = request.nextUrl;
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const fail = (msg: string) =>
    NextResponse.redirect(`${origin}/?pbi_error=${encodeURIComponent(msg)}`);

  if (error) return fail(searchParams.get('error_description') || error);
  if (!code || !state) return fail('Parâmetros ausentes na resposta do Microsoft');

  const cv = request.cookies.get('_pbi_cv')?.value ?? '';
  if (!cv) return fail('Sessão expirada — tente novamente');

  const colonIdx   = cv.indexOf(':');
  const savedState = cv.slice(0, colonIdx);
  const verifier   = cv.slice(colonIdx + 1);
  if (savedState !== state) return fail('Validação de estado falhou — tente novamente');

  try {
    const redirectUri = `${origin}/api/auth/powerbi/callback`;
    console.log('[PBI callback] exchanging code, redirectUri=', redirectUri);
    const tokens = await exchangeCode(code, redirectUri, verifier);
    console.log('[PBI callback] token exchange OK, id_token present=', !!tokens.id_token);

    const { name, email }                 = parseIdToken(tokens.id_token ?? '');
    const { ok: hasPermission, datasets } = await checkDatasetsAccess(tokens.access_token);
    console.log('[PBI callback] user:', name, '| datasets:', datasets.length, '| permission:', hasPermission);

    const session = JSON.stringify({
      name,
      email,
      hasPermission,
      datasets,
      loggedAt: Date.now(),
    });

    const encoded = Buffer.from(session).toString('base64url');
    console.log('[PBI callback] redirecting with pbi_data param, size=', encoded.length);

    const res = NextResponse.redirect(`${origin}/?pbi_data=${encoded}`);
    res.cookies.delete('_pbi_cv');
    return res;
  } catch (e) {
    console.error('[PBI callback] error:', e);
    return fail(e instanceof Error ? e.message : 'Erro desconhecido');
  }
}
