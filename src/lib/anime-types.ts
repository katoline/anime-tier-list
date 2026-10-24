export interface AnimeImage {
  /** R2 上のキー（サイズ接尾辞なし）。`${key}-160.webp` と `${key}-480.webp` が存在する */
  key: string;
  /** 取得元の画像 URL。変化がなければ再アップロードしない */
  source: string;
}

export interface Anime {
  /** サイト内 ID。例: `al-195516` */
  id: string;
  anilistId: number;
  slug: string;
  /** 表示用タイトル（日本語を優先） */
  title: string;
  titleRomaji: string | null;
  titleEnglish: string | null;
  format: string | null;
  episodes: number | null;
  /** YYYY-MM-DD（日が不明なら YYYY-MM） */
  startDate: string | null;
  studios: string[];
  genres: string[];
  officialUrl: string | null;
  sourceUrl: string;
  /** 文字カードの背景色に使う代表色 */
  color: string | null;
  /** 前の季節から続いている作品（2クール目など） */
  continuing: boolean;
  popularity: number;
  image: AnimeImage | null;
}

export interface SeasonData {
  id: string;
  year: number;
  season: string;
  /** 作品一覧が最後に変化した日時（ISO 8601） */
  updatedAt: string;
  source: string;
  items: Anime[];
}

export interface Override {
  /** 一覧から除外する */
  hidden?: boolean;
  /** 画像だけを表示しない（削除依頼への対応など） */
  hideImage?: boolean;
  title?: string;
  officialUrl?: string;
}

export type Overrides = Record<string, Override>;
