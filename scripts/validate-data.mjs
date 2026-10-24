#!/usr/bin/env node
// data/ 以下の作品データを検証する。週次 PR の自動マージ前に CI で実行する。
//   node scripts/validate-data.mjs [--base-ref origin/main]
// --base-ref を付けると、その ref と比べて作品数が半分未満に減っていないかも確認する。

import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSeasonData } from './lib/validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEASON_DIR = join(ROOT, 'data', 'seasons');

const baseRefIndex = process.argv.indexOf('--base-ref');
const baseRef = baseRefIndex >= 0 ? process.argv[baseRefIndex + 1] : null;

function readAtRef(ref, path) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

const errors = [];
const files = (await readdir(SEASON_DIR)).filter((f) => f.endsWith('.json'));
for (const f of files) {
  const data = JSON.parse(await readFile(join(SEASON_DIR, f), 'utf8'));
  for (const e of validateSeasonData(data, f.replace(/\.json$/, ''))) errors.push(`${f}: ${e}`);
  if (baseRef) {
    const before = readAtRef(baseRef, `data/seasons/${f}`);
    if (before && data.items.length < before.items.length / 2) {
      errors.push(`${f}: 作品数が ${before.items.length} → ${data.items.length} に急減しています`);
    }
  }
}

const overrides = JSON.parse(await readFile(join(ROOT, 'data', 'overrides.json'), 'utf8'));
if (typeof overrides.items !== 'object' || overrides.items === null) errors.push('overrides.json: items がオブジェクトではありません');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${files.length} 季節分のデータを検証しました`);
