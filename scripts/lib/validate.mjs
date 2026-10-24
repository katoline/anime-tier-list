// 季節データの形式チェック（CI とテストで共用）

const ID_RE = /^al-\d+$/;
const SLUG_RE = /^[0-9]+(-[a-z0-9-]+)?$/;
const KEY_RE = /^anime\/al-\d+-[0-9a-f]{10}$/;

export function validateSeasonData(data, expectedId) {
  const errors = [];
  if (data.id !== expectedId) errors.push(`id が ${expectedId} ではありません: ${data.id}`);
  if (!Number.isInteger(data.year)) errors.push('year が整数ではありません');
  if (!['winter', 'spring', 'summer', 'fall'].includes(data.season)) errors.push(`season が不正です: ${data.season}`);
  if (Number.isNaN(Date.parse(data.updatedAt))) errors.push('updatedAt が日時ではありません');
  if (!Array.isArray(data.items)) return [...errors, 'items が配列ではありません'];
  if (data.items.length === 0) errors.push('作品が 0 件です');

  const ids = new Set();
  const slugs = new Set();
  data.items.forEach((a, i) => {
    const at = `items[${i}]`;
    if (!ID_RE.test(a.id ?? '')) errors.push(`${at}.id が不正です: ${a.id}`);
    if (ids.has(a.id)) errors.push(`${at}.id が重複しています: ${a.id}`);
    ids.add(a.id);
    if (!SLUG_RE.test(a.slug ?? '')) errors.push(`${at}.slug が不正です: ${a.slug}`);
    if (slugs.has(a.slug)) errors.push(`${at}.slug が重複しています: ${a.slug}`);
    slugs.add(a.slug);
    if (typeof a.title !== 'string' || !a.title.trim()) errors.push(`${at}.title が空です`);
    if (typeof a.sourceUrl !== 'string' || !a.sourceUrl.startsWith('https://')) errors.push(`${at}.sourceUrl が不正です`);
    if (a.officialUrl !== null && !/^https?:\/\//.test(a.officialUrl ?? '')) errors.push(`${at}.officialUrl が不正です`);
    if (typeof a.continuing !== 'boolean') errors.push(`${at}.continuing が真偽値ではありません`);
    if (a.image !== null) {
      if (!KEY_RE.test(a.image?.key ?? '')) errors.push(`${at}.image.key が不正です: ${a.image?.key}`);
      if (typeof a.image?.source !== 'string') errors.push(`${at}.image.source がありません`);
    }
  });
  return errors;
}
