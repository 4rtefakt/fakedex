-- Fakédex shared database (Cloudflare D1 / SQLite).
-- Apply with: wrangler d1 execute fakedex-db --file schema.sql

CREATE TABLE IF NOT EXISTS packs (
  hash          TEXT PRIMARY KEY,      -- SHA-256 of the pack file bytes
  name          TEXT NOT NULL,         -- display name
  source        TEXT,                  -- 'modrinth' | 'file'
  modrinth_slug TEXT,
  version       TEXT,
  entry_count   INTEGER NOT NULL DEFAULT 0,
  species_count INTEGER NOT NULL DEFAULT 0,
  published_at  INTEGER NOT NULL       -- unix ms
);

CREATE TABLE IF NOT EXISTS fakemon (
  pack_hash      TEXT NOT NULL,
  entry_id       TEXT NOT NULL,
  name           TEXT NOT NULL,
  name_lower     TEXT NOT NULL,
  dex_number     INTEGER,
  primary_type   TEXT,
  secondary_type TEXT,
  bst            INTEGER,
  kind           TEXT,                 -- species | form | addition
  abilities      TEXT,                 -- comma-separated
  egg_groups     TEXT,                 -- comma-separated
  PRIMARY KEY (pack_hash, entry_id),
  FOREIGN KEY (pack_hash) REFERENCES packs(hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fakemon_name  ON fakemon(name_lower);
CREATE INDEX IF NOT EXISTS idx_fakemon_type  ON fakemon(primary_type, secondary_type);
CREATE INDEX IF NOT EXISTS idx_fakemon_pack  ON fakemon(pack_hash);
CREATE INDEX IF NOT EXISTS idx_packs_slug    ON packs(modrinth_slug);
