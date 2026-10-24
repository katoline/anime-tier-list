import type { APIRoute } from 'astro';
import { ADSENSE_CLIENT } from '../lib/config';

export const prerender = true;

// AdSense のパブリッシャー ID（ca-pub-XXXX）から ads.txt を作る
export const GET: APIRoute = () => {
  const pub = ADSENSE_CLIENT.replace(/^ca-/, '');
  const body = pub ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n` : '';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
