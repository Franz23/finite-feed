PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  linkedin_url TEXT NOT NULL UNIQUE,
  name TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_scraped_at TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  linkedin_url TEXT NOT NULL UNIQUE,
  content TEXT,
  post_kind TEXT NOT NULL DEFAULT 'original' CHECK (post_kind IN ('original', 'repost', 'quote')),
  published_at TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  seen_at TEXT,
  archived_reason TEXT CHECK (archived_reason IN ('seen', 'expired')),
  first_seen_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS posts_feed_idx ON posts(seen_at, published_at DESC);
CREATE INDEX IF NOT EXISTS posts_profile_idx ON posts(profile_id, published_at DESC);

CREATE TABLE IF NOT EXISTS refresh_runs (
  id TEXT PRIMARY KEY,
  actor_run_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'succeeded', 'partial', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  posts_received INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS refresh_runs_started_idx ON refresh_runs(started_at DESC);
