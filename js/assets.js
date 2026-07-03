/*
 * assets.js — fetch the base Cobblemon sprite bundle (models + textures) once,
 * cache it via the Cache API, and expose it as { models, textures } maps that
 * plug straight into the sprite renderer's pools.
 *
 * The bundle is small (~3–4 MB) and covers every base model, so it also supplies
 * models for texture-only variant packs that reuse them.
 */
(function (global) {
  'use strict';

  const BUNDLE_URL = 'assets/cobblemon-base.zip';
  const CACHE_NAME = 'fakedex-assets-v1';

  function unzip(arrayBuffer) {
    return new Promise(function (resolve, reject) {
      fflate.unzip(new Uint8Array(arrayBuffer), function (err, files) {
        if (err) reject(err); else resolve(files);
      });
    });
  }

  async function fetchBundle() {
    let resp;
    if (global.caches) {
      try {
        const cache = await caches.open(CACHE_NAME);
        resp = await cache.match(BUNDLE_URL);
        if (!resp) {
          resp = await fetch(BUNDLE_URL);
          if (resp.ok) await cache.put(BUNDLE_URL, resp.clone());
        }
      } catch (e) { resp = null; }
    }
    if (!resp) resp = await fetch(BUNDLE_URL);
    if (!resp.ok) throw new Error('Base assets unavailable (' + resp.status + ').');
    return resp.arrayBuffer();
  }

  // Returns { models: { "ns:name.geo": geoJson }, textures: { path: Uint8Array } }.
  async function loadBase() {
    const buf = await fetchBundle();
    const files = await unzip(buf);
    const decoder = new TextDecoder('utf-8');
    const models = {};
    const textures = {};
    for (const path in files) {
      const m = path.match(/assets\/([^/]+)\/bedrock\/pokemon\/models\/(.+)\.json$/);
      if (m) {
        try { models[m[1] + ':' + m[2]] = JSON.parse(decoder.decode(files[path])); }
        catch (e) { /* skip */ }
      } else if (/\.png$/i.test(path)) {
        textures[path] = files[path];
      }
    }
    return { models: models, textures: textures };
  }

  global.BaseAssets = { loadBase: loadBase, BUNDLE_URL: BUNDLE_URL };
})(window);
