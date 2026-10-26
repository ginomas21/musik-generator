-- Musik Generator — skema (dibuat otomatis juga oleh lib/db.js saat boot).
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id TEXT, role TEXT NOT NULL DEFAULT 'user',
  expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS credit_orders(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, pack TEXT NOT NULL,
  credits INTEGER NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  txid TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), paid_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS generations(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT 'V6', mode TEXT NOT NULL DEFAULT 'sederhana',
  instrumental BOOLEAN NOT NULL DEFAULT FALSE, status TEXT NOT NULL DEFAULT 'generating',
  audio_urls TEXT NOT NULL DEFAULT '[]', error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), done_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
INSERT INTO meta(key,value) VALUES('order_seq',0) ON CONFLICT(key) DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_orders_user ON credit_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_gen_user ON generations(user_id);
