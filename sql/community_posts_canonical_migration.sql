ALTER TABLE posts
  ALTER COLUMN id TYPE TEXT,
  ALTER COLUMN platform TYPE TEXT,
  ALTER COLUMN author TYPE TEXT,
  ALTER COLUMN region TYPE TEXT,
  ALTER COLUMN type TYPE TEXT,
  ALTER COLUMN timestamp TYPE TIMESTAMP USING timestamp::timestamp;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

UPDATE posts
SET external_id = COALESCE(external_id, id),
    source = COALESCE(source, platform),
    meta = COALESCE(meta, '{}'::jsonb),
    updated_at = COALESCE(updated_at, NOW())
WHERE external_id IS NULL
   OR source IS NULL
   OR meta IS NULL
   OR updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_fingerprint ON posts(fingerprint);
CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform);
CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type);
