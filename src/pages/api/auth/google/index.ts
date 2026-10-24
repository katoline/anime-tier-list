import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { randomToken, sha256Base64Url } from '../../../../lib/crypto';
import { safeNextPath } from '../../../../lib/http';

// Google ログイン開始（OAuth 2.0 認可コード + PKCE）
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  if (!env.GOOGLE_CLIENT_ID) return new Response('Google ログインは設定されていません', { status: 503 });
  const state = randomToken(16);
  const verifier = randomToken(32);
  const opts = { path: '/api/auth/google', httpOnly: true, sameSite: 'lax' as const, secure: url.protocol === 'https:', maxAge: 600 };
  cookies.set('g_state', state, opts);
  cookies.set('g_verifier', verifier, opts);
  cookies.set('g_next', safeNextPath(url.searchParams.get('next')), opts);

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: new URL('/api/auth/google/callback', url).href,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return redirect(auth.href, 302);
};
