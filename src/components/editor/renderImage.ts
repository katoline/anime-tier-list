// ティア表を PNG 画像に描く（ブラウザ内で完結。サーバーには負荷をかけない）

import { cardColors } from '../../lib/colors';
import type { AnimeCardData } from '../../lib/data';
import type { TierListData } from '../../lib/tierlist';

const WIDTH = 1200;
const LABEL_W = 130;
const CARD_W = 80;
const CARD_H = 120;
const GAP = 4;
const PAD = 24;
const HEADER_H = 76;
const FOOTER_H = 44;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 日本語を含む文字列を幅に合わせて折り返す（文字単位） */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of [...text]) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && lines.join('').length < [...text].length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const FONT = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif';

export async function renderTierImage(opts: {
  data: TierListData;
  anime: Map<string, AnimeCardData>;
  showImages: boolean;
  title: string;
  subtitle: string;
  footer: string;
}): Promise<Blob> {
  const { data, anime, showImages } = opts;
  const perRow = Math.floor((WIDTH - PAD * 2 - LABEL_W - GAP) / (CARD_W + GAP));
  const rowHeights = data.tiers.map((t) => Math.max(1, Math.ceil(t.items.length / perRow)) * (CARD_H + GAP) + GAP);
  const height = HEADER_H + rowHeights.reduce((a, b) => a + b, 0) + FOOTER_H + PAD;

  const images = new Map<string, HTMLImageElement | null>();
  if (showImages) {
    const ids = data.tiers.flatMap((t) => t.items);
    await Promise.all(
      ids.map(async (id) => {
        const src = anime.get(id)?.image;
        if (src) images.set(id, await loadImage(src));
      }),
    );
  }

  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = WIDTH * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#16161d';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 28px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(wrapText(ctx, opts.title, WIDTH - PAD * 2, 1)[0] ?? '', PAD, 44);
  ctx.fillStyle = '#a3a3b8';
  ctx.font = `16px ${FONT}`;
  ctx.fillText(opts.subtitle, PAD, 66);

  let y = HEADER_H;
  data.tiers.forEach((tier, i) => {
    const h = rowHeights[i];
    ctx.fillStyle = tier.color;
    ctx.fillRect(PAD, y, LABEL_W, h - GAP);
    ctx.fillStyle = '#1a1a22';
    ctx.font = `bold ${[...tier.label].length > 4 ? 18 : 30}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelLines = wrapText(ctx, tier.label, LABEL_W - 16, 3);
    const lh = [...tier.label].length > 4 ? 22 : 34;
    labelLines.forEach((l, li) => ctx.fillText(l, PAD + LABEL_W / 2, y + (h - GAP) / 2 + (li - (labelLines.length - 1) / 2) * lh));
    ctx.fillStyle = '#23232d';
    ctx.fillRect(PAD + LABEL_W, y, WIDTH - PAD * 2 - LABEL_W, h - GAP);

    tier.items.forEach((id, j) => {
      const a = anime.get(id);
      if (!a) return;
      const cx = PAD + LABEL_W + GAP + (j % perRow) * (CARD_W + GAP);
      const cy = y + GAP + Math.floor(j / perRow) * (CARD_H + GAP);
      const img = images.get(id);
      if (img) {
        // object-fit: cover 相当
        const r = Math.max(CARD_W / img.width, CARD_H / img.height);
        const sw = CARD_W / r;
        const sh = CARD_H / r;
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, cx, cy, CARD_W, CARD_H);
      } else {
        const { bg, fg } = cardColors(a);
        ctx.fillStyle = bg;
        roundRect(ctx, cx, cy, CARD_W, CARD_H, 4);
        ctx.fill();
        ctx.fillStyle = fg;
        const len = [...a.title].length;
        const size = len <= 8 ? 14 : len <= 18 ? 12 : 10;
        ctx.font = `bold ${size}px ${FONT}`;
        const lines = wrapText(ctx, a.title, CARD_W - 10, Math.floor((CARD_H - 10) / (size + 3)));
        lines.forEach((l, li) => ctx.fillText(l, cx + CARD_W / 2, cy + CARD_H / 2 + (li - (lines.length - 1) / 2) * (size + 3)));
      }
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    y += h;
  });

  ctx.fillStyle = '#a3a3b8';
  ctx.font = `14px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(opts.footer, WIDTH - PAD, height - PAD + 4);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), 'image/png'));
}
