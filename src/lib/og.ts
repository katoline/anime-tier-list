// OGP 画像（1200×630）の生成。生成結果は R2 に保存し、同じ版のティア表では二度と生成しない。

import { env } from 'cloudflare:workers';
import { ImageResponse, loadGoogleFont } from 'workers-og';
import { cardColors } from './colors';
import { IMAGE_MODE, SITE_NAME } from './config';
import type { Anime } from './anime-types';
import { TIER_MEANINGS, type TierListData } from './tierlist';

const W = 1200;
const H = 630;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function truncate(s: string, n: number): string {
  const chars = [...s];
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : s;
}

async function thumbDataUri(anime: Anime): Promise<string | null> {
  if (IMAGE_MODE !== 'image' || !anime.image) return null;
  const obj = await env.IMAGES_BUCKET.get(`${anime.image.key}-160.jpg`);
  if (!obj) return null;
  const bytes = new Uint8Array(await obj.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

async function fonts(text: string) {
  // 使う文字だけのサブセットを取得する（日本語フォント全体は大きすぎるため）
  const unique = [...new Set([...text])].join('');
  const bold = await loadGoogleFont({ family: 'Noto Sans JP', weight: 700, text: unique });
  return [{ name: 'Noto Sans JP', data: bold, weight: 700 as const, style: 'normal' as const }];
}

async function render(html: string, text: string): Promise<ArrayBuffer> {
  const res = new ImageResponse(html, { width: W, height: H, format: 'png', fonts: await fonts(text) });
  return res.arrayBuffer();
}

export async function renderTierListOg(opts: {
  title: string;
  subtitle: string;
  data: TierListData;
  anime: (id: string) => Anime | undefined;
}): Promise<ArrayBuffer> {
  const tiers = opts.data.tiers.filter((t) => t.items.length > 0).slice(0, 7);
  const shown = tiers.length ? tiers : opts.data.tiers.slice(0, 7);
  const headerH = 112;
  const footerH = 44;
  const rowH = Math.floor((H - headerH - footerH - 16) / Math.max(shown.length, 3));
  const cardH = rowH - 8;
  const cardW = Math.round((cardH * 2) / 3);
  const perRow = Math.floor((W - 48 - 140) / (cardW + 6));
  let text = opts.title + opts.subtitle + SITE_NAME + '…';

  const rows: string[] = [];
  for (const tier of shown) {
    const cards: string[] = [];
    for (const id of tier.items.slice(0, perRow)) {
      const a = opts.anime(id);
      if (!a) continue;
      const uri = await thumbDataUri(a);
      if (uri) {
        cards.push(`<img src="${uri}" width="${cardW}" height="${cardH}" style="width:${cardW}px;height:${cardH}px;object-fit:cover;border-radius:4px;margin-right:6px" />`);
      } else {
        const { bg, fg } = cardColors(a);
        const title = truncate(a.title, 12);
        text += title;
        cards.push(
          `<div style="display:flex;align-items:center;justify-content:center;width:${cardW}px;height:${cardH}px;background:${bg};color:${fg};border-radius:4px;margin-right:6px;padding:4px;font-size:${cardW > 56 ? 13 : 11}px;text-align:center;line-height:1.2;overflow:hidden">${esc(title)}</div>`,
        );
      }
    }
    if (tier.items.length > perRow) {
      const more = `+${tier.items.length - perRow}`;
      text += more;
      cards.push(`<div style="display:flex;align-items:center;color:#a3a3b8;font-size:20px">${more}</div>`);
    }
    const label = truncate(tier.label || ' ', 6);
    text += label;
    rows.push(
      `<div style="display:flex;height:${rowH}px;margin-bottom:4px">
        <div style="display:flex;align-items:center;justify-content:center;width:132px;background:${tier.color};color:#1a1a22;font-size:${[...label].length > 2 ? 22 : 40}px;margin-right:4px">${esc(label)}</div>
        <div style="display:flex;flex:1;align-items:center;background:#23232d;padding:4px 6px;overflow:hidden">${cards.join('')}</div>
      </div>`,
    );
  }

  const html = `<div style="display:flex;flex-direction:column;width:${W}px;height:${H}px;background:#16161d;padding:24px;font-family:'Noto Sans JP'">
    <div style="display:flex;flex-direction:column;height:${headerH - 24}px">
      <div style="display:flex;color:#fff;font-size:34px;line-height:1.2">${esc(truncate(opts.title, 34))}</div>
      <div style="display:flex;color:#a3a3b8;font-size:20px;margin-top:4px">${esc(opts.subtitle)}</div>
    </div>
    <div style="display:flex;flex-direction:column;flex:1">${rows.join('')}</div>
    <div style="display:flex;justify-content:flex-end;color:#8b85ff;font-size:20px">${esc(SITE_NAME)}</div>
  </div>`;
  return render(html, text);
}

export async function renderSiteOg(subtitle: string): Promise<ArrayBuffer> {
  const colors = TIER_MEANINGS.map((m) => m.color);
  const labels = TIER_MEANINGS.map((m) => m.label);
  const rows = labels
    .map(
      (l, i) => `<div style="display:flex;height:52px;margin-bottom:6px">
        <div style="display:flex;align-items:center;justify-content:center;width:72px;background:${colors[i]};color:#1a1a22;font-size:30px">${l}</div>
        <div style="display:flex;flex:1;background:#23232d"></div></div>`,
    )
    .join('');
  const title = SITE_NAME;
  const html = `<div style="display:flex;width:${W}px;height:${H}px;background:#16161d;padding:64px;font-family:'Noto Sans JP'">
    <div style="display:flex;flex-direction:column;justify-content:center;width:560px">
      <div style="display:flex;color:#fff;font-size:56px;line-height:1.25">${esc(title)}</div>
      <div style="display:flex;color:#a3a3b8;font-size:28px;margin-top:20px">${esc(subtitle)}</div>
    </div>
    <div style="display:flex;flex-direction:column;justify-content:center;flex:1;margin-left:40px">${rows}</div>
  </div>`;
  return render(html, title + subtitle + labels.join(''));
}

/** R2 にあればそれを返し、なければ生成して保存する */
export async function cachedPng(key: string, generate: () => Promise<ArrayBuffer>, ctx: ExecutionContext): Promise<Response> {
  const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' };
  const existing = await env.IMAGES_BUCKET.get(key);
  if (existing) return new Response(existing.body, { headers });
  const png = await generate();
  ctx.waitUntil(env.IMAGES_BUCKET.put(key, png, { httpMetadata: { contentType: 'image/png' } }));
  return new Response(png, { headers });
}
