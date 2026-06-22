import { NextRequest } from 'next/server';
import { doRefresh } from '@/lib/pbi';

export async function POST(request: NextRequest) {
  try {
    const { refreshToken } = await request.json();
    if (!refreshToken) return Response.json({ error: 'refreshToken ausente' }, { status: 400 });

    const tokens = await doRefresh(refreshToken);
    return Response.json({
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt:    Date.now() + (tokens.expires_in - 60) * 1000,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 401 });
  }
}
