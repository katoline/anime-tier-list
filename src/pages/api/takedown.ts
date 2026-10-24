import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { normalizeEmail } from '../../lib/auth';
import { shortId } from '../../lib/crypto';
import { allow, clientIp, errorJson, json, readJson } from '../../lib/http';
import { verifyTurnstile } from '../../lib/turnstile';

// 権利者等からの掲載・削除依頼を受け付ける
export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  if (!(await allow(env.AUTH_LIMITER, `takedown:${ip}`))) return errorJson('しばらく時間をおいてからお試しください', 429);
  const b = await readJson<Record<string, unknown>>(request);
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = text(b?.name, 100);
  const email = normalizeEmail(b?.email);
  const reason = text(b?.reason, 3000);
  if (!name || !email || !reason) return errorJson('お名前・メールアドレス・内容を入力してください');
  if (!(await verifyTurnstile(b?.turnstileToken, ip))) return errorJson('ボット判定に失敗しました。ページを再読み込みしてください');
  await env.DB.prepare('INSERT INTO takedown_requests (id, anime_id, name, email, url, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(shortId(12), text(b?.animeId, 40) || null, name, email, text(b?.url, 500) || null, reason, Date.now())
    .run();
  return json({ ok: true });
};
