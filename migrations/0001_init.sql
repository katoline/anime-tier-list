-- ユーザー
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  google_sub TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ログインセッション（id はトークンの SHA-256。トークン本体は保存しない）
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

-- メールのログインリンク（id はトークンの SHA-256、1 回限り）
CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  next_path TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX email_tokens_expires ON email_tokens(expires_at);

-- ティア表（中身は JSON 1 列。保存・表示とも 1 行の読み書きで済む）
CREATE TABLE tier_lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'unlisted', 'public')),
  data TEXT NOT NULL,
  ranked_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  -- 書き込みごとの乱数。集計の加減算を、その書き込みが成功したときだけ適用するために使う
  write_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX tier_lists_user ON tier_lists(user_id, updated_at DESC);
CREATE INDEX tier_lists_public ON tier_lists(season_id, visibility, updated_at DESC);
CREATE INDEX tier_lists_public_all ON tier_lists(visibility, updated_at DESC);

-- 公開ティア表からの作品ごとの集計（保存時に差分で加減算する）
CREATE TABLE anime_stats (
  season_id TEXT NOT NULL,
  anime_id TEXT NOT NULL,
  score_sum REAL NOT NULL DEFAULT 0,
  count INTEGER NOT NULL DEFAULT 0,
  b0 INTEGER NOT NULL DEFAULT 0,
  b1 INTEGER NOT NULL DEFAULT 0,
  b2 INTEGER NOT NULL DEFAULT 0,
  b3 INTEGER NOT NULL DEFAULT 0,
  b4 INTEGER NOT NULL DEFAULT 0,
  b5 INTEGER NOT NULL DEFAULT 0,
  b6 INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (season_id, anime_id)
);

-- 画像・掲載の削除依頼
CREATE TABLE takedown_requests (
  id TEXT PRIMARY KEY,
  anime_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  url TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
