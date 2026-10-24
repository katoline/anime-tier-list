import { describe, expect, it } from 'vitest';
import { nextSeason, parseSeasonId, previousSeason, seasonId, seasonLabel, seasonOf, seasonStartInt } from '../src/lib/season';

describe('season', () => {
  it('日本時間で季節を判定する', () => {
    // 2026-09-30 15:00 UTC = 10/1 0:00 JST
    expect(seasonOf(new Date('2026-09-30T15:00:00Z'))).toEqual({ year: 2026, season: 'fall' });
    expect(seasonOf(new Date('2026-09-30T14:59:59Z'))).toEqual({ year: 2026, season: 'summer' });
    expect(seasonOf(new Date('2026-12-31T16:00:00Z'))).toEqual({ year: 2027, season: 'winter' });
  });

  it('ID の相互変換と前後の季節', () => {
    const ref = parseSeasonId('2026-winter')!;
    expect(seasonId(ref)).toBe('2026-winter');
    expect(previousSeason(ref)).toEqual({ year: 2025, season: 'fall' });
    expect(nextSeason({ year: 2026, season: 'fall' })).toEqual({ year: 2027, season: 'winter' });
    expect(parseSeasonId('2026-autumn')).toBeNull();
    expect(seasonLabel(ref)).toBe('2026年冬アニメ');
    expect(seasonStartInt({ year: 2026, season: 'summer' })).toBe(20260701);
  });
});
