import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, validateSession } from './lib/auth';
import { errorJson, isSameOrigin } from './lib/http';

/**
 * ページ側で `X-Edge-Cache: <秒>` を付けたレスポンスは、未ログインの GET に限ってエッジにキャッシュする。
 * ログイン中のユーザーには常に最新を返す（保存直後に古い内容が見えないように）。
 */
const EDGE_CACHE_HEADER = 'X-Edge-Cache';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

function edgeCache(): Cache | null {
  return typeof caches !== 'undefined' && 'default' in caches ? (caches as unknown as { default: Cache }).default : null;
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  ctx.locals.user = null;
  if (ctx.isPrerendered) return next();

  const { request, url } = ctx;
  const method = request.method;
  if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !isSameOrigin(request)) {
    return errorJson('不正なリクエストです', 403);
  }

  const hasSession = ctx.cookies.has(SESSION_COOKIE);
  const cache = method === 'GET' && !hasSession ? edgeCache() : null;
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }

  if (hasSession) ctx.locals.user = await validateSession(ctx.cookies, url);

  const response = await next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(k)) response.headers.set(k, v);
  }

  const ttl = Number(response.headers.get(EDGE_CACHE_HEADER) ?? 0);
  response.headers.delete(EDGE_CACHE_HEADER);
  if (cache && ttl > 0 && response.status === 200 && !response.headers.has('Set-Cookie')) {
    response.headers.set('Cache-Control', `public, max-age=0, s-maxage=${ttl}`);
    ctx.locals.cfContext.waitUntil(cache.put(request, response.clone()));
  }
  return response;
});
