// サイト全体の設定。PUBLIC_ で始まる値はビルド時に埋め込まれる。

/**
 * 画像の表示方式。
 * - `text`  : 作品画像を一切使わず、タイトル文字のカードで表示する（権利面で安全な既定値）
 * - `image` : R2 に置いたサムネイル画像で表示する（権利確認が取れたら切り替える）
 */
export type ImageMode = 'image' | 'text';

export const IMAGE_MODE: ImageMode = import.meta.env.PUBLIC_IMAGE_MODE === 'image' ? 'image' : 'text';

export const SITE_NAME = 'アニメティア表メーカー';
export const SITE_DESCRIPTION =
  '今期アニメをドラッグ&ドロップでランク付けできるティア表メーカー。季節ごとに作って保存し、SNSで共有できます。';

export const ADSENSE_CLIENT: string = import.meta.env.PUBLIC_ADSENSE_CLIENT ?? '';
export const TURNSTILE_SITE_KEY: string = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? '';

/** 運営者名と問い合わせ先（規約・プライバシーポリシーに表示） */
export const OPERATOR_NAME: string = import.meta.env.PUBLIC_OPERATOR_NAME || `${SITE_NAME} 運営事務局`;
export const CONTACT_EMAIL: string = import.meta.env.PUBLIC_CONTACT_EMAIL || '';
