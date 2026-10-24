// 季節の定義は日本のアニメ業界の慣例に合わせる（冬 1〜3月 / 春 4〜6月 / 夏 7〜9月 / 秋 10〜12月）。
// scripts/ からも Node の型除去で読み込むため、型注釈以外の TypeScript 構文は使わない。

export const SEASONS = ['winter', 'spring', 'summer', 'fall'] as const;
export type SeasonName = (typeof SEASONS)[number];

export const SEASON_LABELS: Record<SeasonName, string> = {
  winter: '冬',
  spring: '春',
  summer: '夏',
  fall: '秋',
};

export const SEASON_START_MONTH: Record<SeasonName, number> = {
  winter: 1,
  spring: 4,
  summer: 7,
  fall: 10,
};

export interface SeasonRef {
  year: number;
  season: SeasonName;
}

export function isSeasonName(value: string): value is SeasonName {
  return (SEASONS as readonly string[]).includes(value);
}

/** 日付（JST）から季節を求める */
export function seasonOf(date: Date): SeasonRef {
  // UTC+9 に寄せてから月を取る
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const month = jst.getUTCMonth() + 1;
  const index = Math.floor((month - 1) / 3);
  return { year: jst.getUTCFullYear(), season: SEASONS[index] };
}

export function seasonId(ref: SeasonRef): string {
  return `${ref.year}-${ref.season}`;
}

export function parseSeasonId(id: string): SeasonRef | null {
  const m = /^(\d{4})-(winter|spring|summer|fall)$/.exec(id);
  if (!m) return null;
  return { year: Number(m[1]), season: m[2] as SeasonName };
}

export function seasonLabel(ref: SeasonRef): string {
  return `${ref.year}年${SEASON_LABELS[ref.season]}アニメ`;
}

export function previousSeason(ref: SeasonRef): SeasonRef {
  const i = SEASONS.indexOf(ref.season);
  return i === 0 ? { year: ref.year - 1, season: 'fall' } : { year: ref.year, season: SEASONS[i - 1] };
}

export function nextSeason(ref: SeasonRef): SeasonRef {
  const i = SEASONS.indexOf(ref.season);
  return i === 3 ? { year: ref.year + 1, season: 'winter' } : { year: ref.year, season: SEASONS[i + 1] };
}

/** 季節の開始日（YYYYMMDD の数値、AniList の FuzzyDateInt 形式） */
export function seasonStartInt(ref: SeasonRef): number {
  return ref.year * 10000 + SEASON_START_MONTH[ref.season] * 100 + 1;
}

export function compareSeasons(a: SeasonRef, b: SeasonRef): number {
  return a.year !== b.year ? a.year - b.year : SEASONS.indexOf(a.season) - SEASONS.indexOf(b.season);
}
