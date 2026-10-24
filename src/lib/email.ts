import { env } from 'cloudflare:workers';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * ログインリンクを送る。RESEND_API_KEY が未設定の環境（ローカル開発）ではログに出すだけ。
 * 戻り値は送信できたかどうか。
 */
export async function sendLoginEmail(to: string, link: string): Promise<boolean> {
  const siteName = env.SITE_NAME;
  if (!env.RESEND_API_KEY) {
    console.log(`[dev] ログインリンク (${to}): ${link}`);
    return true;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: `${siteName} のログインリンク`,
      text: `${siteName} にログインするには、15 分以内に次のリンクを開いてください。\n\n${link}\n\nこのメールに心当たりがない場合は破棄してください。`,
      html: `<p>${escapeHtml(siteName)} にログインするには、15 分以内に次のボタンを押してください。</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">ログインする</a></p>
<p style="color:#666;font-size:12px">このメールに心当たりがない場合は破棄してください。</p>`,
    }),
  });
  if (!res.ok) console.error('メール送信に失敗', res.status, await res.text());
  return res.ok;
}
