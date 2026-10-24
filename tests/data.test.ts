import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { isEligible, sameItems, slugify, toEntry } from '../scripts/lib/transform.mjs';
import { validateSeasonData } from '../scripts/lib/validate.mjs';

const media = {
  id: 195516,
  title: { native: '薬屋のひとりごと 第3期', romaji: 'Kusuriya no Hitorigoto 3rd Season', english: null },
  format: 'TV',
  episodes: 24,
  startDate: { year: 2026, month: 10, day: 3 },
  studios: { nodes: [{ name: 'OLM' }] },
  genres: ['Drama', 'Mystery'],
  siteUrl: 'https://anilist.co/anime/195516',
  externalLinks: [{ site: 'Twitter', url: 'https://x.com/x' }, { site: 'Official Site', url: 'https://kusuriyanohitorigoto.jp/' }],
  coverImage: { extraLarge: 'https://example.com/a.jpg', large: 'https://example.com/b.jpg', color: '#e4a135' },
  popularity: 50000,
  countryOfOrigin: 'JP',
  isAdult: false,
};

describe('AniList からの変換', () => {
  it('作品データに変換する', () => {
    const e = toEntry(media, false);
    expect(e).toMatchObject({
      id: 'al-195516',
      slug: '195516-kusuriya-no-hitorigoto-3rd-season',
      title: '薬屋のひとりごと 第3期',
      startDate: '2026-10-03',
      studios: ['OLM'],
      officialUrl: 'https://kusuriyanohitorigoto.jp/',
      _imageSource: 'https://example.com/a.jpg',
    });
  });

  it('日本の作品で一定の人気があるものだけ対象', () => {
    expect(isEligible(media, 300)).toBe(true);
    expect(isEligible({ ...media, countryOfOrigin: 'CN' }, 300)).toBe(false);
    expect(isEligible({ ...media, popularity: 10 }, 300)).toBe(false);
  });

  it('スラッグは記号を落とす', () => {
    expect(slugify(1, 'Re:ZERO -Starting Life-')).toBe('1-re-zero-starting-life');
    expect(slugify(2, null)).toBe('2');
  });

  it('人気度の変動だけでは変更扱いにしない', () => {
    const a = toEntry(media, false);
    expect(sameItems([a], [{ ...a, popularity: 1 }])).toBe(true);
    expect(sameItems([a], [{ ...a, title: '別' }])).toBe(false);
  });
});

describe('同梱データ', () => {
  for (const f of readdirSync('data/seasons').filter((x: string) => x.endsWith('.json'))) {
    it(`${f} が正しい形式`, () => {
      const data = JSON.parse(readFileSync(`data/seasons/${f}`, 'utf8'));
      expect(validateSeasonData(data, f.replace('.json', ''))).toEqual([]);
    });
  }
});
