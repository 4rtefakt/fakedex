// GET /api/search?q=&type=&limit= — search fakemon across all published packs.
import { json, requireDB, ensureSchema, bad } from '../_utils.js';

export async function onRequestGet({ request, env }) {
  let db;
  try { db = requireDB(env); await ensureSchema(db); } catch (e) { return bad(e.message, 503); }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const type = (url.searchParams.get('type') || '').trim().toLowerCase();
  let limit = parseInt(url.searchParams.get('limit') || '60', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 60;
  limit = Math.min(limit, 200);

  const where = [];
  const binds = [];
  if (q) {
    where.push('(f.name_lower LIKE ? OR f.abilities LIKE ? OR f.egg_groups LIKE ?)');
    const like = '%' + q + '%';
    binds.push(like, like, like);
  }
  if (type) {
    where.push('(f.primary_type = ? OR f.secondary_type = ?)');
    binds.push(type, type);
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const sql =
    'SELECT f.name, f.dex_number, f.primary_type, f.secondary_type, f.bst, f.kind, ' +
    'f.abilities, f.egg_groups, p.name AS pack_name, p.hash AS pack_hash, p.modrinth_slug ' +
    'FROM fakemon f JOIN packs p ON p.hash = f.pack_hash ' +
    clause + ' ORDER BY f.name_lower LIMIT ?';
  binds.push(limit);

  try {
    const res = await db.prepare(sql).bind(...binds).all();
    return json({ results: res.results || [], count: (res.results || []).length, limit });
  } catch (e) {
    return bad('Database error: ' + e.message, 500);
  }
}
