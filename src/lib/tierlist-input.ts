// API で受け取ったティア表の入力を検証する
import { getSeason } from './data';
import { cleanDescription, cleanTitle, isVisibility, normalizeTierList, ValidationError, type TierListData, type Visibility } from './tierlist';

export interface TierListInput {
  seasonId: string;
  title: string;
  description: string;
  visibility: Visibility;
  data: TierListData;
  version: number;
}

export function parseTierListInput(body: unknown): TierListInput {
  if (!body || typeof body !== 'object') throw new ValidationError('リクエストの形式が不正です');
  const b = body as Record<string, unknown>;
  const season = typeof b.seasonId === 'string' ? getSeason(b.seasonId) : undefined;
  if (!season) throw new ValidationError('季節が正しくありません');
  if (!isVisibility(b.visibility)) throw new ValidationError('公開範囲が正しくありません');
  return {
    seasonId: season.id,
    title: cleanTitle(b.title),
    description: cleanDescription(b.description),
    visibility: b.visibility,
    data: normalizeTierList(b.data, season.items.map((a) => a.id)),
    version: Number.isInteger(b.version) ? (b.version as number) : 0,
  };
}
