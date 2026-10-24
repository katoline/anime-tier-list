import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { IMAGE_MODE } from '../../lib/config';

const KEY_RE = /^anime\/al-\d+-[0-9a-f]{10}-(160|480)\.(webp|jpg)$/;

// R2 に置いた作品サムネイルを配信する。ファイル名に内容のハッシュを含むので 1 年キャッシュ。
export const GET: APIRoute = async ({ params, request, locals }) => {
  const key = params.key ?? '';
  if (IMAGE_MODE !== 'image' || !KEY_RE.test(key)) return new Response('Not found', { status: 404 });

  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const object = await env.IMAGES_BUCKET.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  const response = new Response(object.body, { headers });
  locals.cfContext.waitUntil(cache.put(request, response.clone()));
  return response;
};
