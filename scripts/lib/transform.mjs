// AniList のレスポンスをサイト内の作品データへ変換する（テストしやすいよう副作用なし）

export function isEligible(media, minPopularity) {
  return media.countryOfOrigin === 'JP' && !media.isAdult && (media.popularity ?? 0) >= minPopularity;
}

export function slugify(anilistId, romaji) {
  const base = (romaji ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base ? `${anilistId}-${base}` : String(anilistId);
}

function formatDate(d) {
  if (!d?.year) return null;
  const mm = d.month ? String(d.month).padStart(2, '0') : null;
  if (!mm) return String(d.year);
  return d.day ? `${d.year}-${mm}-${String(d.day).padStart(2, '0')}` : `${d.year}-${mm}`;
}

function pickTitle(title) {
  return title.native?.trim() || title.romaji?.trim() || title.english?.trim() || '(タイトル不明)';
}

export function toEntry(media, continuing) {
  const official = (media.externalLinks ?? []).find((l) => l.site === 'Official Site' && l.url);
  return {
    id: `al-${media.id}`,
    anilistId: media.id,
    slug: slugify(media.id, media.title.romaji),
    title: pickTitle(media.title),
    titleRomaji: media.title.romaji ?? null,
    titleEnglish: media.title.english ?? null,
    format: media.format ?? null,
    episodes: media.episodes ?? null,
    startDate: formatDate(media.startDate),
    studios: (media.studios?.nodes ?? []).map((s) => s.name),
    genres: media.genres ?? [],
    officialUrl: official?.url ?? null,
    sourceUrl: media.siteUrl,
    color: media.coverImage?.color ?? null,
    continuing,
    popularity: media.popularity ?? 0,
    image: null,
    _imageSource: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
  };
}

// popularity は毎週変わるので比較から外す（変化のたびに PR が立たないように）
function comparable(items) {
  return JSON.stringify(items.map(({ popularity, ...rest }) => rest));
}

export function sameItems(a, b) {
  return comparable(a) === comparable(b);
}
