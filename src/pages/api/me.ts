import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { HINT_COOKIE, clearSessionCookies, isValidUsername } from '../../lib/auth';
import { errorJson, json, readJson } from '../../lib/http';
import { deleteTierList, getTierList, listByUser } from '../../lib/tierlists-db';

// プロフィール（ユーザー名・表示名）の更新
export const POST: APIRoute = async ({ request, locals, cookies, url }) => {
  const user = locals.user;
  if (!user) return errorJson('ログインしてください', 401);
  const body = await readJson<{ username?: string; displayName?: string }>(request);
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  if (!isValidUsername(username)) return errorJson('ユーザー名は半角英小文字・数字・_ の 3〜20 文字で入力してください（使えない名前もあります）');
  if (!displayName || [...displayName].length > 30) return errorJson('表示名は 1〜30 文字で入力してください');
  if (username !== user.username) {
    const taken = await env.DB.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').bind(username, user.id).first();
    if (taken) return errorJson('そのユーザー名は使われています');
  }
  await env.DB.prepare('UPDATE users SET username = ?, display_name = ?, updated_at = ? WHERE id = ?')
    .bind(username, displayName, Date.now(), user.id)
    .run();
  cookies.set(HINT_COOKIE, username, { path: '/', sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 30 * 24 * 3600 });
  return json({ ok: true, username, displayName });
};

// 退会。公開ティア表の集計への寄与も取り除いてから削除する
export const DELETE: APIRoute = async ({ locals, cookies, url }) => {
  const user = locals.user;
  if (!user) return errorJson('ログインしてください', 401);
  for (const summary of await listByUser(user.id, { limit: 1000 })) {
    const list = await getTierList(summary.id);
    if (list) await deleteTierList(list);
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  clearSessionCookies(cookies, url);
  return json({ ok: true });
};
