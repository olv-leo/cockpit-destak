import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, parseIdToken, checkDatasetAccess } from '@/lib/pbi';

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
    const tokens = await exchangeCode(code, redirectUri, verifier);

    const { name, email }                 = parseIdToken(tokens.id_token ?? '');
    const { ok: hasPermission, datasetName } = await checkDatasetAccess(tokens.access_token);

    const payload = encodeURIComponent(JSON.stringify({
      at: tokens.access_token,
      rt: tokens.refresh_token,
      exp: Date.now() + (tokens.expires_in - 60) * 1000,
      name,
      email,
      hasPermission,
      datasetName: datasetName ?? null,
    }));

    const res = NextResponse.redirect(origin);
    res.cookies.delete('_pbi_cv');
    // Non-httpOnly so the browser JS can read and move to localStorage
    res.cookies.set('_pbi_pending', payload, {
      httpOnly: false,
      maxAge: 300,
      path: '/',
      sameSite: 'lax',
      secure: protocol === 'https:',
    });
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Erro desconhecido');
  }
}
