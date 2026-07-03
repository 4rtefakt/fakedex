// GET /api/packs — list published packs (with a global stat header).
import { json, requireDB, ensureSchema, bad } from '../_utils.js';

export async function onRequestGet({ env }) {
  let db;
  try { db = requireDB(env); await ensureSchema(db); } catch (e) { return bad(e.message, 503); }
  try {
    const packs = await db.prepare(
      'SELECT hash, name, source, modrinth_slug, version, entry_count, species_count, published_at ' +
      'FROM packs ORDER BY published_at DESC LIMIT 200'
    ).all();
    const totals = await db.prepare(
      'SELECT (SELECT COUNT(*) FROM packs) AS packs, (SELECT COUNT(*) FROM fakemon) AS fakemon'
    ).first();
    return json({ packs: packs.results || [], totals: totals || { packs: 0, fakemon: 0 } });
  } catch (e) {
    return bad('Database error: ' + e.message, 500);
  }
}
