// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

export default defineConfig({
  site: process.env.SITE_URL || 'https://anime-tier.example.com',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [react()],
  // Astro のセッション機能は使わない（ログインは D1 の sessions テーブルで管理）
  session: false,
  trailingSlash: 'never',
  build: { format: 'file' },
});
