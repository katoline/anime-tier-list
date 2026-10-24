// ローカルのプレビュー（npm run preview 相当、DEV_EXPOSE_LOGIN_LINK=1）に対する通しの動作確認。
//   BASE_URL=http://localhost:4321 node tests/e2e/smoke.mjs
// 未ログインでの作成 → メールでログイン → 保存 → 公開ページ → OGP → 集計 → 編集 → 削除 までを確認する。

import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const OUT = process.env.SCREENSHOT_DIR ?? 'tmp-screenshots';
await mkdir(OUT, { recursive: true });

function assert(cond, message) {
  if (!cond) throw new Error(`確認失敗: ${message}`);
  console.log(`✓ ${message}`);
}

const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
// ドラッグ中の自動スクロールで落とす位置がずれないよう、縦に十分な高さを取る
const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// 1. エディタで未ログインのままドラッグ&ドロップ
await page.goto(`${BASE}/seasons/2026/fall/edit`);
// React の読み込み（ハイドレーション）が終わるまで待つ
await page.waitForSelector('.editor:not(.is-loading) .tray-items .ecard-wrap');
const trayCount = await page.locator('.tray-items .ecard-wrap').count();
assert(trayCount >= 8, `未分類に作品が並ぶ（${trayCount} 件）`);

async function dragTo(source, target) {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 10, s.y + s.height / 2 + 10, { steps: 5 });
  await page.waitForTimeout(50);
  await page.mouse.move(t.x + Math.min(40, t.width / 2), t.y + t.height / 2, { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

const rows = page.locator('.editor-table .tier-row');
for (let i = 0; i < 4; i++) {
  await dragTo(page.locator('.tray-items .ecard-wrap').first(), rows.nth(0).locator('.tier-items'));
}
await dragTo(page.locator('.tray-items .ecard-wrap').first(), rows.nth(1).locator('.tier-items'));
await dragTo(page.locator('.tray-items .ecard-wrap').first(), rows.nth(6).locator('.tier-items'));
assert((await rows.nth(0).locator('.ecard-wrap').count()) === 4, 'S に 4 作品をドラッグできる');
assert((await rows.nth(1).locator('.ecard-wrap').count()) === 1, 'A に 1 作品をドラッグできる');

// タップ操作: カードを選んでから行をクリック
await page.locator('.tray-items .ecard-wrap').first().click();
await page.locator('.editor-table .tier-row').nth(2).locator('.tier-label').click();
assert((await rows.nth(2).locator('.ecard-wrap').count()) === 1, 'タップで B に移動できる');

// 同じ行の中で並べ替え
const firstTitle = await rows.nth(0).locator('.ecard-wrap').first().getAttribute('aria-label');
await dragTo(rows.nth(0).locator('.ecard-wrap').first(), rows.nth(0).locator('.ecard-wrap').nth(2));
const newFirst = await rows.nth(0).locator('.ecard-wrap').first().getAttribute('aria-label');
assert(firstTitle !== newFirst, '同じ行で並べ替えできる');

// ティア名の変更
await rows.nth(0).locator('.tier-label').click();
await page.fill('#label-s', '神');
await page.click('text=閉じる');
assert((await rows.nth(0).locator('.tier-label').textContent()) === '神', 'ティア名を変更できる');

await page.fill('#tl-title', 'E2E テストのティア表');
await page.screenshot({ path: `${OUT}/editor.png`, fullPage: true });

// 画像ダウンロード
const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=画像をダウンロード')]);
assert((await download.suggestedFilename()).endsWith('.png'), '画像をダウンロードできる');

// 2. 保存しようとするとログインへ。下書きは端末に残る
await page.click('text=ログインして保存');
await page.waitForURL(/\/login\?next=/);
await page.fill('#email', 'e2e@example.com');
await page.click('text=ログインリンクを送る');
const link = await page.waitForSelector('#dev-login-link');
await page.goto(await link.getAttribute('href'));
await page.click('#confirm');
await page.waitForURL(/\/seasons\/2026\/fall\/edit/);
await page.waitForSelector('.editor:not(.is-loading)');
assert((await page.locator('.editor-table .tier-row').nth(0).locator('.ecard-wrap').count()) === 4, 'ログイン後に下書きが復元される');
assert((await page.inputValue('#tl-title')) === 'E2E テストのティア表', 'タイトルも復元される');

// 3. 保存
await page.click('text=保存する');
await page.waitForSelector('text=保存しました。');
const listId = new URL(page.url()).searchParams.get('list');
assert(Boolean(listId), `保存すると ID が付く（${listId}）`);

// 4. 公開ページ
const pub = await context.newPage();
await pub.goto(`${BASE}/t/${listId}`);
assert((await pub.locator('h1').textContent()) === 'E2E テストのティア表', '公開ページが表示される');
assert((await pub.locator('.tier-row').first().locator('.acard').count()) === 4, '公開ページにティアが描画される');
const ogImage = await pub.locator('meta[property="og:image"]').getAttribute('content');
assert(ogImage.includes(`/og/t/${listId}.png?v=1`), 'OGP 画像の URL が入る');
assert(!(await pub.locator('[data-owner-only]').isHidden()), '本人には編集ボタンが出る');
await pub.screenshot({ path: `${OUT}/public.png`, fullPage: true });
const og = await pub.request.get(BASE + new URL(ogImage).pathname + new URL(ogImage).search);
assert(og.status() === 200 && og.headers()['content-type'] === 'image/png', 'OGP 画像が生成される');
const ogBody = await og.body();
const { writeFile } = await import('node:fs/promises');
await writeFile(`${OUT}/og.png`, ogBody);

// 5. 集計が季節ページに出る
await pub.goto(`${BASE}/seasons/2026/fall`);
assert((await pub.locator('.stats-table tbody tr').count()) === 7, '季節ページの評価ランキングに反映される（7 作品）');

// 6. 編集して非公開に → 集計から外れる
await page.selectOption('#tl-vis', 'private');
await page.click('text=上書き保存');
await page.waitForSelector('text=保存しました。');
await pub.goto(`${BASE}/seasons/2026/fall`);
assert((await pub.locator('.stats-table tbody tr').count()) === 0, '非公開にすると集計から外れる');

// 他人には見えない
const anon = await browser.newContext();
const anonPage = await anon.newPage();
const res = await anonPage.goto(`${BASE}/t/${listId}`);
assert(res.status() === 404, '非公開のティア表は他人に見えない');
const api = await anonPage.request.put(`${BASE}/api/tierlists/${listId}`, { data: {}, headers: { Origin: BASE } });
assert(api.status() === 401, '未ログインでは更新できない');
const csrf = await page.request.put(`${BASE}/api/tierlists/${listId}`, { data: {}, headers: { Origin: 'https://evil.example' } });
assert(csrf.status() === 403, '他サイトからの更新は拒否される');

// 7. 公開に戻して、二重保存の競合を確認
await page.selectOption('#tl-vis', 'public');
await page.click('text=上書き保存');
await page.waitForSelector('text=保存しました。');
const stale = await page.request.put(`${BASE}/api/tierlists/${listId}`, {
  headers: { Origin: BASE },
  data: { seasonId: '2026-fall', title: 'x', description: '', visibility: 'public', data: { tiers: [{ id: 's', label: 'S', color: '#ff7f7f', items: [] }], unranked: [] }, version: 1 },
});
assert(stale.status() === 409, '古い版からの保存は競合として拒否される');

// 8. マイページから削除 → 集計も消える
await page.goto(`${BASE}/me`);
page.once('dialog', (d) => d.accept());
await page.click(`[data-delete="${listId}"]`);
await page.waitForSelector(`[data-row="${listId}"]`, { state: 'detached' });
await pub.goto(`${BASE}/seasons/2026/fall`);
assert((await pub.locator('.stats-table tbody tr').count()) === 0, '削除すると集計からも消える');

// 9. スマホ表示
const mobile = await browser.newContext({ ...devices['iPhone 13'] });
const m = await mobile.newPage();
await m.goto(`${BASE}/seasons/2026/fall/edit`);
await m.waitForSelector('.editor:not(.is-loading) .tray-items .ecard-wrap');
await m.locator('.tray-items .ecard-wrap').first().tap();
await m.locator('.editor-table .tier-row').first().locator('.tier-label').tap();
assert((await m.locator('.editor-table .tier-row').first().locator('.ecard-wrap').count()) === 1, 'スマホでタップ操作できる');
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
assert(!overflow, 'スマホで横スクロールが出ない');
await m.screenshot({ path: `${OUT}/mobile-editor.png`, fullPage: true });
await m.goto(`${BASE}/`);
await m.screenshot({ path: `${OUT}/mobile-home.png`, fullPage: true });

assert(errors.length === 0, `ページの JavaScript エラーなし${errors.length ? `: ${errors.join(' / ')}` : ''}`);
await browser.close();
console.log('すべての確認が通りました');
