export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function errorJson(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export async function readJson<T = unknown>(request: Request, maxBytes = 64 * 1024): Promise<T | null> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 同一オリジンからのリクエストか（CSRF 対策） */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    // Origin を送らない古いブラウザ向けに Sec-Fetch-Site も見る
    const site = request.headers.get('sec-fetch-site');
    return site === null || site === 'same-origin' || site === 'none';
  }
  return origin === new URL(request.url).origin;
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
}

/** レート制限。バインディングがない環境（テスト等）では常に許可 */
export async function allow(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    return true;
  }
}

/** ログイン後の戻り先として安全な相対パスか */
export function safeNextPath(value: unknown): string {
  if (typeof value !== 'string') return '/me';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/me';
  return value.slice(0, 300);
}
