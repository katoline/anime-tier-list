// 作品データ（data/ 以下の JSON）をビルド時に取り込み、上書き設定を適用して提供する。
// 作品マスタは DB ではなくワーカーに同梱するので、作品情報の参照に DB アクセスは発生しない。

import type { Anime, Overrides, SeasonData } from './anime-types';
import { IMAGE_MODE } from './config';
import { compareSeasons, parseSeasonId, seasonId, seasonOf, type SeasonRef } from './season';
import overridesFile from '../../data/overrides.json';

const seasonModules = import.meta.glob<SeasonData>('../../data/seasons/*.json', { eager: true, import: 'default' });
const overrides = (overridesFile as { items: Overrides }).items;

function applyOverrides(items: Anime[]): Anime[] {
  return items
    .filter((a) => !overrides[a.id]?.hidden)
    .map((a) => {
      const o = overrides[a.id];
      if (!o) return a;
      return {
        ...a,
        title: o.title ?? a.title,
        officialUrl: o.officialUrl ?? a.officialUrl,
        image: o.hideImage ? null : a.image,
      };
    });
}

const seasons: SeasonData[] = Object.values(seasonModules)
  .map((s) => ({ ...s, items: applyOverrides(s.items) }))
  .sort((a, b) => compareSeasons(parseSeasonId(b.id)!, parseSeasonId(a.id)!));

const seasonById = new Map(seasons.map((s) => [s.id, s]));
const animeById = new Map<string, Anime>();
const animeBySlug = new Map<string, Anime>();
const seasonsByAnime = new Map<string, string[]>();
// 新しい季節のデータを優先する（seasons は新しい順）
for (const s of seasons) {
  for (const a of s.items) {
    if (!animeById.has(a.id)) {
      animeById.set(a.id, a);
      animeBySlug.set(a.slug, a);
    }
    seasonsByAnime.set(a.id, [...(seasonsByAnime.get(a.id) ?? []), s.id]);
  }
}

export function getSeasons(): SeasonData[] {
  return seasons;
}

export function getSeason(id: string): SeasonData | undefined {
  return seasonById.get(id);
}

export function getAnime(id: string): Anime | undefined {
  return animeById.get(id);
}

export function getAnimeBySlug(slug: string): Anime | undefined {
  return animeBySlug.get(slug);
}

export function getAllAnime(): Anime[] {
  return [...animeById.values()];
}

export function seasonsOfAnime(id: string): string[] {
  return seasonsByAnime.get(id) ?? [];
}

/** 今の季節。データがまだなければ最新のデータがある季節 */
export function currentSeason(now = new Date()): SeasonData | undefined {
  return seasonById.get(seasonId(seasonOf(now))) ?? seasons[0];
}

export function seasonPath(ref: SeasonRef | SeasonData): string {
  return `/seasons/${ref.year}/${ref.season}`;
}

export type ImageSize = 160 | 480;

/** 画像モードでなければ常に null（文字カードで表示する） */
export function imageUrl(anime: Pick<Anime, 'image'>, size: ImageSize): string | null {
  if (IMAGE_MODE !== 'image' || !anime.image) return null;
  return `/img/${anime.image.key}-${size}.webp`;
}

/** エディタや OGP に渡す軽量な作品情報 */
export interface AnimeCardData {
  id: string;
  title: string;
  slug: string;
  color: string | null;
  image: string | null;
}

export function toCardData(a: Anime): AnimeCardData {
  return { id: a.id, title: a.title, slug: a.slug, color: a.color, image: imageUrl(a, 160) };
}
