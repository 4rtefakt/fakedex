/*
 * sharedb.js — talk to the Fakédex shared database (Cloudflare D1 via Pages
 * Functions at /api/*). Same-origin, so no CORS handling needed.
 *
 * Packs are identified by a SHA-256 of their file bytes, so the same version is
 * only ever stored once server-side.
 */
(function (global) {
  'use strict';

  async function hashBuffer(arrayBuffer) {
    const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }

  // Compact per-entry payload for the shared index (no sprites, no movesets).
  function buildPayload(hash, name, source, entries, extra) {
    const list = entries.map(function (e) {
      return {
        id: e._oid || e.id,
        name: e.name,
        dexNumber: e.dexNumber,
        primaryType: e.primaryType,
        secondaryType: e.secondaryType,
        statTotal: e.statTotal,
        kind: e.kind,
        abilities: (e.abilities || []).map(function (a) { return a.name; }),
        eggGroups: e.eggGroups || [],
      };
    });
    return Object.assign({ hash: hash, name: name, source: source, entries: list }, extra || {});
  }

  async function publish(payload) {
    const r = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      let msg = 'Publish failed (' + r.status + ').';
      try { const j = await r.json(); if (j.error) msg = j.error; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    return r.json(); // { status: 'published' | 'exists', ... }
  }

  async function search(q, type, limit) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    if (limit) params.set('limit', String(limit));
    const r = await fetch('/api/search?' + params.toString());
    if (!r.ok) throw new Error('Search failed (' + r.status + ').');
    return r.json(); // { results: [...] }
  }

  async function listPacks() {
    const r = await fetch('/api/packs');
    if (!r.ok) throw new Error('Failed to load packs (' + r.status + ').');
    return r.json(); // { packs, totals }
  }

  global.SharedDex = {
    hashBuffer: hashBuffer,
    buildPayload: buildPayload,
    publish: publish,
    search: search,
    listPacks: listPacks,
  };
})(window);
