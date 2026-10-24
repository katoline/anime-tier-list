import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { allow, errorJson, json, readJson } from '../../../lib/http';
import { ValidationError } from '../../../lib/tierlist';
import { parseTierListInput } from '../../../lib/tierlist-input';
import { createTierList } from '../../../lib/tierlists-db';

const MAX_LISTS_PER_USER = 200;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return errorJson('ログインしてください', 401);
  if (!(await allow(env.WRITE_LIMITER, `write:${user.id}`))) return errorJson('保存の回数が多すぎます。少し待ってからお試しください', 429);
  let input;
  try {
    input = parseTierListInput(await readJson(request));
  } catch (e) {
    if (e instanceof ValidationError) return errorJson(e.message);
    throw e;
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM tier_lists WHERE user_id = ?').bind(user.id).first<number>('n');
  if ((count ?? 0) >= MAX_LISTS_PER_USER) return errorJson(`保存できるティア表は ${MAX_LISTS_PER_USER} 件までです`);
  const created = await createTierList({ ...input, userId: user.id });
  return json({ id: created.id, version: created.version, visibility: created.visibility, username: user.username }, 201);
};
