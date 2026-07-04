/*
 * modrinth.js — talk to the Modrinth API directly from the browser.
 *
 * Both api.modrinth.com and cdn.modrinth.com send `Access-Control-Allow-Origin: *`,
 * so no server-side proxy is needed — we resolve a project, list its versions and
 * stream the chosen file entirely client-side, then hand the bytes to the parser.
 */
(function (global) {
  'use strict';

  const API = 'https://api.modrinth.com/v2';

  // Accept a full Modrinth URL or a bare slug and return the project slug.
  function parseSlug(input) {
    if (!input) return null;
    input = input.trim();
    const m = input.match(
      /modrinth\.com\/(?:mod|datapack|resourcepack|plugin|shader|modpack|project)\/([^/?#]+)/i
    );
    if (m) return decodeURIComponent(m[1]);
    if (!input.includes('/') && !input.includes(' ')) return input; // bare slug
    try {
      const parts = new URL(input).pathname.split('/').filter(Boolean);
      if (parts.length) return decodeURIComponent(parts[parts.length - 1]);
    } catch (e) { /* not a URL */ }
    return input;
  }

  async function getJSON(url) {
    let r;
    try {
      r = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (e) {
      throw new Error('Network error reaching Modrinth.');
    }
    if (r.status === 404) throw new Error('Project not found on Modrinth.');
    if (r.status === 429) throw new Error('Rate limited by Modrinth — try again in a moment.');
    if (!r.ok) throw new Error('Modrinth API error (' + r.status + ').');
    return r.json();
  }

  function pickFile(version) {
    const files = version.files || [];
    return (
      files.find(function (f) { return f.primary; }) ||
      files.find(function (f) { return /\.(jar|zip)$/i.test(f.filename); }) ||
      files[0] ||
      null
    );
  }

  // All formats of one release (fabric jar, neoforge jar, datapack zip…) carry
  // the same species data, so the user only needs to pick a release, not a
  // format. Group by version number + game versions, and auto-pick the smallest
  // downloadable format (datapacks are smallest and parse identically).
  function baseNumber(v) {
    return (String(v.number || '').split('+')[0].trim()) || v.number || v.name || '?';
  }

  function groupReleases(raw) {
    const map = {};
    const order = [];
    for (const v of raw) {
      const key = baseNumber(v) + '|' + v.gameVersions.slice().sort().join(',');
      if (!map[key]) {
        map[key] = { key: key, number: baseNumber(v), name: v.name,
          gameVersions: v.gameVersions, date: v.date, options: [] };
        order.push(key);
      }
      const g = map[key];
      g.options.push({ loaders: v.loaders, file: v.file });
      if (v.date > g.date) g.date = v.date;
    }
    return order.map(function (k) {
      const g = map[k];
      const opts = g.options.slice().sort(function (a, b) {
        const ad = a.loaders.indexOf('datapack') !== -1 ? 0 : 1;
        const bd = b.loaders.indexOf('datapack') !== -1 ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return (a.file.size || 0) - (b.file.size || 0);
      });
      const chosen = opts[0];
      return {
        key: g.key, number: g.number, name: g.name,
        gameVersions: g.gameVersions, date: g.date,
        loaders: chosen.loaders, file: chosen.file,
        formatCount: g.options.length,
      };
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }

  // Resolve a project to { slug, title, iconUrl, projectType, versions[] }.
  async function resolveProject(input) {
    const slug = parseSlug(input);
    if (!slug) throw new Error('Enter a Modrinth URL or slug.');
    const [proj, versions] = await Promise.all([
      getJSON(API + '/project/' + encodeURIComponent(slug)),
      getJSON(API + '/project/' + encodeURIComponent(slug) + '/version'),
    ]);
    const raw = versions
      .map(function (v) {
        const file = pickFile(v);
        if (!file) return null;
        return {
          id: v.id,
          name: v.name,
          number: v.version_number,
          gameVersions: v.game_versions || [],
          loaders: v.loaders || [],
          date: v.date_published,
          file: { filename: file.filename, size: file.size || 0, url: file.url },
        };
      })
      .filter(Boolean);
    if (!raw.length) throw new Error('No downloadable files found for this project.');
    return {
      slug: proj.slug,
      title: proj.title,
      iconUrl: proj.icon_url || null,
      projectType: proj.project_type,
      versions: groupReleases(raw),
    };
  }

  // Download a file with progress (0..1). Returns an ArrayBuffer.
  async function downloadFile(url, onProgress) {
    let r;
    try {
      r = await fetch(url);
    } catch (e) {
      throw new Error('Network error downloading the file.');
    }
    if (!r.ok) throw new Error('Download failed (' + r.status + ').');
    const total = Number(r.headers.get('content-length')) || 0;
    if (!r.body || !total) {
      const buf = await r.arrayBuffer();
      if (onProgress) onProgress(1);
      return buf;
    }
    const reader = r.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      received += step.value.length;
      if (onProgress) onProgress(received / total);
    }
    const out = new Uint8Array(received);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out.buffer;
  }

  // Lightweight project lookup (icon/title) for the pack gallery.
  const _metaCache = {};
  async function projectMeta(slug) {
    if (_metaCache[slug]) return _metaCache[slug];
    try {
      const p = await getJSON(API + '/project/' + encodeURIComponent(slug));
      const meta = { title: p.title, iconUrl: p.icon_url || null, slug: p.slug };
      _metaCache[slug] = meta;
      return meta;
    } catch (e) { return null; }
  }

  global.Modrinth = {
    parseSlug: parseSlug, resolveProject: resolveProject,
    downloadFile: downloadFile, projectMeta: projectMeta,
  };
})(window);
