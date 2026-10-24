# アニメティア表メーカー

今期のアニメをドラッグ&ドロップでランク付けしてティア表を作り、保存・公開・SNS 共有できるサイトです。Cloudflare Workers 上で動きます。

## 主な機能

- 季節（冬・春・夏・秋）ごとの作品一覧を、GitHub Actions が毎週 AniList から取得し、PR を作って自動マージ
- ティア表エディタ（ドラッグ&ドロップ、スマホのタップ操作、ティア名・色・段数の変更、PNG ダウンロード）
- 未ログインでも作成可能（端末に自動保存）。Google ログイン / メールのログインリンクで保存
- 公開範囲（非公開・限定公開・公開）、公開ページ、OGP 画像の自動生成、X / LINE / Bluesky への共有
- 公開ティア表から作品ごとの評価を集計し、季節ページ・作品ページにランキング表示
- SEO 用ページ（季節・作品・公開ティア表、構造化データ、サイトマップ）と広告枠（AdSense）
- 削除依頼フォーム、利用規約、プライバシーポリシー（外部送信の公表を含む）

## 画像の表示方式（2 種類）

作品画像の権利確認が取れるまでは、画像を一切使わない「文字カード」方式で運用できます。ビルド時の環境変数 `PUBLIC_IMAGE_MODE` で切り替えます。

| 値 | 表示 | 用途 |
| --- | --- | --- |
| `text`（既定） | 作品タイトルの文字カード。画像の配信も行わない（`/img/` は 404） | 権利確認が取れるまで |
| `image` | R2 に置いたサムネイル画像。利用者は「文字で表示」にも切り替えられる | 権利確認が取れたら |

本番では GitHub の Variables `IMAGE_MODE` を `image` にして再デプロイするだけで切り替わります。週次取得は画像モードに関係なく R2 へ画像を用意しておくので、切り替え時に追加作業はいりません。特定の作品だけ画像を出さない場合は `data/overrides.json` に `"al-12345": { "hideImage": true }` を書きます（一覧から外すなら `"hidden": true`）。

## 構成

| 役割 | 使っているもの |
| --- | --- |
| フレームワーク | Astro 7（SSR + 一部静的生成）、エディタのみ React + dnd-kit |
| 実行環境 | Cloudflare Workers（静的アセット付き） |
| DB | Cloudflare D1（ユーザー、セッション、ティア表、集計、削除依頼） |
| 画像 | Cloudflare R2（作品サムネイル、OGP 画像） |
| キャッシュ | Workers Cache API（未ログインの閲覧はエッジから返す） |
| OGP 画像 | workers-og（satori + resvg）。版ごとに 1 回だけ生成して R2 に保存 |
| メール | Resend |
| ボット対策 | Cloudflare Turnstile、Workers Rate Limiting |

作品データは `data/seasons/<季節ID>.json` としてリポジトリに置き、ワーカーに同梱します。作品情報の表示で DB は読みません。

負荷を抑える工夫:

- エディタ・ログイン・規約などは静的ファイル。エディタの操作はブラウザ内で完結し、サーバーへは「保存」時の 1 回だけ
- 季節・作品・公開ティア表・一覧ページは未ログインのアクセスをエッジにキャッシュ（60 秒〜30 分）
- ティア表の中身は 1 行の JSON。集計は保存時に差分だけ加減算（全件の再集計をしない）
- 画像はハッシュ付きのファイル名で 1 年キャッシュ。R2 は転送量が無料

## ローカルで動かす

Node.js 22.23 以上（`.nvmrc` は 24）が必要です。

```sh
npm install
cp .dev.vars.example .dev.vars        # DEV_EXPOSE_LOGIN_LINK=1 でメールなしにログインできる
npm run db:migrate:local
npm run build && npx astro preview    # http://localhost:4321
```

画像モードを試す場合（ローカルの R2 に一部の画像を入れる。データファイルが書き換わるので試した後は元に戻す）:

```sh
node scripts/fetch-season.mjs --upload local --max-items 10
PUBLIC_IMAGE_MODE=image npm run build && npx astro preview
git checkout data/seasons
```

### テスト

```sh
npm test                    # 単体テスト（Vitest）
npx astro check             # 型チェック
node scripts/validate-data.mjs
BASE_URL=http://localhost:4321 node tests/e2e/smoke.mjs   # ブラウザでの通し確認（preview 起動中に）
```

`tests/e2e/smoke.mjs` は、作成 → ログイン → 保存 → 公開ページ → OGP → 集計 → 非公開化 → 競合検出 → 削除 → スマホ操作までを確認します。

## 本番の準備（初回のみ）

1. Cloudflare でリソースを作る
   ```sh
   npx wrangler d1 create anime-tier          # 出力された database_id を wrangler.jsonc に書く
   npx wrangler r2 bucket create anime-tier-images
   ```
2. Workers のシークレットを設定する
   ```sh
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```
   - Google: Google Cloud Console で OAuth クライアント（ウェブ）を作り、リダイレクト URI に `https://<ドメイン>/api/auth/google/callback` を登録
   - Resend: 送信元ドメインを認証し、`wrangler.jsonc` の `EMAIL_FROM` をそのドメインのアドレスに変更
   - Turnstile: サイトを作成し、サイトキーを GitHub Variables の `TURNSTILE_SITE_KEY` に、シークレットを上記に設定
3. Workers にカスタムドメインを割り当てる（Cache API はカスタムドメインで有効になります）
4. GitHub の Secrets / Variables を設定する

   | 種類 | 名前 | 内容 |
   | --- | --- | --- |
   | Secret | `CLOUDFLARE_API_TOKEN` | Workers・D1 の編集権限を持つ API トークン |
   | Secret | `CLOUDFLARE_ACCOUNT_ID` | アカウント ID |
   | Secret | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 の API トークン（オブジェクトの読み書き） |
   | Secret | `BOT_APP_PRIVATE_KEY` | 週次 PR を作る GitHub App の秘密鍵 |
   | Variable | `BOT_APP_ID` | 同 App の ID（Contents / Pull requests の Read and write 権限を付けてこのリポジトリにインストール） |
   | Variable | `SITE_URL` | `https://<ドメイン>` |
   | Variable | `IMAGE_MODE` | `text` または `image` |
   | Variable | `ADSENSE_CLIENT` / `ADSENSE_SLOT_DEFAULT` | AdSense の `ca-pub-...` と広告ユニット ID（審査通過後に設定。未設定なら広告枠を出さない） |
   | Variable | `OPERATOR_NAME` / `CONTACT_EMAIL` | 規約・プライバシーポリシーに載せる運営者名と連絡先 |

5. リポジトリ設定で「Allow auto-merge」を有効にし、`main` のブランチ保護で CI（`test`）を必須チェックにする
6. Actions の「今期アニメの週次取得」を手動実行して、最初の画像アップロードと PR → 自動マージ → デプロイが通ることを確認する

## 週次の作品取得

`.github/workflows/weekly-fetch.yml` が毎週月曜 4:00（JST）に動きます。

1. `scripts/fetch-season.mjs` が AniList から今期の作品（前の季節から続く 2 クール目を含む、日本の作品、人気上位 120 件まで）を取得
2. 新しい・変わった画像だけを 160px / 480px の WebP と OGP 用の JPEG に変換して R2 へアップロード
3. 変化があれば `data/seasons/<季節ID>.json` を更新して PR を作成し、自動マージを予約
4. CI（データ検証・作品数の急減チェック・テスト・ビルド）が通るとマージされ、Deploy ワークフローが本番へ反映

人気度の変動だけでは PR を作りません。作品名の修正や除外は `data/overrides.json` で行い、自動更新で上書きされないようにしています。

## データ取得元と権利について

- 作品データは [AniList API](https://docs.anilist.co/) から取得しています。広告収益のある商用利用になるため、本番公開前に AniList の利用規約を確認し、必要なら問い合わせてください。
- 作品画像の著作権は各権利者にあります。`image` モードにする前に権利面の確認を行ってください。権利者からの依頼は `/takedown` のフォームで受け付け、D1 の `takedown_requests` テーブルに入ります。

## ディレクトリ

```
data/                 作品データ（週次で自動更新）と手動上書き
migrations/           D1 のスキーマ
scripts/              作品取得・データ検証
src/pages/            ページと API（/api/*）
src/components/       表示部品とティア表エディタ（editor/）
src/lib/              認証・DB・集計・OGP などのロジック
src/worker.ts         Workers のエントリ（Cron で期限切れセッションを掃除）
tests/                単体テストとブラウザでの通し確認
```
