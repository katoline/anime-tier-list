# 構成

## 全体像

```
                ┌──────────────── GitHub ────────────────┐
                │  週次取得 (Actions) ──PR──> CI ──merge──> main ──> Deploy (Actions)
                │        │                                            │
                └────────┼────────────────────────────────────────────┼───┘
                         │ 画像を変換してアップロード                   │ wrangler deploy
                         ▼                                            ▼
AniList API ──> R2（作品画像・OGP 画像） <──── Cloudflare Workers（Astro SSR + 静的アセット）
                                                     │        │
                                                     │        └─> Cache API（エッジキャッシュ）
                                                     ▼
                                                 D1（ユーザー・ティア表・集計）
```

| 役割 | 使っているもの |
| --- | --- |
| フレームワーク | Astro 7（`output: 'server'`、一部 `prerender`）、エディタのみ React + dnd-kit |
| 実行環境 | Cloudflare Workers（`src/worker.ts` が入口。fetch は Astro、scheduled は掃除） |
| DB | Cloudflare D1（SQL を直接書く。ORM なし） |
| ストレージ | Cloudflare R2（`anime-tier-images` バケット） |
| OGP 画像 | workers-og（satori + resvg）。フォントは Noto Sans JP を使う文字だけ取得 |
| メール | Resend |
| ボット対策 | Turnstile、Workers Rate Limiting（`WRITE_LIMITER` / `AUTH_LIMITER`） |

## 作品データの持ち方

作品データは DB ではなく `data/seasons/{季節ID}.json` としてリポジトリに置き、ビルド時にワーカーへ同梱します。作品情報の表示では DB を読まないので、閲覧が増えても D1 の負荷になりません。更新は Git の履歴として残り、PR で差分を確認できます。

## リクエストの流れ

1. 静的ファイル（エディタ・規約・JS/CSS）は Workers の静的アセットとしてそのまま返る
2. それ以外は `src/middleware.ts` を通る
   - Cookie `sid` からセッションを読み、`locals.user` に入れる
   - `/api/` の GET 以外は `Origin` ヘッダーが自サイトであることを確認（CSRF 対策）
   - 未ログインの GET はエッジキャッシュを確認し、あれば返す
3. ページは必要なら `X-Edge-Cache: {秒}` ヘッダーを付ける。ミドルウェアはこのヘッダーを外し、未ログインで Set-Cookie のない 200 のレスポンスだけを `s-maxage` 付きでキャッシュに入れる
4. 共通のセキュリティヘッダー（`X-Content-Type-Options` など）を付ける
5. API は JSON を返す。書き込み系はレート制限を通す

## キャッシュ

| 対象 | 方法 | 期間 |
| --- | --- | --- |
| 静的アセット | ファイル名にハッシュ | 1 年 |
| 作品画像 `/img/` | R2 キーにハッシュ | 1 年 |
| 閲覧ページ | Cache API（未ログインのみ） | 1〜30 分 |
| OGP 画像 | R2 に保存 + Cache-Control | 版が変わるまで |

ティア表の更新直後に公開ページが古いまま見えるのは最大 60 秒です。本人には常に最新が見えます（ログイン中はキャッシュを使わないため）。

## ディレクトリ

```
data/
  seasons/{季節ID}.json   作品データ（週次で自動更新）
  overrides.json          手動の上書き（非表示・画像非表示・作品名・公式サイト）
docs/                     開発者向けドキュメント
migrations/               D1 のスキーマ
scripts/
  fetch-season.mjs        AniList から取得し、画像を R2 へ
  validate-data.mjs       作品データの検証（CI で使う）
  lib/                    取得・検証の共通処理（単体テスト対象）
src/
  worker.ts               Workers の入口（Cron で期限切れセッション・トークンを掃除）
  middleware.ts           セッション、CSRF、エッジキャッシュ
  lib/                    ロジック（下表）
  components/             表示部品。editor/ がティア表エディタ（React）
  layouts/Base.astro      共通レイアウト（meta、OGP、構造化データ、広告スクリプト）
  pages/                  ページと API
  styles/global.css       全体のスタイル
tests/                    単体テスト（Vitest）と e2e（Playwright）
```

| `src/lib/` | 役割 |
| --- | --- |
| `season.ts` | 季節 ID（`2026-fall`）の計算 |
| `data.ts` | 作品データの読み込みと上書きの適用 |
| `tierlist.ts` | ティア表の型・検証・標準ティア・集計スコア（純粋なロジック） |
| `tierlist-input.ts` | API の入力の検証 |
| `tierlists-db.ts` | ティア表と集計の D1 操作 |
| `auth.ts` | ユーザー・セッション・ログイン |
| `crypto.ts` | トークン・ID の生成、ハッシュ |
| `http.ts` | JSON レスポンス、レート制限 |
| `email.ts` / `turnstile.ts` | 外部サービス |
| `seo.ts` | 構造化データ、canonical |
| `og.ts` | OGP 画像の生成と保存 |
| `colors.ts` | 文字カードの色 |
| `config.ts` | 画像モード・サイト名など |
