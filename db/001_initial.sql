-- 游戏中心统一数据库
-- 共享表: users / sessions / auth_events（两个游戏 + 导航页共用一套账号与会话）
-- 每日方格: game_runs / scores（沿用原 schulte-grid 表结构，便于 pg_dump 直接迁移）
-- 每日秒感: ts_runs / ts_scores（由 scripts/import-timesense.mjs 从原 JSON 存储导入）

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  display_name varchar(24) NOT NULL,
  name_key varchar(64) NOT NULL UNIQUE,
  pin_salt varchar(64) NOT NULL,
  pin_hash varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type varchar(24) NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ip_hash char(64) NOT NULL,
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_events_lookup_idx
  ON auth_events(event_type, ip_hash, user_id, created_at DESC);

-- ===================== 每日方格（schulte-grid） =====================

CREATE TABLE IF NOT EXISTS game_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode varchar(16) NOT NULL CHECK (mode IN ('daily', 'replay', 'easy', 'classic', 'fifty')),
  grid_size smallint,
  run_date date NOT NULL,
  level_id varchar(80) NOT NULL,
  rules_version integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (
    (mode IN ('daily', 'replay') AND grid_size IS NULL) OR
    (mode IN ('easy', 'classic') AND grid_size BETWEEN 3 AND 6) OR
    (mode = 'fifty' AND grid_size = 5)
  )
);

CREATE INDEX IF NOT EXISTS game_runs_user_idx ON game_runs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS game_runs_daily_user_date_idx ON game_runs(user_id, run_date) WHERE mode = 'daily';

CREATE TABLE IF NOT EXISTS scores (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE REFERENCES game_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode varchar(16) NOT NULL CHECK (mode IN ('daily', 'replay', 'easy', 'classic', 'fifty')),
  grid_size smallint,
  score_date date NOT NULL,
  level_id varchar(80) NOT NULL,
  rules_version integer NOT NULL,
  total_ms integer NOT NULL CHECK (total_ms > 0 AND total_ms <= 3600000),
  total_errors integer NOT NULL CHECK (total_errors >= 0 AND total_errors <= 10000),
  stages jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scores_daily_rank_idx
  ON scores(score_date, total_ms, total_errors, completed_at)
  WHERE mode = 'daily';
CREATE INDEX IF NOT EXISTS scores_daily_user_date_idx
  ON scores(user_id, score_date)
  WHERE mode = 'daily';
CREATE INDEX IF NOT EXISTS scores_replay_rank_idx
  ON scores(score_date, total_ms, total_errors, completed_at)
  WHERE mode = 'replay';
CREATE INDEX IF NOT EXISTS scores_infinite_rank_idx
  ON scores(mode, grid_size, total_ms, total_errors, completed_at)
  WHERE mode NOT IN ('daily', 'replay');
CREATE INDEX IF NOT EXISTS scores_today_rank_idx
  ON scores(mode, grid_size, score_date, total_ms, total_errors, completed_at);

-- ===================== 每日秒感（time sense） =====================

CREATE TABLE IF NOT EXISTS ts_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode varchar(16) NOT NULL CHECK (mode IN ('daily', 'replay', 'custom')),
  targets smallint[] NOT NULL,
  rounds_per_target smallint NOT NULL CHECK (rounds_per_target BETWEEN 1 AND 10),
  run_date date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS ts_runs_user_idx ON ts_runs(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ts_scores (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE REFERENCES ts_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode varchar(16) NOT NULL CHECK (mode IN ('daily', 'replay', 'custom')),
  target smallint,
  score_date date NOT NULL,
  total_ms integer NOT NULL CHECK (total_ms >= 0),
  average_ms double precision NOT NULL CHECK (average_ms >= 0),
  best_ms integer NOT NULL CHECK (best_ms >= 0),
  rounds_count smallint NOT NULL CHECK (rounds_count > 0 AND rounds_count <= 100),
  stages jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((mode IN ('daily', 'replay') AND target IS NULL) OR (mode = 'custom' AND target BETWEEN 1 AND 60))
);

CREATE INDEX IF NOT EXISTS ts_scores_daily_rank_idx
  ON ts_scores(score_date, total_ms, completed_at)
  WHERE mode IN ('daily', 'replay');
CREATE INDEX IF NOT EXISTS ts_scores_custom_rank_idx
  ON ts_scores(target, average_ms, completed_at)
  WHERE mode = 'custom';
