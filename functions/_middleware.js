// Inject per-mon social-preview meta for ?mon= links so Fakédex links unfurl
// nicely (Discord/Twitter/etc. crawlers don't run JS, so we render meta here).
import { BASE_OG } from './_base-og.js';

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const mon = url.searchParams.get('mon');
  if (!mon) return next();
  if (!(request.headers.get('accept') || '').includes('text/html')) return next();

  const res = await next();
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;

  const meta = await buildMeta(mon, url.searchParams.get('pack'), env, url.origin);
  if (!meta) return res;

  const html = inject(await res.text(), meta);
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(html, { status: res.status, headers: headers });
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function buildMeta(mon, pack, env, origin) {
  const key = String(mon).toLowerCase().replace(/[^a-z0-9]/g, '');
  let info = null;
  let image = null;

  if (pack && env && env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT f.name, f.primary_type, f.secondary_type, f.bst, f.dex_number, ' +
        'CASE WHEN f.thumb IS NOT NULL THEN 1 ELSE 0 END AS has_thumb FROM fakemon f ' +
        'JOIN packs p ON p.hash = f.pack_hash ' +
        'WHERE p.modrinth_slug = ? AND (f.entry_id = ? OR f.name_lower = ?) LIMIT 1'
      ).bind(pack, mon, key).first();
      if (row) {
        info = { n: row.name, t: [row.primary_type, row.secondary_type].filter(Boolean), b: row.bst, x: row.dex_number };
        if (row.has_thumb) {
          image = (origin || '') + '/api/thumb?pack=' + encodeURIComponent(pack) + '&mon=' + encodeURIComponent(mon);
        }
      }
    } catch (e) { /* fall through to base */ }
  }
  if (!info) {
    info = BASE_OG[key] || BASE_OG[mon];
    if (!info) {
      for (const id in BASE_OG) {
        if (id.replace(/[^a-z0-9]/g, '') === key) { info = BASE_OG[id]; break; }
      }
    }
    // Base mons get their preview from a thumbnail seeded into base_thumbs.
    if (info && !image && env && env.DB) {
      try {
        const has = await env.DB.prepare('SELECT 1 FROM base_thumbs WHERE norm = ? LIMIT 1').bind(key).first();
        if (has) image = (origin || '') + '/api/thumb?mon=' + encodeURIComponent(mon);
      } catch (e) { /* table may not exist yet — skip image */ }
    }
  }
  if (!info) return null;

  const types = (info.t || []).map(cap).join('/');
  const dex = info.x ? '#' + String(info.x).padStart(3, '0') + ' · ' : '';
  const bits = [dex + (types || ''), info.b ? 'BST ' + info.b : ''].filter(Boolean).join(' · ');
  const desc = bits + (pack ? ' · from ' + pack : '') + ' — on Fakédex';
  return { name: info.n, title: info.n + ' — Fakédex', desc: desc, image: image };
}

function inject(html, m) {
  let tags =
    '<title>' + esc(m.title) + '</title>' +
    '<meta name="description" content="' + esc(m.desc) + '">' +
    '<meta property="og:title" content="' + esc(m.name) + '">' +
    '<meta property="og:description" content="' + esc(m.desc) + '">';
  if (m.image) {
    tags +=
      '<meta property="og:image" content="' + esc(m.image) + '">' +
      '<meta property="og:image:alt" content="' + esc(m.name) + '">' +
      '<meta name="twitter:image" content="' + esc(m.image) + '">';
  }
  return html
    .replace(/<title>[^<]*<\/title>/, '')
    .replace(/<meta name="description"[^>]*>/, '')
    .replace(/<meta property="og:title"[^>]*>/, '')
    .replace(/<meta property="og:description"[^>]*>/, '')
    .replace('</head>', tags + '</head>');
}
