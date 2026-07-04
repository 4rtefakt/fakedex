// Shared helpers for the Fakédex API functions.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function bad(message, status = 400) {
  return json({ error: message }, status);
}

// D1 may be unbound in local dev before provisioning — fail clearly.
export function requireDB(env) {
  if (!env || !env.DB) throw new Error('D1 database (binding "DB") is not configured.');
  return env.DB;
}

// Idempotently ensure the tables exist, so provisioning is just "bind a D1".
let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(
      'CREATE TABLE IF NOT EXISTS packs (hash TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT, ' +
      'modrinth_slug TEXT, version TEXT, entry_count INTEGER NOT NULL DEFAULT 0, ' +
      'species_count INTEGER NOT NULL DEFAULT 0, published_at INTEGER NOT NULL)'
    ),
    db.prepare(
      'CREATE TABLE IF NOT EXISTS fakemon (pack_hash TEXT NOT NULL, entry_id TEXT NOT NULL, ' +
      'name TEXT NOT NULL, name_lower TEXT NOT NULL, dex_number INTEGER, primary_type TEXT, ' +
      'secondary_type TEXT, bst INTEGER, kind TEXT, abilities TEXT, egg_groups TEXT, thumb TEXT, ' +
      'PRIMARY KEY (pack_hash, entry_id))'
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_fakemon_name ON fakemon(name_lower)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_fakemon_type ON fakemon(primary_type, secondary_type)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_fakemon_pack ON fakemon(pack_hash)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_packs_slug ON packs(modrinth_slug)'),
    // Pre-rendered base Cobblemon thumbnails (seeded), keyed by normalised id.
    db.prepare('CREATE TABLE IF NOT EXISTS base_thumbs (norm TEXT PRIMARY KEY, thumb TEXT NOT NULL)'),
  ]);
  // Migration for DBs created before the `thumb` column existed (idempotent —
  // ALTER throws "duplicate column" once present, which we swallow).
  try { await db.prepare('ALTER TABLE fakemon ADD COLUMN thumb TEXT').run(); } catch (e) { /* already there */ }
  schemaReady = true;
}

export function str(v, max = 200) {
  return typeof v === 'string' ? v.slice(0, max) : null;
}

export function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

const HEX64 = /^[a-f0-9]{64}$/;
export function isHash(v) {
  return typeof v === 'string' && HEX64.test(v);
}
