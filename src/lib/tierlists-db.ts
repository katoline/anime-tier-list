// ティア表の保存・取得と、公開ティア表からの集計の更新

import { env } from 'cloudflare:workers';
import { shortId } from './crypto';
import {
  contributions,
  rankedCount,
  statDeltas,
  STAT_BUCKETS,
  type TierListData,
  type Visibility,
} from './tierlist';

export interface TierListRecord {
  id: string;
  userId: string;
  seasonId: string;
  title: string;
  description: string;
  visibility: Visibility;
  data: TierListData;
  rankedCount: number;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface TierListSummary extends Omit<TierListRecord, 'data'> {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface Row {
  id: string;
  user_id: string;
  season_id: string;
  title: string;
  description: string;
  visibility: Visibility;
  data?: string;
  ranked_count: number;
  version: number;
  created_at: number;
  updated_at: number;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
}

function toRecord(row: Row): TierListRecord {
  return {
    id: row.id,
    userId: row.user_id,
    seasonId: row.season_id,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    data: JSON.parse(row.data ?? '{"tiers":[],"unranked":[]}'),
    rankedCount: row.ranked_count,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSummary(row: Row): TierListSummary {
  const { data: _data, ...rest } = toRecord(row);
  return { ...rest, username: row.username ?? '', displayName: row.display_name ?? '', avatarUrl: row.avatar_url ?? null };
}

const SUMMARY_COLUMNS = `t.id, t.user_id, t.season_id, t.title, t.description, t.visibility, t.ranked_count, t.version,
  t.created_at, t.updated_at, u.username, u.display_name, u.avatar_url`;

export async function getTierList(id: string): Promise<(TierListRecord & { username: string; displayName: string; avatarUrl: string | null }) | null> {
  const row = await env.DB.prepare(
    `SELECT t.*, u.username, u.display_name, u.avatar_url FROM tier_lists t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
  )
    .bind(id)
    .first<Row>();
  if (!row) return null;
  return { ...toRecord(row), username: row.username!, displayName: row.display_name!, avatarUrl: row.avatar_url ?? null };
}

export async function listByUser(userId: string, opts: { publicOnly?: boolean; limit?: number } = {}): Promise<TierListSummary[]> {
  const where = opts.publicOnly ? "t.user_id = ? AND t.visibility = 'public'" : 't.user_id = ?';
  const { results } = await env.DB.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM tier_lists t JOIN users u ON u.id = t.user_id WHERE ${where} ORDER BY t.updated_at DESC LIMIT ?`,
  )
    .bind(userId, opts.limit ?? 100)
    .all<Row>();
  return results.map(toSummary);
}

/** 公開ティア表の新着。作品をある程度置いたものだけを載せる */
export async function listPublic(opts: { seasonId?: string; limit?: number; before?: number } = {}): Promise<TierListSummary[]> {
  const conds = ["t.visibility = 'public'", 't.ranked_count >= 3'];
  const binds: unknown[] = [];
  if (opts.seasonId) {
    conds.push('t.season_id = ?');
    binds.push(opts.seasonId);
  }
  if (opts.before) {
    conds.push('t.updated_at < ?');
    binds.push(opts.before);
  }
  binds.push(opts.limit ?? 20);
  const { results } = await env.DB.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM tier_lists t JOIN users u ON u.id = t.user_id WHERE ${conds.join(' AND ')} ORDER BY t.updated_at DESC LIMIT ?`,
  )
    .bind(...binds)
    .all<Row>();
  return results.map(toSummary);
}

/** 公開状態のティア表だけが集計に寄与する */
function contributionOf(visibility: Visibility, data: TierListData) {
  return visibility === 'public' ? contributions(data) : null;
}

function statStatements(seasonId: string, tierListId: string, writeId: string, deltas: ReturnType<typeof statDeltas>): D1PreparedStatement[] {
  const now = Date.now();
  // その書き込み（write_id）が実際に反映された場合だけ加減算する。
  // 同じティア表への同時保存で集計が二重に動かないようにするため。
  return deltas.map((d) =>
    env.DB.prepare(
      `INSERT INTO anime_stats (season_id, anime_id, score_sum, count, b0, b1, b2, b3, b4, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ? = (SELECT write_id FROM tier_lists WHERE id = ?) OR NOT EXISTS (SELECT 1 FROM tier_lists WHERE id = ?)
       ON CONFLICT(season_id, anime_id) DO UPDATE SET
         score_sum = score_sum + excluded.score_sum,
         count = count + excluded.count,
         b0 = b0 + excluded.b0, b1 = b1 + excluded.b1, b2 = b2 + excluded.b2, b3 = b3 + excluded.b3, b4 = b4 + excluded.b4,
         updated_at = excluded.updated_at`,
    ).bind(
      seasonId,
      d.animeId,
      d.scoreDelta,
      d.countDelta,
      ...d.bucketDeltas,
      now,
      writeId,
      tierListId,
      tierListId,
    ),
  );
}

export async function createTierList(input: {
  userId: string;
  seasonId: string;
  title: string;
  description: string;
  visibility: Visibility;
  data: TierListData;
}): Promise<TierListRecord> {
  const id = shortId(10);
  const now = Date.now();
  const writeId = shortId(16);
  const insert = env.DB.prepare(
    `INSERT INTO tier_lists (id, user_id, season_id, title, description, visibility, data, ranked_count, version, write_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).bind(id, input.userId, input.seasonId, input.title, input.description, input.visibility, JSON.stringify(input.data), rankedCount(input.data), writeId, now, now);
  const deltas = statDeltas(null, contributionOf(input.visibility, input.data));
  await env.DB.batch([insert, ...statStatements(input.seasonId, id, writeId, deltas)]);
  return { ...input, id, rankedCount: rankedCount(input.data), version: 1, createdAt: now, updatedAt: now };
}

export class ConflictError extends Error {}

export async function updateTierList(
  current: TierListRecord,
  next: { title: string; description: string; visibility: Visibility; data: TierListData },
  expectedVersion: number,
): Promise<TierListRecord> {
  if (expectedVersion !== current.version) throw new ConflictError();
  const now = Date.now();
  const writeId = shortId(16);
  const update = env.DB.prepare(
    `UPDATE tier_lists SET title = ?, description = ?, visibility = ?, data = ?, ranked_count = ?, version = version + 1, write_id = ?, updated_at = ?
      WHERE id = ? AND version = ?`,
  ).bind(next.title, next.description, next.visibility, JSON.stringify(next.data), rankedCount(next.data), writeId, now, current.id, expectedVersion);
  const deltas = statDeltas(contributionOf(current.visibility, current.data), contributionOf(next.visibility, next.data));
  const [result] = await env.DB.batch([update, ...statStatements(current.seasonId, current.id, writeId, deltas)]);
  if (!result.meta.changes) throw new ConflictError();
  return { ...current, ...next, rankedCount: rankedCount(next.data), version: current.version + 1, updatedAt: now };
}

export async function deleteTierList(current: TierListRecord): Promise<void> {
  const deltas = statDeltas(contributionOf(current.visibility, current.data), null);
  // 先に行を消し、存在しないことを条件に集計から差し引く
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tier_lists WHERE id = ? AND version = ?').bind(current.id, current.version),
    ...statStatements(current.seasonId, current.id, '', deltas),
  ]);
}

export interface AnimeStat {
  animeId: string;
  average: number;
  count: number;
  distribution: number[];
}

export async function getSeasonStats(seasonId: string): Promise<AnimeStat[]> {
  const { results } = await env.DB.prepare(
    'SELECT anime_id, score_sum, count, b0, b1, b2, b3, b4 FROM anime_stats WHERE season_id = ? AND count > 0',
  )
    .bind(seasonId)
    .all<{ anime_id: string; score_sum: number; count: number; b0: number; b1: number; b2: number; b3: number; b4: number }>();
  return results
    .map((r) => ({
      animeId: r.anime_id,
      average: Math.round((r.score_sum / r.count) * 10) / 10,
      count: r.count,
      distribution: [r.b0, r.b1, r.b2, r.b3, r.b4],
    }))
    .sort((a, b) => b.average - a.average || b.count - a.count);
}

export { STAT_BUCKETS };
