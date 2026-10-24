import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createSession, findOrCreateUserByEmail } from '../../../../lib/auth';
import { sha256Hex } from '../../../../lib/crypto';
import { allow, clientIp, errorJson, json, readJson, safeNextPath } from '../../../../lib/http';

// ログインリンクのトークンを確認してログインさせる。
// メールのリンク先はボタンを押す確認ページにしてあり、メールソフトの先読みでトークンが消費されないようにしている。
export const POST: APIRoute = async ({ request, url, cookies }) => {
  if (!(await allow(env.AUTH_LIMITER, `verify:${clientIp(request)}`))) return errorJson('しばらく時間をおいてからお試しください', 429);
  const body = await readJson<{ token?: string }>(request);
  if (typeof body?.token !== 'string' || body.token.length > 100) return errorJson('リンクが正しくありません');
  const id = await sha256Hex(body.token);
  // 1 回限り: 取得と同時に削除する
  const row = await env.DB.prepare('DELETE FROM email_tokens WHERE id = ? RETURNING email, next_path, expires_at')
    .bind(id)
    .first<{ email: string; next_path: string | null; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return errorJson('リンクの有効期限が切れています。もう一度ログインしてください', 400);
  const user = await findOrCreateUserByEmail(row.email);
  await createSession(cookies, url, user);
  return json({ ok: true, next: safeNextPath(row.next_path) });
};
