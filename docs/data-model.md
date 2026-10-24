# データ

## 作品データ（`data/seasons/{季節ID}.json`）

季節 ID は `{年}-{winter|spring|summer|fall}` です（例: `2026-fall`）。

```jsonc
{
  "id": "2026-fall",
  "year": 2026,
  "season": "fall",
  "updatedAt": "2026-10-20T19:00:00.000Z",
  "source": "AniList",
  "items": [
    {
      "id": "al-195516",           // AniList の ID に al- を付けたもの。ティア表はこの ID で作品を参照する
      "anilistId": 195516,
      "slug": "195516-kusuriya-no-hitorigoto-3rd-season", // 作品ページの URL（/anime/{slug}）
      "title": "薬屋のひとりごと 第3期", // 表示名（日本語を優先）
      "titleRomaji": "Kusuriya no Hitorigoto 3rd Season",
      "titleEnglish": "The Apothecary Diaries Season 3",
      "format": "TV",
      "episodes": 12,
      "startDate": "2026-10-02",   // 日が不明なら YYYY-MM
      "studios": ["OLM"],
      "genres": ["Drama", "Mystery"],
      "officialUrl": "https://kusuriyanohitorigoto.jp/",
      "sourceUrl": "https://anilist.co/anime/195516",
      "color": "#e4a128",          // 文字カードの背景色の元
      "continuing": false,         // 前の季節から続く作品なら true
      "popularity": 103153,
      "image": null                // 画像あり: { "key": "anime/al-195516-abcdef1234", "source": "取得元 URL" }
    }
  ]
}
```

正確な型は `src/lib/anime-types.ts`、検証ルールは `scripts/lib/validate.mjs` にあります。CI は PR ごとに `scripts/validate-data.mjs --base-ref origin/main` を実行し、形式の誤り・ID の重複に加えて、main と比べて作品数が半分未満に減っていないかを確認します。

画像は R2 に `{key}-160.webp`、`{key}-480.webp`、`{key}-160.jpg`（OGP 合成用）の 3 つを置きます。key に画像のハッシュが入るので、画像が変わると key も変わります。

### 上書き（`data/overrides.json`）

```json
{
  "al-12345": { "hidden": true },
  "al-23456": { "hideImage": true },
  "al-34567": { "title": "正しい作品名", "officialUrl": "https://example.com" }
}
```

週次の自動取得はこのファイルを書き換えないので、手動の修正が消えることはありません。

## D1 のテーブル

スキーマは `migrations/0001_init.sql`。時刻はすべて Unix ミリ秒です。

| テーブル | 内容 | 主な列 |
| --- | --- | --- |
| `users` | ユーザー | `email`（一意）、`username`（一意、URL に使う）、`display_name`、`google_sub` |
| `sessions` | ログインセッション | `id` はトークンの SHA-256。`expires_at` |
| `email_tokens` | ログインリンク | `id` はトークンの SHA-256。15 分で失効、1 回使うと削除 |
| `tier_lists` | ティア表 | `season_id`、`visibility`、`data`（JSON）、`ranked_count`、`version`、`write_id` |
| `anime_stats` | 作品ごとの集計 | `(season_id, anime_id)` が主キー。`score_sum`、`count`、`b0`〜`b6`（S〜F の票数） |
| `takedown_requests` | 削除依頼 | `anime_id`、連絡先、理由、`status` |

### `tier_lists.data` の形

```json
{
  "tiers": [
    { "id": "s", "label": "S", "color": "#ff7f7f", "items": ["al-1", "al-2"] },
    { "id": "a", "label": "A", "color": "#ffbf7f", "items": [] }
  ],
  "unranked": ["al-3"]
}
```

保存時に `normalizeTierList` が検証し、その季節にない作品 ID を捨て、置かれていない作品を `unranked` に足します。週次更新で作品が増減しても古いティア表は壊れません。

### 同時更新と集計の整合性

- 更新は `version` が一致するときだけ成功します（楽観的排他制御）。一致しなければ 409 を返します
- 書き込みごとに乱数の `write_id` を入れ、集計の加減算は「その `write_id` の書き込みが反映されたときだけ」実行します。ティア表の更新と集計の更新は D1 の batch で 1 つのトランザクションとして実行します

### マイグレーション

本番適用後のスキーマ変更は、`migrations/0002_xxx.sql` のように新しいファイルを追加します（適用済みのファイルは書き換えない）。Deploy ワークフローが `wrangler d1 migrations apply --remote` で自動適用します。

## API

すべて JSON。GET 以外は同じオリジンからのリクエストのみ受け付けます。

| メソッド | パス | 認証 | 内容 |
| --- | --- | --- | --- |
| POST | `/api/tierlists` | 要 | 作成。`{ seasonId, title, description, visibility, data }` → `201 { id, version, visibility, username }` |
| GET | `/api/tierlists/{id}` | 要（本人） | 編集用に取得 |
| PUT | `/api/tierlists/{id}` | 要（本人） | 更新。本文に `version` を含める。古い版なら 409 |
| DELETE | `/api/tierlists/{id}` | 要（本人） | 削除（集計からも外す） |
| POST | `/api/me` | 要 | ユーザー名・表示名の変更 |
| DELETE | `/api/me` | 要 | 退会 |
| POST | `/api/auth/email` | 不要 | ログインリンクの送信（Turnstile、レート制限） |
| POST | `/api/auth/email/verify` | 不要 | リンクのトークンでログイン |
| GET | `/api/auth/google` | 不要 | Google ログイン開始 |
| GET | `/api/auth/google/callback` | 不要 | Google からの戻り |
| POST | `/api/auth/logout` | 不要 | ログアウト |
| POST | `/api/takedown` | 不要 | 削除依頼（Turnstile、レート制限） |

エラーは `{ "error": "日本語のメッセージ" }` の形で、400（入力の誤り）・401・403・404・409・429・503 を使います。
