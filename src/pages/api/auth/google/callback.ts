import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createSession, findOrCreateUserByGoogle } from '../../../../lib/auth';
import { safeNextPath } from '../../../../lib/http';

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const fail = (reason: string) => redirect(`/login?error=${encodeURIComponent(reason)}`, 302);
  const state = cookies.get('g_state')?.value;
  const verifier = cookies.get('g_verifier')?.value;
  const next = safeNextPath(cookies.get('g_next')?.value);
  for (const name of ['g_state', 'g_verifier', 'g_next']) cookies.delete(name, { path: '/api/auth/google' });

  if (url.searchParams.get('error')) return fail('Google ログインがキャンセルされました');
  const code = url.searchParams.get('code');
  if (!code || !state || !verifier || url.searchParams.get('state') !== state) return fail('ログインをやり直してください');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail('Google ログインは設定されていません');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: new URL('/api/auth/google/callback', url).href,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return fail('Google との通信に失敗しました');
  const token = (await res.json()) as { id_token?: string };
  if (!token.id_token) return fail('Google との通信に失敗しました');
  // ID トークンは Google のトークンエンドポイントから TLS で直接受け取ったものなので、署名検証は省略できる（OpenID Connect Core 3.1.3.7）
  const claims = decodeJwtPayload(token.id_token);
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !['https://accounts.google.com', 'accounts.google.com'].includes(String(claims.iss))) {
    return fail('ログインをやり直してください');
  }
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  if (!email || typeof claims.sub !== 'string') return fail('メールアドレスを取得できませんでした');

  let user;
  try {
    user = await findOrCreateUserByGoogle({
      sub: claims.sub,
      email,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === 'string' ? claims.name : null,
      picture: typeof claims.picture === 'string' ? claims.picture : null,
    });
  } catch {
    return fail('このメールアドレスは別の方法で登録済みです。メールでログインしてください');
  }
  await createSession(cookies, url, user);
  return redirect(next, 302);
};
