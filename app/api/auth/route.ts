import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { code } = body as { code?: string };

  if (!code) {
    return Response.json({ error: 'Código obrigatório' }, { status: 400 });
  }

  const validCode = process.env.ACCESS_CODE;
  if (!validCode) {
    return Response.json({ error: 'Servidor não configurado' }, { status: 500 });
  }

  if (code.trim() !== validCode.trim()) {
    return Response.json({ error: 'Código inválido' }, { status: 401 });
  }

  return Response.json({ ok: true });
}
