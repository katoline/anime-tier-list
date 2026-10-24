// セッションとユーザー作成。パスワードは扱わず、Google ログインとメールのログインリンクだけを使う。

import type { AstroCookies } from 'astro';
import { env } from 'cloudflare:workers';
import { randomToken, sha256Hex, shortId } from './crypto';

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export const SESSION_COOKIE = 'sid';
/** ログイン中かどうかだけをクライアント側の表示切り替えに使う（中身はユーザー名のみ、HttpOnly ではない） */
export const HINT_COOKIE = 'li';

const DAY = 24 * 60 * 60 * 1000;
const SESSION_TTL = 30 * DAY;
const SESSION_REFRESH = 15 * DAY;

function cookieOptions(url: URL, maxAgeMs: number, httpOnly = true) {
  return {
    path: '/',
    httpOnly,
    sameSite: 'lax' as const,
    secure: url.protocol === 'https:',
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export async function createSession(cookies: AstroCookies, url: URL, user: SessionUser): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), user.id, now + SESSION_TTL, now)
    .run();
  cookies.set(SESSION_COOKIE, token, cookieOptions(url, SESSION_TTL));
  cookies.set(HINT_COOKIE, user.username, cookieOptions(url, SESSION_TTL, false));
}

interface UserRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

export async function validateSession(cookies: AstroCookies, url: URL): Promise<SessionUser | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id, u.email, u.username, u.display_name, u.avatar_url
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<UserRow & { expires_at: number }>();
  const now = Date.now();
  if (!row || row.expires_at < now) {
    clearSessionCookies(cookies, url);
    if (row) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  const user = toSessionUser(row);
  // 期限が近づいたら延長する（毎リクエストで書き込まないよう半分を過ぎたときだけ）
  if (row.expires_at - now < SESSION_REFRESH) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(now + SESSION_TTL, id).run();
    cookies.set(SESSION_COOKIE, token, cookieOptions(url, SESSION_TTL));
    cookies.set(HINT_COOKIE, user.username, cookieOptions(url, SESSION_TTL, false));
  }
  return user;
}

export function clearSessionCookies(cookies: AstroCookies, url: URL): void {
  cookies.delete(SESSION_COOKIE, { path: '/', secure: url.protocol === 'https:', httpOnly: true, sameSite: 'lax' });
  cookies.delete(HINT_COOKIE, { path: '/', secure: url.protocol === 'https:', sameSite: 'lax' });
}

export async function destroySession(cookies: AstroCookies, url: URL): Promise<void> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
  clearSessionCookies(cookies, url);
}

// ---- ユーザー名 ----

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set([
  'admin', 'api', 'about', 'anime', 'auth', 'edit', 'help', 'login', 'logout', 'me', 'new', 'og', 'img',
  'privacy', 'root', 'seasons', 'settings', 'support', 'system', 'takedown', 'terms', 'user', 'users',
]);

export function isValidUsername(name: string): boolean {
  return USERNAME_RE.test(name) && !RESERVED.has(name);
}

function usernameBase(email: string): string {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 12);
  return local.length >= 3 ? local : 'user';
}

async function uniqueUsername(email: string): Promise<string> {
  const base = usernameBase(email);
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 && !RESERVED.has(base) ? base : `${base}_${shortId(4).toLowerCase()}`;
    if (!isValidUsername(candidate)) continue;
    const taken = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(candidate).first();
    if (!taken) return candidate;
  }
  return `user_${shortId(10).toLowerCase()}`;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

const USER_COLUMNS = 'id, email, username, display_name, avatar_url';

export async function findOrCreateUserByEmail(email: string): Promise<SessionUser> {
  const existing = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`).bind(email).first<UserRow>();
  if (existing) return toSessionUser(existing);
  return insertUser({ email, displayName: email.split('@')[0].slice(0, 30), avatarUrl: null, googleSub: null });
}

export async function findOrCreateUserByGoogle(profile: {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}): Promise<SessionUser> {
  const bySub = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE google_sub = ?`).bind(profile.sub).first<UserRow>();
  if (bySub) return toSessionUser(bySub);
  // 確認済みのメールアドレスが一致する既存アカウントには Google を紐付ける
  const byEmail = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`).bind(profile.email).first<UserRow>();
  if (byEmail && !profile.emailVerified) throw new Error('確認されていないメールアドレスです');
  if (byEmail) {
    await env.DB.prepare('UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?')
      .bind(profile.sub, profile.picture, Date.now(), byEmail.id)
      .run();
    return toSessionUser({ ...byEmail, avatar_url: byEmail.avatar_url ?? profile.picture });
  }
  return insertUser({
    email: profile.email,
    displayName: (profile.name ?? profile.email.split('@')[0]).slice(0, 30),
    avatarUrl: profile.picture,
    googleSub: profile.sub,
  });
}

async function insertUser(input: { email: string; displayName: string; avatarUrl: string | null; googleSub: string | null }): Promise<SessionUser> {
  const id = crypto.randomUUID();
  const username = await uniqueUsername(input.email);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO users (id, email, username, display_name, avatar_url, google_sub, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, input.email, username, input.displayName, input.avatarUrl, input.googleSub, now, now)
    .run();
  return { id, email: input.email, username, displayName: input.displayName, avatarUrl: input.avatarUrl };
}
