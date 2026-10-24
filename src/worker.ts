// Cloudflare Workers のエントリポイント。リクエストは Astro に渡し、定期実行（Cron）だけここで扱う。
import { handle } from '@astrojs/cloudflare/handler';

export default {
  fetch: handle,
  async scheduled(_controller, env, ctx) {
    const now = Date.now();
    ctx.waitUntil(
      env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
        env.DB.prepare('DELETE FROM email_tokens WHERE expires_at < ?').bind(now),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
