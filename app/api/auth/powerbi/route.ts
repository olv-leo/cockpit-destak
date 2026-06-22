import { NextRequest, NextResponse } from 'next/server';
import { mkVerifier, mkChallenge, mkAuthUrl } from '@/lib/pbi';

// GET  → redirect user to Microsoft OAuth
// DELETE → called on logout (clears cookies if any)

export async function GET(request: NextRequest) {
  const verifier  = mkVerifier();
  const challenge = mkChallenge(verifier);
  const state     = crypto.randomUUID();
  const origin    = request.nextUrl.origin;

  const res = NextResponse.redirect(
    mkAuthUrl(`${origin}/api/auth/powerbi/callback`, challenge, state),
  );

  // Store verifier + state in short-lived httpOnly cookie for the callback to pick up
  res.cookies.set('_pbi_cv', `${state}:${verifier}`, {
    httpOnly: true,
    maxAge: 300,
    path: '/',
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
  });

  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('_pbi_cv');
  return res;
}
