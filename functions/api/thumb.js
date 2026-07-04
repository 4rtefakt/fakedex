// /api/thumb — sprite thumbnails for social-preview images.
//
//   GET  /api/thumb?pack=<slug>&mon=<id>   -> image/webp bytes for one mon
//   POST /api/thumb  { hash, thumbs: { entryId: base64Webp } }  -> backfill
//
// Thumbnails are rendered client-side (128px WebP) and stored base64 in the
// fakemon.thumb column, so shared ?mon=&pack= links unfurl with the creature.
import { json, bad, requireDB, ensureSchema, str, isHash } from '../_utils.js';

const MAX_THUMBS = 6000;
const MAX_LEN = 200000; // base64 chars per thumb (~150 KB)

export async function onRequestGet({ request, env }) {
  let db;
  try { db = requireDB(env); await ensureSchema(db); } catch (e) { return bad(e.message, 503); }

  const url = new URL(request.url);
  const pack = url.searchParams.get('pack');
  const mon = url.searchParams.get('mon');
  if (!pack || !mon) return bad('Need pack (slug) and mon.');
  const key = String(mon).toLowerCase().replace(/[^a-z0-9]/g, '');

  const row = await db.prepare(
    'SELECT f.thumb FROM fakemon f JOIN packs p ON p.hash = f.pack_hash ' +
    'WHERE p.modrinth_slug = ? AND (f.entry_id = ? OR f.name_lower = ?) AND f.thumb IS NOT NULL LIMIT 1'
  ).bind(pack, mon, key).first();

  if (!row || !row.thumb) return new Response('Not found', { status: 404 });

  let bytes;
  try {
    const bin = atob(row.thumb);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (e) {
    return new Response('Corrupt thumbnail', { status: 500 });
  }
  return new Response(bytes, {
    headers: {
      'content-type': 'image/webp',
      'cache-control': 'public, max-age=86400',
    },
  });
}

export async function onRequestPost({ request, env }) {
  let db;
  try { db = requireDB(env); await ensureSchema(db); } catch (e) { return bad(e.message, 503); }

  let body;
  try { body = await request.json(); } catch (e) { return bad('Invalid JSON body.'); }
  if (!isHash(body.hash)) return bad('Missing or invalid pack hash.');
  const thumbs = body.thumbs;
  if (!thumbs || typeof thumbs !== 'object') return bad('No thumbs provided.');

  // Only accept thumbnails for a pack that already exists.
  const pack = await db.prepare('SELECT hash FROM packs WHERE hash = ?').bind(body.hash).first();
  if (!pack) return bad('Unknown pack.', 404);

  const ids = Object.keys(thumbs).slice(0, MAX_THUMBS);
  const upd = db.prepare('UPDATE fakemon SET thumb = ? WHERE pack_hash = ? AND entry_id = ?');
  const stmts = [];
  for (const id of ids) {
    const b64 = str(thumbs[id], MAX_LEN);
    const eid = str(id, 160);
    if (!b64 || !eid) continue;
    stmts.push(upd.bind(b64, body.hash, eid));
  }
  if (!stmts.length) return bad('No valid thumbs.');

  try {
    await db.batch(stmts);
  } catch (e) {
    return bad('Database error: ' + e.message, 500);
  }
  return json({ status: 'ok', updated: stmts.length });
}
