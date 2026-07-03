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

  // Resolve a project to { slug, title, iconUrl, projectType, versions[] }.
  async function resolveProject(input) {
    const slug = parseSlug(input);
    if (!slug) throw new Error('Enter a Modrinth URL or slug.');
    const [proj, versions] = await Promise.all([
      getJSON(API + '/project/' + encodeURIComponent(slug)),
      getJSON(API + '/project/' + encodeURIComponent(slug) + '/version'),
    ]);
    const vs = versions
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
      .filter(Boolean)
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    if (!vs.length) throw new Error('No downloadable files found for this project.');
    return {
      slug: proj.slug,
      title: proj.title,
      iconUrl: proj.icon_url || null,
      projectType: proj.project_type,
      versions: vs,
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

  global.Modrinth = { parseSlug: parseSlug, resolveProject: resolveProject, downloadFile: downloadFile };
})(window);
