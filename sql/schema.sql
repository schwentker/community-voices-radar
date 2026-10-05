CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  platform TEXT NOT NULL,
  author TEXT,
  region TEXT,
  content TEXT,
  type TEXT,
  timestamp TIMESTAMP,
  source TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  fingerprint TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  platform VARCHAR(20) NOT NULL,
  region VARCHAR(20),
  join_date TIMESTAMPTZ,
  post_count INTEGER DEFAULT 0,
  is_champion BOOLEAN DEFAULT FALSE,
  is_ambassador BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(username, platform)
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id VARCHAR(50) REFERENCES posts(id) ON DELETE CASCADE,
  tag VARCHAR(50),
  PRIMARY KEY (post_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform);
CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type);
CREATE INDEX IF NOT EXISTS idx_posts_fingerprint ON posts(fingerprint);
CREATE INDEX IF NOT EXISTS idx_posts_timestamp ON posts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_members_platform ON members(platform);
