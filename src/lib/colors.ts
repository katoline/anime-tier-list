// 文字カードの配色。作品の代表色があればそれを、なければ ID から決まる色を使う。

function hashHue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function cardColors(anime: { id: string; color: string | null }): { bg: string; fg: string } {
  const bg = anime.color && /^#[0-9a-f]{6}$/i.test(anime.color) ? anime.color : hslToHex(hashHue(anime.id), 0.55, 0.45);
  return { bg, fg: luminance(bg) > 0.36 ? '#16161d' : '#ffffff' };
}

/** タイトルの長さに応じた文字サイズ（カード幅に対する em） */
export function cardFontSize(title: string): string {
  const len = [...title].length;
  if (len <= 6) return '.95rem';
  if (len <= 12) return '.82rem';
  if (len <= 24) return '.72rem';
  return '.64rem';
}
