import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) =>
  new Response(
    ['User-agent: *', 'Disallow: /api/', 'Disallow: /me', 'Disallow: /settings', 'Disallow: /auth/', '', `Sitemap: ${new URL('/sitemap.xml', site)}`, ''].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
