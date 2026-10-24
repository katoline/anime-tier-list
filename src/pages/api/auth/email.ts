import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { normalizeEmail } from '../../../lib/auth';
import { randomToken, sha256Hex } from '../../../lib/crypto';
import { sendLoginEmail } from '../../../lib/email';
import { allow, clientIp, errorJson, json, readJson, safeNextPath } from '../../../lib/http';
import { verifyTurnstile } from '../../../lib/turnstile';

const TOKEN_TTL = 15 * 60 * 1000;

// メールアドレス宛にログインリンクを送る
export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson<{ email?: string; next?: string; turnstileToken?: string }>(request);
  const email = normalizeEmail(body?.email);
  if (!email) return errorJson('メールアドレスの形式が正しくありません');
  const ip = clientIp(request);
  if (!(await allow(env.AUTH_LIMITER, `email:${ip}`)) || !(await allow(env.AUTH_LIMITER, `email:${email}`))) {
    return errorJson('しばらく時間をおいてからお試しください', 429);
  }
  if (!(await verifyTurnstile(body?.turnstileToken, ip))) return errorJson('ボット判定に失敗しました。ページを再読み込みしてください', 400);

  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO email_tokens (id, email, next_path, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), email, safeNextPath(body?.next), now + TOKEN_TTL, now)
    .run();
  const link = new URL(`/auth/verify?token=${encodeURIComponent(token)}`, url).href;
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!env.RESEND_API_KEY && !isLocal) return errorJson('メールでのログインは現在利用できません', 503);
  const sent = await sendLoginEmail(email, link);
  if (!sent) return errorJson('メールを送信できませんでした。時間をおいてお試しください', 502);
  // ローカル開発専用: メールを送らずリンクを返す（localhost 以外では設定されていても無視する）
  const exposeLink = env.DEV_EXPOSE_LOGIN_LINK === '1' && isLocal;
  return json({ ok: true, ...(exposeLink ? { link } : {}) });
};
