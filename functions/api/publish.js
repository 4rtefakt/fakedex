// POST /api/publish — contribute a parsed pack to the shared dex.
// Body: { hash, name, source, modrinthSlug?, version?, entries: [{ id, name,
//         dexNumber, primaryType, secondaryType, statTotal, kind, abilities[], eggGroups[] }] }
import { json, bad, requireDB, ensureSchema, str, intOrNull, isHash } from '../_utils.js';

const MAX_ENTRIES = 6000;

export async function onRequestPost({ request, env }) {
  let db;
  try { db = requireDB(env); await ensureSchema(db); } catch (e) { return bad(e.message, 503); }

  let body;
  try { body = await request.json(); } catch (e) { return bad('Invalid JSON body.'); }

  if (!isHash(body.hash)) return bad('Missing or invalid pack hash (need SHA-256 hex).');
  const name = str(body.name);
  if (!name) return bad('Missing pack name.');
  if (!Array.isArray(body.entries) || !body.entries.length) return bad('No entries provided.');
  if (body.entries.length > MAX_ENTRIES) return bad('Too many entries.');

  // Dedup: same pack version is only stored once.
  const existing = await db.prepare('SELECT hash FROM packs WHERE hash = ?').bind(body.hash).first();
  if (existing) return json({ status: 'exists', hash: body.hash });

  const now = Date.now();
  let speciesCount = 0;
  const rows = [];
  for (const e of body.entries) {
    const nm = str(e && e.name, 120);
    const id = str(e && e.id, 160) || nm;
    if (!nm || !id) continue;
    const kind = str(e.kind, 20) || 'species';
    if (kind === 'species') speciesCount++;
    rows.push({
      entry_id: id,
      name: nm,
      name_lower: nm.toLowerCase(),
      dex_number: intOrNull(e.dexNumber),
      primary_type: str(e.primaryType, 20),
      secondary_type: str(e.secondaryType, 20),
      bst: intOrNull(e.statTotal),
      kind,
      abilities: Array.isArray(e.abilities) ? e.abilities.map(function (a) { return str(a, 40); }).filter(Boolean).join(',').slice(0, 400) : '',
      egg_groups: Array.isArray(e.eggGroups) ? e.eggGroups.map(function (g) { return str(g, 40); }).filter(Boolean).join(',').slice(0, 200) : '',
      thumb: str(e.thumb, 200000),
    });
  }
  if (!rows.length) return bad('No valid entries.');

  const stmts = [];
  stmts.push(
    db.prepare(
      'INSERT INTO packs (hash, name, source, modrinth_slug, version, entry_count, species_count, published_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(
      body.hash, name, str(body.source, 20) || 'file',
      str(body.modrinthSlug, 120), str(body.version, 60),
      rows.length, speciesCount, now
    )
  );
  const insEntry = db.prepare(
    'INSERT OR REPLACE INTO fakemon (pack_hash, entry_id, name, name_lower, dex_number, primary_type, secondary_type, bst, kind, abilities, egg_groups, thumb) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  for (const r of rows) {
    stmts.push(insEntry.bind(
      body.hash, r.entry_id, r.name, r.name_lower, r.dex_number,
      r.primary_type, r.secondary_type, r.bst, r.kind, r.abilities, r.egg_groups, r.thumb
    ));
  }

  try {
    await db.batch(stmts);
  } catch (e) {
    return bad('Database error: ' + e.message, 500);
  }
  return json({ status: 'published', hash: body.hash, entries: rows.length });
}
