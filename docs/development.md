# 開発の進め方

## 必要なもの

- Node.js 22.23 以上（`.nvmrc` は 24）
- npm（依存関係は `package-lock.json` で固定。追加・更新したらロックファイルもコミットする）

## ローカルで動かす

```sh
npm install
cp .dev.vars.example .dev.vars     # DEV_EXPOSE_LOGIN_LINK=1 でメールを送らずにログインリンクを画面に出す
npm run db:migrate:local           # ローカルの D1 にテーブルを作る
npm run build
npx astro preview                  # http://localhost:4321
```

- D1・R2・Cache API は wrangler のローカル版（`.wrangler/state/`）が使われます。中身を消したいときはこのディレクトリを消して、マイグレーションからやり直します
- `.dev.vars` を変えたら、ビルドとプレビューをやり直してください
- Google ログイン・Turnstile・Resend をローカルで試す場合は、`.dev.vars` と `.env`（`.env.example` 参照）にキーを入れます。Turnstile のキーが空なら確認を省略します
- 画像モードを試す手順はリポジトリ直下の README にあります

## テスト

| コマンド | 内容 | CI |
| --- | --- | --- |
| `npm test` | 単体テスト（Vitest）。季節の計算、ティア表の検証・集計、作品データの変換・検証 | `test` |
| `npx astro check` | 型チェック | `test` |
| `node scripts/validate-data.mjs` | 作品データの検証 | `test` |
| `npm run build` | ビルド | `test` |
| `node tests/e2e/smoke.mjs` | ブラウザでの通し確認（プレビュー起動中に実行） | `e2e` |

e2e は作成 → ログイン → 保存 → 公開ページ → OGP → 集計 → 非公開化 → 競合検出 → 削除 → スマホ操作を確認します。失敗したときは CI の Artifacts に `e2e-screenshots`（画面とプレビューのログ）が残ります。ローカルで別の Chromium を使う場合は `CHROMIUM_PATH` を指定します。

ロジックを変えたら `tests/` に単体テストを足してください。DB や Workers に依存しない計算は `src/lib/tierlist.ts` のような純粋な関数に分けると、テストしやすくなります。

## ブランチと PR

- `main` には直接 push できません。作業用のブランチを切り、PR を作ってマージします
- マージ方法は **マージコミットのみ**（スカッシュ・リベースは無効）。コミットは「1 つの変更 = 1 コミット」で細かく分け、履歴がそのまま残るようにします
- CI の `test` と `e2e` が通り、PR の会話がすべて解決していないとマージできません
- マージするとブランチは自動で削除されます
- このリポジトリは外部からの PR を受け付けていません。許可された作成者（Variables の `PR_ALLOWED_AUTHORS`）とボット以外の PR は自動で閉じられます

### ブランチ名

| 種類 | 例 |
| --- | --- |
| 機能 | `feature/tier-presets` |
| 不具合 | `fix/og-font` |
| ドキュメント | `docs/operations` |
| 依存の更新 | Dependabot が `dependabot/...` を作る |
| 週次データ | ボットが `bot/weekly-anime-data` を使う |

### コミットメッセージ

`種類: 日本語の要約` の形にします。

| 種類 | 使いどころ |
| --- | --- |
| `feat` | 機能の追加・変更 |
| `fix` | 不具合の修正 |
| `docs` | ドキュメント |
| `test` | テスト |
| `ci` | GitHub Actions |
| `chore` | 設定・依存関係など |
| `refactor` | 動作を変えない整理 |

## CI/CD

| ワークフロー | ファイル | タイミング | 内容 |
| --- | --- | --- | --- |
| CI | `ci.yml` | PR、main への push | `test`（データ検証・単体テスト・型チェック・ビルド）、`e2e`（ブラウザでの通し確認） |
| CodeQL | `codeql.yml` | PR、main への push、毎週 | JavaScript/TypeScript と Actions のセキュリティ解析 |
| Deploy | `deploy.yml` | main への push、手動 | テスト → ビルド → D1 マイグレーション → `wrangler deploy` |
| 今期アニメの週次取得 | `weekly-fetch.yml` | 毎週月曜 4:00（JST）、手動 | 作品データ更新 PR を作り、自動マージを予約 |
| PR の作成者チェック | `pr-guard.yml` | PR 作成時 | 許可していない作成者の PR を閉じる |
| Dependabot | `dependabot.yml` | 毎週火曜 | npm と Actions の更新 PR |

サードパーティの Action（GitHub 公式以外）はコミットハッシュで固定します。

## コードの書き方

- コメントと UI の文言は日本語。UI は「です・ます」で、専門用語を避ける
- ページは Astro、操作が多い部分（エディタ）だけ React。ページに JS を足すときは小さなインラインスクリプトにする
- 閲覧ページを追加したら、未ログイン向けに `X-Edge-Cache` を付けるか検討する。ログイン状態で内容が変わる部分は、`li` Cookie を使うクライアント側の表示にする（キャッシュに個人の情報を入れない）
- D1 は SQL を直接書き、必ずプレースホルダー（`?`）で値を渡す
- 書き込み API は認証・入力検証・レート制限を通す。新しい API も `/api/` 配下に置けば CSRF 対策が効く
- 秘密の値は `wrangler secret` と GitHub Secrets に置き、リポジトリに入れない
