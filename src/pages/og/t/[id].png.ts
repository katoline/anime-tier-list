import type { APIRoute } from 'astro';
import { getAnime, getSeason } from '../../../lib/data';
import { cachedPng, renderTierListOg } from '../../../lib/og';
import { parseSeasonId, seasonLabel } from '../../../lib/season';
import { getTierList } from '../../../lib/tierlists-db';

// ティア表の OGP 画像。URL の ?v= に版を付けるので、更新すると SNS 側も新しい画像を取りに来る
export const GET: APIRoute = async ({ params, request, locals }) => {
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const list = await getTierList(params.id ?? '');
  if (!list || list.visibility === 'private') return new Response('Not found', { status: 404 });
  const ref = parseSeasonId(list.seasonId);
  const season = getSeason(list.seasonId);
  if (!ref || !season) return new Response('Not found', { status: 404 });

  const response = await cachedPng(
    `og/t/${list.id}-${list.version}.png`,
    () =>
      renderTierListOg({
        title: list.title,
        subtitle: `${seasonLabel(ref)} ・ ${list.displayName}`,
        data: list.data,
        anime: getAnime,
      }),
    locals.cfContext,
  );
  locals.cfContext.waitUntil(cache.put(request, response.clone()));
  return response;
};
