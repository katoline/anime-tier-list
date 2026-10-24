# 運用

初回の準備（Cloudflare のリソース作成、Secrets、GitHub の設定）はリポジトリ直下の README の「本番の準備」と「リポジトリの設定」にあります。

## デプロイ

`main` にマージすると Deploy ワークフローが動き、テスト → ビルド → D1 マイグレーション → `wrangler deploy` の順に実行します。手動で再実行するときは Actions の「Deploy」から「Run workflow」を押します。

ビルド時の設定は GitHub の Variables で渡します（`SITE_URL`、`IMAGE_MODE`、`ADSENSE_CLIENT`、`ADSENSE_SLOT_DEFAULT`、`TURNSTILE_SITE_KEY`、`OPERATOR_NAME`、`CONTACT_EMAIL`）。値を変えたら Deploy を再実行してください。

### ロールバック

1. Cloudflare ダッシュボードの Workers → 対象のワーカー → Deployments から、前の版に戻す（すぐに効く）
2. 原因のコミットを `git revert` した PR を作ってマージする（次のデプロイで戻らないように）

D1 のマイグレーションは自動では戻りません。列の削除など戻せない変更は、2 回のリリースに分けて行ってください。

## 週次の作品取得

毎週月曜 4:00（JST）に `weekly-fetch.yml` が動きます。

1. AniList から今期の作品を取得（日本の作品、TV・TV 短編・ONA、人気度 300 以上、前の季節から続く作品を含めて最大 120 件）
2. 新しい・変わった画像だけを変換して R2 にアップロード
3. 変化があれば `bot/weekly-anime-data` ブランチに PR を作り、自動マージを予約
4. CI が通ればマージされ、Deploy が動く

季節の変わり目（1・4・7・10 月の最初の月曜）には新しい季節のファイルができ、サイトの「今期」も自動で切り替わります。

### うまくいかないとき

| 症状 | 確認すること |
| --- | --- |
| PR ができない | Actions のログ。AniList のエラー・レート制限、R2 の認証情報（`R2_*`）、GitHub App（`BOT_APP_ID` / `BOT_APP_PRIVATE_KEY`）の権限 |
| PR がマージされない | CI の失敗。作品数が急減した場合は検証で止まるので、AniList 側の一時的な問題か確認し、問題なければ手動で再実行 |
| マージされたのに反映されない | Deploy の失敗（Cloudflare の API トークン・アカウント ID） |

手動で取り直すときは Actions の「今期アニメの週次取得」から「Run workflow」を押します。

## 作品の修正・非表示

`data/overrides.json` を編集した PR を作ってマージします（形式は [data-model.md](data-model.md#上書きdataoverridesjson)）。

- 作品名の誤り: `"title"`
- 一覧から外す: `"hidden": true`
- 画像だけ出さない: `"hideImage": true`

非表示にした作品は、既存のティア表からも表示されなくなります（データは残るので、戻せば元どおり）。

## 画像モードの切り替え

権利面の確認が取れたら、GitHub の Variables `IMAGE_MODE` を `image` にして Deploy を再実行します。週次取得は画像モードに関係なく R2 に画像を用意しているので、追加の作業はいりません。戻すときは `text` にして再デプロイします。

## 削除依頼への対応

依頼は D1 の `takedown_requests` に入ります。

```sh
npx wrangler d1 execute anime-tier --remote --command "SELECT id, anime_id, name, email, reason, created_at FROM takedown_requests WHERE status = 'open' ORDER BY created_at"
```

1. 内容を確認し、必要なら `data/overrides.json` に `hidden` または `hideImage` を追加してマージする
2. 画像そのものを消す場合は、R2 の `anime/{作品ID}-*` を削除する
3. 対応したら状態を更新し、依頼者に連絡する

```sh
npx wrangler d1 execute anime-tier --remote --command "UPDATE takedown_requests SET status = 'done' WHERE id = '...'"
```

## 不適切なティア表への対応

今は管理画面がありません。タイトルや説明に問題がある公開ティア表は、次の順で対応します。

1. 対象を確認する
   ```sh
   npx wrangler d1 execute anime-tier --remote --command "SELECT id, user_id, title, visibility FROM tier_lists WHERE id = '...'"
   ```
2. 本人に連絡できる場合は、非公開か削除をお願いする
3. 急ぎの場合は SQL で直接変えず、集計（`anime_stats`）の差し引きもまとめて行う管理用の処理を追加してから対応する。`tier_lists` だけを書き換えると集計がずれるため

件数が増えてきたら、管理者用の非公開化 API を追加するのがおすすめです。

## 監視

- Cloudflare ダッシュボードの Workers → Metrics でエラー率と CPU 時間を確認する
- `npx wrangler tail` でリアルタイムのログを見られる
- D1 の使用量（読み書き行数・容量）は D1 の画面で確認する
- 週次取得・Deploy の失敗は GitHub の通知メールで届く

## バックアップ

D1 はタイムトラベル（過去 30 日の任意の時点に戻す）が使えます。

```sh
npx wrangler d1 time-travel info anime-tier
npx wrangler d1 time-travel restore anime-tier --timestamp=<UNIX 秒>
```

定期的なエクスポートが必要なら `npx wrangler d1 export anime-tier --remote --output=backup.sql` を使います。
