// ティア表データの型・検証・集計用スコア計算（DB や実行環境に依存しない純粋なロジック）

export interface Tier {
  id: string;
  label: string;
  color: string;
  items: string[];
}

export interface TierListData {
  tiers: Tier[];
  unranked: string[];
}

export type Visibility = 'private' | 'unlisted' | 'public';
export const VISIBILITIES: Visibility[] = ['private', 'unlisted', 'public'];
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: '非公開',
  unlisted: 'リンクを知っている人のみ',
  public: '公開',
};

export const LIMITS = {
  maxTiers: 10,
  maxLabel: 20,
  maxTitle: 60,
  maxDescription: 300,
  maxItems: 300,
};

export const DEFAULT_TIERS: Omit<Tier, 'items'>[] = [
  { id: 's', label: 'S', color: '#ff7f7f' },
  { id: 'a', label: 'A', color: '#ffbf7f' },
  { id: 'b', label: 'B', color: '#ffdf7f' },
  { id: 'c', label: 'C', color: '#ffff7f' },
  { id: 'd', label: 'D', color: '#bfff7f' },
  { id: 'e', label: 'E', color: '#7fffff' },
  { id: 'f', label: 'F', color: '#7fbfff' },
];

/** 標準ティア（S〜F）それぞれの意味。エディタと説明ページに表示する */
export const TIER_MEANINGS: { label: string; color: string; title: string; text: string }[] = [
  { label: 'S', color: '#ff7f7f', title: '神作・今期の覇権', text: '今期でいちばん。誰かに勧めたい、何度でも見返したい作品' },
  { label: 'A', color: '#ffbf7f', title: '名作', text: '毎週の放送が待ち遠しい。期待以上に面白い' },
  { label: 'B', color: '#ffdf7f', title: '良作', text: '安定して面白く、最後まで見たい' },
  { label: 'C', color: '#ffff7f', title: '普通', text: '悪くはない。時間があれば見る' },
  { label: 'D', color: '#bfff7f', title: 'いまいち', text: '惜しいところが目立つ。好みが分かれそう' },
  { label: 'E', color: '#7fffff', title: '微妙', text: '見続けるか迷っている。途中で止まりそう' },
  { label: 'F', color: '#7fbfff', title: '合わなかった', text: '自分には合わず、視聴をやめた' },
];

export const TIER_COLOR_PRESETS = ['#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f', '#7fff7f', '#7fffff', '#7fbfff', '#bf7fff', '#ff7fbf', '#cfcfcf'];

export function emptyTierList(animeIds: string[]): TierListData {
  return { tiers: DEFAULT_TIERS.map((t) => ({ ...t, items: [] })), unranked: [...animeIds] };
}

export class ValidationError extends Error {}

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const TIER_ID_RE = /^[a-z0-9_-]{1,24}$/i;

function cleanText(value: unknown, max: number, field: string, required: boolean): string {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new ValidationError(`${field} が文字列ではありません`);
  // 制御文字を除き、前後の空白を落とす
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (required && !text) throw new ValidationError(`${field} を入力してください`);
  if ([...text].length > max) throw new ValidationError(`${field} は ${max} 文字以内にしてください`);
  return text;
}

export function cleanTitle(value: unknown): string {
  return cleanText(value, LIMITS.maxTitle, 'タイトル', true);
}

export function cleanDescription(value: unknown): string {
  return cleanText(value, LIMITS.maxDescription, '説明', false);
}

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === 'string' && (VISIBILITIES as string[]).includes(value);
}

/**
 * クライアントから受け取ったティア表を検証して正規化する。
 * 季節に含まれない作品は捨て、含まれるのに置かれていない作品は未分類に足す
 * （週次更新で作品が増えても古いティア表が壊れないように）。
 */
export function normalizeTierList(input: unknown, seasonAnimeIds: string[]): TierListData {
  if (!input || typeof input !== 'object') throw new ValidationError('ティア表の形式が不正です');
  const raw = input as { tiers?: unknown; unranked?: unknown };
  if (!Array.isArray(raw.tiers) || raw.tiers.length < 1 || raw.tiers.length > LIMITS.maxTiers) {
    throw new ValidationError(`ティアは 1〜${LIMITS.maxTiers} 段にしてください`);
  }
  const allowed = new Set(seasonAnimeIds);
  const placed = new Set<string>();
  const takeItems = (value: unknown): string[] => {
    if (!Array.isArray(value)) throw new ValidationError('作品リストの形式が不正です');
    if (value.length > LIMITS.maxItems) throw new ValidationError('作品が多すぎます');
    const out: string[] = [];
    for (const id of value) {
      if (typeof id !== 'string' || !allowed.has(id) || placed.has(id)) continue;
      placed.add(id);
      out.push(id);
    }
    return out;
  };

  const tierIds = new Set<string>();
  const tiers: Tier[] = raw.tiers.map((t: unknown, i: number) => {
    if (!t || typeof t !== 'object') throw new ValidationError('ティアの形式が不正です');
    const tier = t as Record<string, unknown>;
    let id = typeof tier.id === 'string' && TIER_ID_RE.test(tier.id) ? tier.id : `t${i}`;
    while (tierIds.has(id)) id = `${id}_`;
    tierIds.add(id);
    const color = typeof tier.color === 'string' && COLOR_RE.test(tier.color) ? tier.color.toLowerCase() : '#cfcfcf';
    return {
      id,
      label: cleanText(tier.label, LIMITS.maxLabel, 'ティア名', false),
      color,
      items: takeItems(tier.items),
    };
  });
  const unranked = takeItems(raw.unranked ?? []);
  for (const id of seasonAnimeIds) {
    if (!placed.has(id)) unranked.push(id);
  }
  return { tiers, unranked };
}

/** ティアに置かれた作品数 */
export function rankedCount(data: TierListData): number {
  return data.tiers.reduce((n, t) => n + t.items.length, 0);
}

/** 集計の 7 段階（S〜F）。カスタムしたティア数に関係なく、相対位置で振り分ける */
export const STAT_BUCKETS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'] as const;
export const STAT_BUCKET_COLORS = TIER_MEANINGS.map((m) => m.color);

export function scoreForTier(index: number, tierCount: number): number {
  if (tierCount <= 1) return 100;
  return (100 * (tierCount - 1 - index)) / (tierCount - 1);
}

export function bucketForScore(score: number): number {
  // 100 点を S、0 点を F として、いちばん近い段に振り分ける
  const last = STAT_BUCKETS.length - 1;
  return Math.min(last, Math.max(0, Math.round(((100 - score) * last) / 100)));
}

export interface Contribution {
  score: number;
  bucket: number;
}

/** 公開ティア表 1 件が集計に与える寄与（作品 ID → スコア） */
export function contributions(data: TierListData): Map<string, Contribution> {
  const out = new Map<string, Contribution>();
  // 空のティアは除いて相対位置を計算する（S と D だけ使った場合も両端になるように）
  const used = data.tiers.filter((t) => t.items.length > 0);
  used.forEach((tier, i) => {
    const score = scoreForTier(i, used.length);
    for (const id of tier.items) out.set(id, { score, bucket: bucketForScore(score) });
  });
  return out;
}

export interface StatDelta {
  animeId: string;
  scoreDelta: number;
  countDelta: number;
  bucketDeltas: number[];
}

/** 更新前後の寄与の差分。集計テーブルへの加減算に使う */
export function statDeltas(before: Map<string, Contribution> | null, after: Map<string, Contribution> | null): StatDelta[] {
  const ids = new Set([...(before?.keys() ?? []), ...(after?.keys() ?? [])]);
  const out: StatDelta[] = [];
  for (const id of ids) {
    const b = before?.get(id);
    const a = after?.get(id);
    if (b && a && b.score === a.score) continue;
    const bucketDeltas: number[] = STAT_BUCKETS.map(() => 0);
    if (b) bucketDeltas[b.bucket] -= 1;
    if (a) bucketDeltas[a.bucket] += 1;
    out.push({
      animeId: id,
      scoreDelta: (a?.score ?? 0) - (b?.score ?? 0),
      countDelta: (a ? 1 : 0) - (b ? 1 : 0),
      bucketDeltas,
    });
  }
  return out;
}
