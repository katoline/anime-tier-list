import type { APIRoute } from 'astro';
import { cachedPng, renderSiteOg } from '../../lib/og';

export const GET: APIRoute = async ({ request, locals }) => {
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await cachedPng('og/site-v1.png', () => renderSiteOg('今期アニメをドラッグ&ドロップでランク付け'), locals.cfContext);
  locals.cfContext.waitUntil(cache.put(request, response.clone()));
  return response;
};
