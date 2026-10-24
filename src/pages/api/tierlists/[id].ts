import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { allow, errorJson, json, readJson } from '../../../lib/http';
import { ValidationError } from '../../../lib/tierlist';
import { parseTierListInput } from '../../../lib/tierlist-input';
import { ConflictError, deleteTierList, getTierList, updateTierList } from '../../../lib/tierlists-db';

// 取得: 本人なら全項目、公開・限定公開なら他の人も中身を取得できる（「これをもとに作る」用）
export const GET: APIRoute = async ({ params, locals }) => {
  const list = await getTierList(params.id ?? '');
  const isOwner = Boolean(locals.user && list && list.userId === locals.user.id);
  if (!list || (list.visibility === 'private' && !isOwner)) return errorJson('見つかりません', 404);
  return json({
    id: list.id,
    seasonId: list.seasonId,
    title: list.title,
    description: list.description,
    visibility: list.visibility,
    data: list.data,
    version: list.version,
    updatedAt: list.updatedAt,
    username: list.username,
    isOwner,
  });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return errorJson('ログインしてください', 401);
  if (!(await allow(env.WRITE_LIMITER, `write:${user.id}`))) return errorJson('保存の回数が多すぎます。少し待ってからお試しください', 429);
  const list = await getTierList(params.id ?? '');
  if (!list || list.userId !== user.id) return errorJson('見つかりません', 404);
  let input;
  try {
    input = parseTierListInput(await readJson(request));
  } catch (e) {
    if (e instanceof ValidationError) return errorJson(e.message);
    throw e;
  }
  if (input.seasonId !== list.seasonId) return errorJson('季節は変更できません');
  try {
    const updated = await updateTierList(list, input, input.version);
    return json({ id: updated.id, version: updated.version, visibility: updated.visibility, username: user.username });
  } catch (e) {
    if (e instanceof ConflictError) return errorJson('別の画面で更新されています。ページを再読み込みしてください', 409);
    throw e;
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return errorJson('ログインしてください', 401);
  const list = await getTierList(params.id ?? '');
  if (!list || list.userId !== user.id) return errorJson('見つかりません', 404);
  await deleteTierList(list);
  return json({ ok: true });
};
