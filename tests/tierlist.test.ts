import { describe, expect, it } from 'vitest';
import { contributions, normalizeTierList, statDeltas, ValidationError, cleanTitle, scoreForTier, bucketForScore } from '../src/lib/tierlist';

const ids = ['al-1', 'al-2', 'al-3', 'al-4'];

describe('normalizeTierList', () => {
  it('季節外・重複の作品を捨て、置かれていない作品を未分類に足す', () => {
    const data = normalizeTierList(
      {
        tiers: [
          { id: 's', label: ' S ', color: '#FF0000', items: ['al-1', 'al-999', 'al-1'] },
          { id: 's', label: 'A', color: 'red', items: ['al-2'] },
        ],
        unranked: [],
      },
      ids,
    );
    expect(data.tiers[0]).toEqual({ id: 's', label: 'S', color: '#ff0000', items: ['al-1'] });
    expect(data.tiers[1].id).toBe('s_');
    expect(data.tiers[1].color).toBe('#cfcfcf');
    expect(data.unranked).toEqual(['al-3', 'al-4']);
  });

  it('不正な形式は拒否する', () => {
    expect(() => normalizeTierList(null, ids)).toThrow(ValidationError);
    expect(() => normalizeTierList({ tiers: [] }, ids)).toThrow(ValidationError);
    expect(() => normalizeTierList({ tiers: Array.from({ length: 11 }, () => ({ items: [] })) }, ids)).toThrow(ValidationError);
    expect(() => normalizeTierList({ tiers: [{ label: 'x'.repeat(21), items: [] }] }, ids)).toThrow(ValidationError);
  });

  it('タイトルは必須で長さ制限がある', () => {
    expect(() => cleanTitle('   ')).toThrow(ValidationError);
    expect(() => cleanTitle('あ'.repeat(61))).toThrow(ValidationError);
    expect(cleanTitle(' 秋 ')).toBe('秋');
  });
});

describe('集計', () => {
  it('使われているティアだけで 0〜100 点に換算する', () => {
    const c = contributions({
      tiers: [
        { id: 's', label: 'S', color: '#000000', items: ['al-1'] },
        { id: 'a', label: 'A', color: '#000000', items: [] },
        { id: 'b', label: 'B', color: '#000000', items: ['al-2'] },
        { id: 'c', label: 'C', color: '#000000', items: ['al-3'] },
      ],
      unranked: ['al-4'],
    });
    expect(c.get('al-1')).toEqual({ score: 100, bucket: 0 });
    expect(c.get('al-2')).toEqual({ score: 50, bucket: 3 });
    expect(c.get('al-3')).toEqual({ score: 0, bucket: 6 });
    expect(c.has('al-4')).toBe(false);
  });

  it('7 段の標準ティアは S〜F にそのまま対応する', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => bucketForScore(scoreForTier(i, 7)))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('段数を減らしたティア表も両端が S と F になる', () => {
    expect([0, 1, 2].map((i) => bucketForScore(scoreForTier(i, 3)))).toEqual([0, 3, 6]);
  });

  it('更新前後の差分を出す', () => {
    const before = new Map([
      ['al-1', { score: 100, bucket: 0 }],
      ['al-2', { score: 50, bucket: 3 }],
    ]);
    const after = new Map([
      ['al-1', { score: 100, bucket: 0 }],
      ['al-3', { score: 0, bucket: 6 }],
    ]);
    const d = statDeltas(before, after);
    expect(d).toHaveLength(2);
    expect(d.find((x) => x.animeId === 'al-2')).toEqual({ animeId: 'al-2', scoreDelta: -50, countDelta: -1, bucketDeltas: [0, 0, 0, -1, 0, 0, 0] });
    expect(d.find((x) => x.animeId === 'al-3')).toEqual({ animeId: 'al-3', scoreDelta: 0, countDelta: 1, bucketDeltas: [0, 0, 0, 0, 0, 0, 1] });
    expect(statDeltas(before, null).every((x) => x.countDelta === -1)).toBe(true);
  });
});
