/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_IMAGE_MODE?: 'image' | 'text';
  readonly PUBLIC_ADSENSE_CLIENT?: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
  readonly PUBLIC_ADSENSE_SLOT_DEFAULT?: string;
  readonly PUBLIC_OPERATOR_NAME?: string;
  readonly PUBLIC_CONTACT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    IMAGES_BUCKET: R2Bucket;
    WRITE_LIMITER?: RateLimit;
    AUTH_LIMITER?: RateLimit;
    SITE_NAME: string;
    EMAIL_FROM: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    RESEND_API_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    /** ローカル開発用: 1 のときログインリンクをメール送信せずレスポンスに含める */
    DEV_EXPOSE_LOGIN_LINK?: string;
  }
}

interface Env extends Cloudflare.Env {}

declare namespace App {
  interface Locals {
    cfContext: ExecutionContext;
    user: import('./lib/auth').SessionUser | null;
  }
}
