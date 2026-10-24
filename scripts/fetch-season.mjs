#!/usr/bin/env node
// 今期のアニメ一覧を AniList から取得して data/seasons/<季節ID>.json を更新する。
// 画像はサムネイル（160px / 480px の WebP と、OGP 合成用の 160px JPEG）に変換して R2 にアップロードする。
//
// 使い方:
//   node scripts/fetch-season.mjs [--season 2026-fall] [--upload s3|local|none] [--min-popularity 300] [--max-items 120]
//
// --upload s3    : R2 の S3 互換 API へアップロード（R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET）
// --upload local : wrangler の --local R2 へ書き込む（ローカル開発用）
// --upload none  : 画像を扱わない（既存の画像情報はそのまま残す）
// 既定は R2 の認証情報があれば s3、なければ none。

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  seasonOf,
  seasonId,
  parseSeasonId,
  previousSeason,
  seasonStartInt,
} from '../src/lib/season.ts';
import { toEntry, isEligible, sameItems } from './lib/transform.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANILIST_URL = 'https://graphql.anilist.co';
const MAX_ITEMS = 120;
const IMAGE_SIZES = [160, 480];
// OGP 画像の合成（satori）は WebP 非対応なので、小さい JPEG も用意する
const OGP_JPEG_WIDTH = 160;

function parseArgs(argv) {
  const args = { season: null, upload: null, minPopularity: 300, maxItems: MAX_ITEMS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--season') args.season = argv[++i];
    else if (a === '--upload') args.upload = argv[++i];
    else if (a === '--min-popularity') args.minPopularity = Number(argv[++i]);
    else if (a === '--max-items') args.maxItems = Number(argv[++i]);
    else throw new Error(`不明な引数: ${a}`);
  }
  if (!args.upload) {
    args.upload = process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY ? 's3' : 'none';
  }
  if (!['s3', 'local', 'none'].includes(args.upload)) throw new Error(`--upload は s3 / local / none のいずれか: ${args.upload}`);
  return args;
}

const MEDIA_FIELDS = `
  id
  title { native romaji english }
  format
  episodes
  status
  startDate { year month day }
  studios(isMain: true) { nodes { name } }
  genres
  siteUrl
  externalLinks { site url type }
  coverImage { extraLarge large color }
  popularity
  countryOfOrigin
  isAdult
`;

const SEASON_QUERY = `
query ($season: MediaSeason, $year: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $year, type: ANIME, format_in: [TV, TV_SHORT, ONA], isAdult: false, sort: POPULARITY_DESC) {
      ${MEDIA_FIELDS}
    }
  }
}`;

// 前の季節に始まり、今も放送中の作品（2クール目）
const CONTINUING_QUERY = `
query ($from: FuzzyDateInt, $to: FuzzyDateInt, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(status: RELEASING, type: ANIME, format_in: [TV, TV_SHORT, ONA], isAdult: false, startDate_greater: $from, startDate_lesser: $to, sort: POPULARITY_DESC) {
      ${MEDIA_FIELDS}
    }
  }
}`;

async function anilist(query, variables, attempt = 0) {
  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429 && attempt < 5) {
    const wait = Number(res.headers.get('retry-after') ?? 60);
    console.warn(`AniList のレート制限。${wait} 秒待機します`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return anilist(query, variables, attempt + 1);
  }
  if (!res.ok) throw new Error(`AniList API エラー: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`AniList API エラー: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function fetchAll(query, variables) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const data = await anilist(query, { ...variables, page });
    all.push(...data.Page.media);
    if (!data.Page.pageInfo.hasNextPage) break;
    // AniList の制限（毎分 30〜90 リクエスト）に余裕を持たせる
    await new Promise((r) => setTimeout(r, 1000));
  }
  return all;
}

function createUploader(mode) {
  if (mode === 's3') {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
    const bucket = process.env.R2_BUCKET || 'anime-tier-images';
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new Error('R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY が必要です');
    }
    let client;
    const getClient = async () => {
      if (!client) {
        const { AwsClient } = await import('aws4fetch');
        client = new AwsClient({
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY,
          service: 's3',
          region: 'auto',
        });
      }
      return client;
    };
    const objectUrl = (key) => `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${key}`;
    return {
      async put(key, body, contentType) {
        const res = await (await getClient()).fetch(objectUrl(key), {
          method: 'PUT',
          body,
          headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
        });
        if (!res.ok) throw new Error(`R2 へのアップロードに失敗: ${key} ${res.status} ${await res.text()}`);
      },
      async exists(key) {
        const res = await (await getClient()).fetch(objectUrl(key), { method: 'HEAD' });
        return res.ok;
      },
    };
  }
  if (mode === 'local') {
    return {
      async put(key, body, contentType) {
        const file = join(tmpdir(), `anime-tier-${process.pid}-${Math.random().toString(36).slice(2)}`);
        await writeFile(file, body);
        try {
          execFileSync(
            'npx',
            ['wrangler', 'r2', 'object', 'put', `anime-tier-images/${key}`, '--file', file, '--content-type', contentType, '--local'],
            { cwd: ROOT, stdio: 'ignore' },
          );
        } finally {
          await rm(file, { force: true });
        }
      },
      // ローカルでは存在確認をしない（毎回 wrangler を起動すると遅いため）
      async exists() {
        return true;
      },
    };
  }
  return null;
}

async function processImage(sourceUrl, animeId, upload) {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`画像の取得に失敗: ${sourceUrl} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 10);
  const key = `anime/${animeId}-${hash}`;
  const { default: sharp } = await import('sharp');
  for (const width of IMAGE_SIZES) {
    const out = await sharp(buf).resize({ width }).webp({ quality: 78 }).toBuffer();
    await upload.put(`${key}-${width}.webp`, out, 'image/webp');
  }
  const jpeg = await sharp(buf).resize({ width: OGP_JPEG_WIDTH }).jpeg({ quality: 80 }).toBuffer();
  await upload.put(`${key}-${OGP_JPEG_WIDTH}.jpg`, jpeg, 'image/jpeg');
  return { key, source: sourceUrl };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ref = args.season ? parseSeasonId(args.season) : seasonOf(new Date());
  if (!ref) throw new Error(`季節 ID の形式が不正です: ${args.season}`);
  const id = seasonId(ref);
  const file = join(ROOT, 'data', 'seasons', `${id}.json`);
  const existing = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
  const existingById = new Map((existing?.items ?? []).map((a) => [a.id, a]));

  console.log(`${id} の作品を取得します（画像: ${args.upload}）`);
  const seasonMedia = await fetchAll(SEASON_QUERY, { season: ref.season.toUpperCase(), year: ref.year });
  const prevStart = seasonStartInt(previousSeason(ref));
  const continuingMedia = await fetchAll(CONTINUING_QUERY, { from: prevStart - 1, to: seasonStartInt(ref) });

  const seen = new Set();
  const candidates = [];
  for (const [list, continuing] of [[seasonMedia, false], [continuingMedia, true]]) {
    for (const media of list) {
      if (seen.has(media.id) || !isEligible(media, args.minPopularity)) continue;
      seen.add(media.id);
      candidates.push(toEntry(media, continuing));
    }
  }
  candidates.sort((a, b) => b.popularity - a.popularity);
  const items = candidates.slice(0, args.maxItems);

  const upload = createUploader(args.upload);
  let uploaded = 0;
  for (const item of items) {
    const prev = existingById.get(item.id);
    const source = item._imageSource;
    delete item._imageSource;
    // 画像が変わっておらず、アップロード先にも残っていれば再利用する
    const reusable = prev?.image && prev.image.source === source && (!upload || (await upload.exists(`${prev.image.key}-160.webp`)));
    if (reusable) {
      item.image = prev.image;
    } else if (upload && source) {
      try {
        item.image = await processImage(source, item.id, upload);
        uploaded++;
      } catch (err) {
        console.warn(`画像をスキップ: ${item.title}: ${err.message}`);
        item.image = prev?.image ?? null;
      }
    } else {
      item.image = prev?.image ?? null;
    }
  }

  if (existing && sameItems(existing.items, items)) {
    console.log('変更はありませんでした');
    return;
  }

  const data = {
    id,
    year: ref.year,
    season: ref.season,
    updatedAt: new Date().toISOString(),
    source: 'AniList',
    items,
  };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  const added = items.filter((a) => !existingById.has(a.id)).length;
  console.log(`${file} を更新しました（${items.length} 作品、新規 ${added}、画像アップロード ${uploaded}）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
