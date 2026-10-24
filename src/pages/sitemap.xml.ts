import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAllAnime, getSeasons, seasonPath } from '../lib/data';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export const GET: APIRoute = async ({ site, request, locals }) => {
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const urls: { loc: string; lastmod?: string }[] = [{ loc: '/' }, { loc: '/seasons' }, { loc: '/lists' }, { loc: '/about' }];
  for (const s of getSeasons()) urls.push({ loc: seasonPath(s), lastmod: s.updatedAt.slice(0, 10) });
  // 作品ページは評価がある程度集まったものだけ（ページ側の noindex 条件と合わせる）
  const { results: voted } = await env.DB.prepare('SELECT anime_id FROM anime_stats GROUP BY anime_id HAVING SUM(count) >= 5').all<{ anime_id: string }>();
  const votedIds = new Set(voted.map((r) => r.anime_id));
  for (const a of getAllAnime()) if (votedIds.has(a.id)) urls.push({ loc: `/anime/${a.slug}` });
  const { results: lists } = await env.DB.prepare(
    "SELECT id, updated_at FROM tier_lists WHERE visibility = 'public' AND ranked_count >= 5 ORDER BY updated_at DESC LIMIT 5000",
  ).all<{ id: string; updated_at: number }>();
  for (const l of lists) urls.push({ loc: `/t/${l.id}`, lastmod: new Date(l.updated_at).toISOString().slice(0, 10) });

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(new URL(u.loc, site).href)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
  const response = new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } });
  locals.cfContext.waitUntil(cache.put(request, response.clone()));
  return response;
};
