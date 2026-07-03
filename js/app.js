/* app.js — drag/drop, rendering, filtering, and the detail drawer. */
(function () {
  'use strict';

  const { typeColor, STAT_LABELS, CATEGORY, prettify, cap, pokemondbSlug } = window.DexConst;
  const BASE_MOVES = window.BASE_MOVES || {};
  const BASE_ABILITIES = window.BASE_ABILITIES || {};
  const $ = function (id) { return document.getElementById(id); };

  const el = {
    dropView: $('dropView'),
    loadingView: $('loadingView'),
    loadingMsg: $('loadingMsg'),
    dexView: $('dexView'),
    dexMeta: $('dexMeta'),
    grid: $('grid'),
    emptyMsg: $('emptyMsg'),
    dropzone: $('dropzone'),
    fileInput: $('fileInput'),
    search: $('search'),
    typeFilter: $('typeFilter'),
    sourceFilter: $('sourceFilter'),
    addPackBtn: $('addPackBtn'),
    backBtn: $('backBtn'),
    topbarActions: $('topbarActions'),
    sharedBtn: $('sharedBtn'),
    sharedModal: $('sharedModal'),
    sharedBackdrop: $('sharedBackdrop'),
    sharedClose: $('sharedClose'),
    sharedSearch: $('sharedSearch'),
    sharedType: $('sharedType'),
    sharedResults: $('sharedResults'),
    sharedStats: $('sharedStats'),
    drawer: $('drawer'),
    drawerPanel: $('drawerPanel'),
    drawerBackdrop: $('drawerBackdrop'),
    footStatus: $('footStatus'),
    tooltip: $('tooltip'),
    mrForm: $('mrForm'),
    mrUrl: $('mrUrl'),
    mrFetch: $('mrFetch'),
    mrError: $('mrError'),
    mrPanel: $('mrPanel'),
    mrIcon: $('mrIcon'),
    mrTitle: $('mrTitle'),
    mrVersion: $('mrVersion'),
    mrLoad: $('mrLoad'),
    mrProgress: $('mrProgress'),
    mrBar: $('mrBar'),
    mrPct: $('mrPct'),
  };

  let state = {
    entries: [], byId: {}, filtered: [],
    customMoves: {}, customAbilities: {},
    sprites: { models: {}, textures: {}, poses: {}, byId: {} },
    sources: [], // [{ name, count }] in load order
    sourceFilter: '',
    publishable: {}, // sourceName -> { payload, status }
    sharedAvailable: false,
  };

  const BASE_SOURCE = 'Cobblemon';

  function slugSource(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pack';
  }

  // ---- sprite rendering (lazy, one at a time on a shared WebGL context) -----

  const spriteCache = {};     // id -> dataURL | 'failed'
  const spriteQueue = [];
  let spriteBusy = false;

  function hasSprite(id) {
    return !!(window.Sprite && window.THREE && state.sprites.byId[id]);
  }

  function spriteSrc(id) {
    const v = spriteCache[id];
    return v && v !== 'failed' ? v : '';
  }

  async function renderSprite(id) {
    const spec = state.sprites.byId[id];
    if (!spec) return null;
    const model = state.sprites.models[spec.modelRef];
    if (!model) return null;
    const textures = spec.texturePaths
      .map(function (p) { return state.sprites.textures[p]; })
      .filter(Boolean);
    if (!textures.length) return null;
    const pose = (state.sprites.poses && state.sprites.poses[spec.modelRef]) || null;
    return window.Sprite.render({ model: model, textures: textures, pose: pose });
  }

  let baseAssetsState = 'idle'; // idle | loading | ready | failed

  async function loadBaseAssets() {
    if (baseAssetsState !== 'idle' || !window.BaseAssets) return;
    baseAssetsState = 'loading';
    try {
      const pack = await window.BaseAssets.loadBase();
      Object.assign(state.sprites.models, pack.models);
      Object.assign(state.sprites.textures, pack.textures);
      baseAssetsState = 'ready';
      checkVisibleSprites(); // render whatever's on screen now that models exist
    } catch (e) {
      console.warn('base assets failed', e);
      baseAssetsState = 'failed';
    }
  }

  function enqueueSprite(id) {
    if (spriteCache[id] || !hasSprite(id)) return;
    const spec = state.sprites.byId[id];
    if (spec && !state.sprites.models[spec.modelRef]) {
      // Model lives in the base bundle — fetch it (once), then this will retry.
      loadBaseAssets();
      return;
    }
    spriteCache[id] = 'pending';
    spriteQueue.push(id);
    pumpSpriteQueue();
  }

  async function pumpSpriteQueue() {
    if (spriteBusy) return;
    spriteBusy = true;
    while (spriteQueue.length) {
      const id = spriteQueue.shift();
      let url = null;
      try { url = await renderSprite(id); } catch (e) { console.warn('sprite failed', id, e); }
      spriteCache[id] = url || 'failed';
      if (url) {
        const imgs = document.querySelectorAll('img[data-sprite-id="' + cssEsc(id) + '"]');
        imgs.forEach(function (img) { img.src = url; img.classList.add('loaded'); });
      }
      // Yield so the UI stays responsive between renders.
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    spriteBusy = false;
  }

  function cssEsc(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // Enqueue sprites for cards currently near the viewport. A manual check rather
  // than IntersectionObserver so it works even when the tab hasn't painted.
  function checkVisibleSprites() {
    const grid = el.grid;
    if (!grid || el.dexView.hidden) return;
    const vh = window.innerHeight || 800;
    const cards = grid.children;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const id = card.dataset && card.dataset.id;
      if (!id || spriteCache[id] || !hasSprite(id)) continue;
      const r = card.getBoundingClientRect();
      if (r.bottom > -300 && r.top < vh + 300) enqueueSprite(id);
    }
  }

  let spriteCheckScheduled = false;
  function scheduleSpriteCheck() {
    if (spriteCheckScheduled) return;
    spriteCheckScheduled = true;
    requestAnimationFrame(function () { spriteCheckScheduled = false; checkVisibleSprites(); });
  }

  // ---- move / ability resolution -----------------------------------------
  // Merge order: pack-defined data > bundled base (Showdown) data > prettified id.

  function resolveMove(id) {
    const c = state.customMoves[id];
    const b = BASE_MOVES[id];
    // Prefer the pack's own values (what this pack actually uses in-game),
    // falling back to bundled Showdown data for standard moves.
    const src = (c && c.n) ? c : (b || null);
    if (!src) return { id: id, name: prettify(id), custom: true, standard: false };
    return {
      id: id,
      name: src.n || prettify(id),
      type: src.t || null,
      category: src.c || null,
      power: src.p || 0,
      accuracy: src.a,
      pp: src.pp || 0,
      desc: src.d || '',
      standard: !!b,          // in base dex => has a PokémonDB page (linkable)
      custom: !b && !!(c && c.n), // only tag as "custom" when truly pack-original
    };
  }

  function resolveAbility(id) {
    const b = BASE_ABILITIES[id];
    const customDesc = state.customAbilities[id];
    return {
      id: id,
      name: (b && b.n) || prettify(id),
      desc: customDesc || (b && b.d) || '',
    };
  }

  // ---- helpers ------------------------------------------------------------

  function show(view) {
    el.dropView.hidden = view !== 'drop';
    el.loadingView.hidden = view !== 'loading';
    el.dexView.hidden = view !== 'dex';
    el.topbarActions.hidden = view !== 'dex';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function typeBadge(t) {
    if (!t) return '';
    return '<span class="type" style="background:' + typeColor(t) + '">' + esc(cap(t)) + '</span>';
  }

  function typeBadges(e) {
    return typeBadge(e.primaryType) + (e.secondaryType ? typeBadge(e.secondaryType) : '');
  }

  // ---- card grid ----------------------------------------------------------

  function cardHTML(e) {
    const num = e.dexNumber != null ? '#' + String(e.dexNumber).padStart(3, '0') : '—';
    const grad = 'linear-gradient(135deg,' + typeColor(e.primaryType) + '33,' +
      typeColor(e.secondaryType || e.primaryType) + '22)';
    const tag = e.kind !== 'species'
      ? '<span class="card-kind">' + esc(e.formName || cap(e.kind)) + '</span>' : '';
    let art;
    if (hasSprite(e.id)) {
      const src = spriteSrc(e.id);
      art = '<div class="card-art"><img class="card-sprite' + (src ? ' loaded' : '') +
        '" data-sprite-id="' + esc(e.id) + '"' + (src ? ' src="' + src + '"' : '') +
        ' alt="" loading="lazy"></div>';
    } else {
      art = '<div class="card-art card-art-empty">◓</div>';
    }
    return (
      '<button class="card" data-id="' + esc(e.id) + '" style="--grad:' + grad + '">' +
        '<div class="card-top"><span class="dexno">' + num + '</span>' + tag + '</div>' +
        art +
        '<div class="card-name">' + esc(e.name) + '</div>' +
        '<div class="card-types">' + typeBadges(e) + '</div>' +
        '<div class="card-bst">BST <b>' + e.statTotal + '</b>' +
          (e.source && e.source !== BASE_SOURCE ? '<span class="card-src">' + esc(e.source) + '</span>' : '') +
        '</div>' +
      '</button>'
    );
  }

  function renderGrid() {
    const list = state.filtered;
    el.grid.innerHTML = list.map(cardHTML).join('');
    el.emptyMsg.hidden = list.length !== 0;
    checkVisibleSprites(); // synchronous (getBoundingClientRect forces layout)
  }

  // ---- filtering ----------------------------------------------------------

  function applyFilters() {
    const q = el.search.value.trim().toLowerCase();
    const type = el.typeFilter.value;
    const source = state.sourceFilter || '';
    state.filtered = state.entries.filter(function (e) {
      if (source && e.source !== source) return false;
      if (type && e.primaryType !== type && e.secondaryType !== type) return false;
      if (!q) return true;
      if (e.name.toLowerCase().includes(q)) return true;
      if ((e.primaryType || '').includes(q) || (e.secondaryType || '').includes(q)) return true;
      if (e.eggGroups.some(function (g) { return g.toLowerCase().includes(q); })) return true;
      if (e.abilities.some(function (a) { return a.name.toLowerCase().includes(q); })) return true;
      return false;
    });
    renderGrid();
    updateDexMeta();
    el.footStatus.textContent = state.filtered.length + ' / ' + state.entries.length + ' shown';
  }

  // ---- detail drawer ------------------------------------------------------

  function statRow(key, val) {
    const pct = Math.min(100, (val / 200) * 100);
    let cls = 'lo';
    if (val >= 120) cls = 'hi'; else if (val >= 80) cls = 'mid';
    return (
      '<div class="stat-row">' +
        '<span class="stat-label">' + STAT_LABELS[key] + '</span>' +
        '<span class="stat-val">' + val + '</span>' +
        '<span class="stat-bar"><i class="' + cls + '" style="width:' + pct + '%"></i></span>' +
      '</div>'
    );
  }

  function moveRow(entry, level) {
    const mv = resolveMove(entry.move);
    const cat = mv.category ? CATEGORY[mv.category] : null;
    const catBadge = cat
      ? '<span class="mv-cat" style="background:' + cat.color + '" title="' + esc(mv.category) + '">' + cat.abbr + '</span>'
      : '<span class="mv-cat none">—</span>';
    const typeBadgeEl = mv.type
      ? '<span class="type mv-type" style="background:' + typeColor(mv.type) + '">' + esc(cap(mv.type)) + '</span>'
      : '<span class="mv-type none"></span>';
    // Always emit the level cell (empty when N/A) so grid columns stay aligned
    // across level-up and TM/tutor/egg lists.
    const lvl = level != null
      ? '<span class="mv-lvl">Lv ' + level + '</span>'
      : '<span class="mv-lvl"></span>';

    // tooltip fields
    const metaParts = [];
    if (mv.category) metaParts.push(mv.category);
    if (mv.type) metaParts.push(cap(mv.type));
    if (mv.power) metaParts.push(mv.power + ' BP');
    metaParts.push((mv.accuracy ? mv.accuracy + '%' : '—') + ' acc');
    if (mv.pp) metaParts.push(mv.pp + ' PP');
    const tipMeta = metaParts.join('  ·  ');
    const tipDesc = mv.desc || '';

    const stats = (mv.power ? mv.power : '—') + ' <span class="mv-sep">/</span> ' +
      (mv.accuracy ? mv.accuracy + '%' : '—');

    const attrs =
      ' data-tip-name="' + esc(mv.name) + '"' +
      ' data-tip-meta="' + esc(tipMeta) + '"' +
      ' data-tip-desc="' + esc(tipDesc) + '"';

    const inner =
      lvl + catBadge + typeBadgeEl +
      '<span class="mv-name"><span class="mv-name-txt">' + esc(mv.name) + '</span>' +
        (mv.custom ? '<span class="mv-tag">custom</span>' : '') + '</span>' +
      '<span class="mv-stats">' + stats + '</span>';

    if (mv.standard) {
      return '<a class="move-row" target="_blank" rel="noopener" href="https://pokemondb.net/move/' +
        pokemondbSlug(mv.name) + '"' + attrs + '>' + inner + '<span class="mv-ext">↗</span></a>';
    }
    return '<div class="move-row nolink"' + attrs + '>' + inner + '</div>';
  }

  function movesSection(m) {
    const parts = [];
    if (m.level.length) {
      parts.push('<h4>Level-up</h4><div class="move-list">' +
        m.level.map(function (x) { return moveRow(x, x.level); }).join('') + '</div>');
    }
    const groups = [['tm', 'TM / TR'], ['tutor', 'Tutor'], ['egg', 'Egg'], ['legacy', 'Legacy'], ['other', 'Other']];
    for (const [key, label] of groups) {
      if (m[key] && m[key].length) {
        parts.push('<h4>' + label + '</h4><div class="move-list">' +
          m[key].map(function (x) { return moveRow(x, null); }).join('') + '</div>');
      }
    }
    return parts.join('') || '<p class="muted">No moves listed.</p>';
  }

  function abilityHTML(a) {
    const info = resolveAbility(a.name);
    const attrs =
      ' data-tip-name="' + esc(info.name) + '"' +
      ' data-tip-meta="' + (a.hidden ? 'Hidden ability' : 'Ability') + '"' +
      ' data-tip-desc="' + esc(info.desc) + '"';
    return '<span class="ability' + (a.hidden ? ' hidden-ability' : '') + '"' + attrs + '>' +
      esc(info.name) + (a.hidden ? '<em>hidden</em>' : '') + '</span>';
  }

  function metaRow(label, val) {
    if (val == null || val === '') return '';
    return '<div class="kv"><span>' + label + '</span><b>' + esc(val) + '</b></div>';
  }

  function genderText(ratio) {
    if (ratio == null) return null;
    if (ratio < 0) return 'Genderless';
    const female = Math.round(ratio * 100);
    return (100 - female) + '% ♂ / ' + female + '% ♀';
  }

  function drawerHTML(e) {
    const num = e.dexNumber != null ? '#' + String(e.dexNumber).padStart(3, '0') : '';
    const artSrc = spriteSrc(e.id);
    const art = hasSprite(e.id)
      ? '<img class="d-sprite' + (artSrc ? ' loaded' : '') + '" data-sprite-id="' + esc(e.id) + '"' +
        (artSrc ? ' src="' + artSrc + '"' : '') + ' alt="">'
      : '';
    const header =
      '<div class="d-head" style="background:linear-gradient(135deg,' +
        typeColor(e.primaryType) + ',' + typeColor(e.secondaryType || e.primaryType) + ')">' +
        '<button class="d-close" id="drawerClose" aria-label="Close">✕</button>' +
        art +
        '<div class="d-dexno">' + num + '</div>' +
        '<div class="d-name">' + esc(e.name) + '</div>' +
        '<div class="d-types">' + typeBadges(e) + '</div>' +
      '</div>';

    const desc = e.description
      ? '<p class="d-desc">' + esc(e.description) + '</p>' : '';

    const abilities = '<div class="d-block"><h3>Abilities</h3><div class="abilities">' +
      (e.abilities.length ? e.abilities.map(abilityHTML).join('') : '<span class="muted">—</span>') +
      '</div></div>';

    const eggs = '<div class="d-block"><h3>Egg groups</h3><div class="tags">' +
      (e.eggGroups.length ? e.eggGroups.map(function (g) {
        return '<span class="tag">' + esc(prettify(g)) + '</span>';
      }).join('') : '<span class="muted">—</span>') + '</div></div>';

    const stats = '<div class="d-block"><h3>Base stats <span class="bst">BST ' + e.statTotal + '</span></h3>' +
      window.CobblemonParser.STAT_KEYS.map(function (k) {
        return statRow(k, e.baseStats[k]);
      }).join('') + '</div>';

    const meta = '<div class="d-block"><h3>Details</h3><div class="kvs">' +
      metaRow('Catch rate', e.catchRate) +
      metaRow('EXP group', e.experienceGroup ? prettify(e.experienceGroup) : null) +
      metaRow('Egg cycles', e.eggCycles) +
      metaRow('Base friendship', e.baseFriendship) +
      metaRow('Gender', genderText(e.maleRatio)) +
      metaRow('Height', e.height != null ? e.height + ' m' : null) +
      metaRow('Weight', e.weight != null ? e.weight + ' kg' : null) +
      metaRow('Source', e.source) +
      metaRow('Labels', e.labels.join(', ')) +
      '</div></div>';

    const forms = e.forms && e.forms.length
      ? '<div class="d-block"><h3>Forms</h3><div class="tags">' +
        e.forms.map(function (f) { return '<span class="tag">' + esc(f) + '</span>'; }).join('') +
        '</div></div>'
      : '';

    const moves = '<div class="d-block"><h3>Moves</h3>' + movesSection(e.moves) + '</div>';

    return header + '<div class="d-body">' + desc + abilities + eggs + stats + meta + forms + moves + '</div>';
  }

  function openDrawer(id) {
    const e = state.byId[id];
    if (!e) return;
    el.drawerPanel.innerHTML = drawerHTML(e);
    el.drawer.hidden = false;
    document.body.style.overflow = 'hidden';
    el.drawerPanel.scrollTop = 0;
    const close = $('drawerClose');
    if (close) close.addEventListener('click', closeDrawer);
    // Prioritise the open mon's sprite if it isn't ready yet.
    if (hasSprite(id) && !spriteSrc(id)) {
      if (spriteCache[id] === 'pending') {
        const i = spriteQueue.indexOf(id);
        if (i > 0) { spriteQueue.splice(i, 1); spriteQueue.unshift(id); }
      } else {
        delete spriteCache[id];
        enqueueSprite(id);
      }
    }
  }

  function closeDrawer() {
    el.drawer.hidden = true;
    document.body.style.overflow = '';
  }

  // ---- load flow ----------------------------------------------------------

  // Add a dataset (base Cobblemon or a loaded pack) as a named source. Entry ids
  // are namespaced by source so multiple packs can coexist without collisions.
  function addSource(name, entries, sprites, warnings) {
    // Ensure a unique display name if the same pack is loaded twice.
    let display = name;
    let n = 2;
    while (state.sources.some(function (s) { return s.name === display; })) display = name + ' (' + n++ + ')';
    const slug = slugSource(display);

    for (const e of entries) {
      const oid = e.id;
      e.source = display;
      e._oid = oid;
      e.uid = slug + '::' + oid;
      e.id = e.uid; // used everywhere as the entry key
      state.byId[e.uid] = e;
    }
    if (sprites) {
      Object.assign(state.sprites.models, sprites.models || {});
      Object.assign(state.sprites.textures, sprites.textures || {});
      Object.assign(state.sprites.poses, sprites.poses || {});
      for (const oid in (sprites.byId || {})) {
        state.sprites.byId[slug + '::' + oid] = sprites.byId[oid];
      }
    }
    state.entries = state.entries.concat(entries);
    state.entries.sort(sortEntries);
    state.sources.push({ name: display, count: entries.length, warnings: (warnings || []).length });
    rebuildFilters();
    return display;
  }

  function sortEntries(a, b) {
    const an = a.dexNumber, bn = b.dexNumber;
    if (an != null && bn != null && an !== bn) return an - bn;
    if (an != null && bn == null) return -1;
    if (an == null && bn != null) return 1;
    return a.name.localeCompare(b.name);
  }

  function rebuildFilters() {
    const types = new Set();
    for (const e of state.entries) {
      if (e.primaryType) types.add(e.primaryType);
      if (e.secondaryType) types.add(e.secondaryType);
    }
    el.typeFilter.innerHTML = '<option value="">All types</option>' +
      Array.from(types).sort().map(function (t) {
        return '<option value="' + t + '">' + cap(t) + '</option>';
      }).join('');
    el.sourceFilter.innerHTML = '<option value="">All sources</option>' +
      state.sources.map(function (s) {
        return '<option value="' + esc(s.name) + '">' + esc(s.name) + ' (' + s.count + ')</option>';
      }).join('');
    el.sourceFilter.value = state.sourceFilter || '';
  }

  function publishBit(sourceName) {
    if (!window.SharedDex || !sourceName || sourceName === BASE_SOURCE) return '';
    const p = state.publishable[sourceName];
    if (!p) return '';
    if (p.status === 'ready') return ' · <button class="pub-btn" data-pub="' + esc(sourceName) + '">↥ Publish to shared dex</button>';
    if (p.status === 'publishing') return ' · <span class="pub-status">publishing…</span>';
    if (p.status === 'published') return ' · <span class="pub-status ok">✓ published to shared dex</span>';
    if (p.status === 'exists') return ' · <span class="pub-status ok">✓ already in shared dex</span>';
    if (p.status === 'error') return ' · <button class="pub-btn" data-pub="' + esc(sourceName) + '">retry publish</button>' +
      ' <span class="warn">' + esc(p.error || '') + '</span>';
    return '';
  }

  function updateDexMeta() {
    const shown = state.sourceFilter;
    if (shown) {
      const s = state.sources.find(function (x) { return x.name === shown; });
      el.dexMeta.innerHTML = '<strong>' + esc(shown) + '</strong> · ' + (s ? s.count : 0) + ' entries' +
        (s && s.warnings ? ' · <span class="warn">' + s.warnings + ' warnings</span>' : '') +
        publishBit(shown);
    } else {
      const packs = state.sources.length - 1;
      el.dexMeta.innerHTML = '<strong>' + state.entries.length + '</strong> entries across ' +
        state.sources.length + ' source' + (state.sources.length === 1 ? '' : 's') +
        (packs > 0 ? ' · ' + packs + ' pack' + (packs === 1 ? '' : 's') + ' loaded' : '');
    }
  }

  // Load a parsed pack: add it and focus its source so the user sees it.
  function loadResult(result, sourceName) {
    const name = addSource(sourceName || result.meta.fileName || 'pack',
      result.entries, result.sprites, result.warnings);
    // Merge custom move/ability data (later packs override — fine for display).
    Object.assign(state.customMoves, result.customMoves || {});
    Object.assign(state.customAbilities, result.customAbilities || {});
    state.sourceFilter = name;
    el.sourceFilter.value = name;
    show('dex');
    applyFilters();
    return name;
  }

  function cleanSourceName(name) {
    return String(name).replace(/\.(jar|zip)$/i, '').trim() || 'pack';
  }

  async function parseBuffer(buf, name, sourceName, opts) {
    opts = opts || {};
    show('loading');
    el.loadingMsg.textContent = 'Parsing species…';
    try {
      const result = await window.CobblemonParser.parseArchive(buf, name);
      if (!result.entries.length) {
        show('drop');
        alert('No Cobblemon species found in "' + name + '".\n' +
          'Make sure it contains data/<namespace>/species/…');
        return;
      }
      const loaded = loadResult(result, cleanSourceName(sourceName || name));
      preparePublish(buf, loaded, opts).catch(function (e) { console.warn('publish prep', e); });
    } catch (err) {
      console.error(err);
      show('drop');
      alert('Could not read "' + name + '": ' + err.message);
    }
  }

  async function handleFile(file) {
    if (!file) return;
    show('loading');
    el.loadingMsg.textContent = 'Reading ' + file.name + '…';
    try {
      const buf = await file.arrayBuffer();
      await parseBuffer(buf, file.name);
    } catch (err) {
      console.error(err);
      show('drop');
      alert('Could not read "' + file.name + '": ' + err.message);
    }
  }

  // ---- shared dex: browse --------------------------------------------------

  const ALL_TYPES = Object.keys(window.DexConst.TYPE_COLORS);
  let sharedTimer = null;
  let sharedLoaded = false;

  function openShared() {
    el.sharedModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (!sharedLoaded) {
      sharedLoaded = true;
      el.sharedType.innerHTML = '<option value="">All types</option>' +
        ALL_TYPES.map(function (t) { return '<option value="' + t + '">' + cap(t) + '</option>'; }).join('');
      window.SharedDex.listPacks().then(function (d) {
        const t = d.totals || {};
        el.sharedStats.textContent = (t.fakemon || 0) + ' fakemon across ' + (t.packs || 0) + ' published packs — search them all.';
      }).catch(function () {});
      doSharedSearch();
    }
    el.sharedSearch.focus();
  }

  function closeShared() {
    el.sharedModal.hidden = true;
    document.body.style.overflow = '';
  }

  function scheduleSharedSearch() {
    clearTimeout(sharedTimer);
    sharedTimer = setTimeout(doSharedSearch, 220);
  }

  async function doSharedSearch() {
    const q = el.sharedSearch.value.trim();
    const type = el.sharedType.value;
    el.sharedResults.innerHTML = '<p class="shared-msg">Searching…</p>';
    try {
      const data = await window.SharedDex.search(q, type, 100);
      renderShared(data.results || []);
    } catch (e) {
      el.sharedResults.innerHTML = '<p class="shared-msg err">' + esc(e.message) + '</p>';
    }
  }

  function sharedTypeBadge(t) {
    if (!t) return '';
    return '<span class="type" style="background:' + typeColor(t) + '">' + esc(cap(t)) + '</span>';
  }

  function renderShared(results) {
    if (!results.length) {
      el.sharedResults.innerHTML = '<p class="shared-msg">No matches yet. Load a pack from Modrinth to add to the shared dex.</p>';
      return;
    }
    el.sharedResults.innerHTML = results.map(function (r) {
      const num = r.dex_number != null ? '#' + String(r.dex_number).padStart(3, '0') : '';
      const pack = r.modrinth_slug
        ? '<a href="https://modrinth.com/mod/' + esc(r.modrinth_slug) + '" target="_blank" rel="noopener">' + esc(r.pack_name) + '</a>'
        : esc(r.pack_name);
      return '<div class="shared-row">' +
        '<span class="shared-dex">' + num + '</span>' +
        '<span class="shared-name">' + esc(r.name) + '</span>' +
        '<span class="shared-types">' + sharedTypeBadge(r.primary_type) + sharedTypeBadge(r.secondary_type) + '</span>' +
        '<span class="shared-bst">BST ' + (r.bst || '—') + '</span>' +
        '<span class="shared-pack">' + pack + '</span>' +
      '</div>';
    }).join('');
  }

  // ---- shared dex: publish -------------------------------------------------

  async function preparePublish(buf, sourceName, opts) {
    if (!window.SharedDex || !state.sharedAvailable || !sourceName || sourceName === BASE_SOURCE) return;
    const hash = await window.SharedDex.hashBuffer(buf);
    const entries = state.entries.filter(function (e) { return e.source === sourceName; });
    const payload = window.SharedDex.buildPayload(
      hash, sourceName, opts.source || 'file', entries,
      { modrinthSlug: opts.modrinthSlug || null, version: opts.version || null }
    );
    state.publishable[sourceName] = { payload: payload, status: 'ready' };
    if (opts.autoPublish) {
      publishNow(sourceName);
    } else {
      updateDexMeta();
    }
  }

  async function publishNow(sourceName) {
    const p = state.publishable[sourceName];
    if (!p || p.status === 'publishing' || p.status === 'published' || p.status === 'exists') return;
    p.status = 'publishing';
    updateDexMeta();
    try {
      const res = await window.SharedDex.publish(p.payload);
      p.status = res.status === 'exists' ? 'exists' : 'published';
    } catch (e) {
      p.status = 'error';
      p.error = e.message;
    }
    updateDexMeta();
  }

  // ---- Modrinth ------------------------------------------------------------

  let mrResolved = null;

  function fmtBytes(n) {
    if (!n) return '';
    if (n >= 1e6) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1e3) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function mrShowError(msg) {
    el.mrError.textContent = msg;
    el.mrError.hidden = !msg;
  }

  function versionLabel(v) {
    const bits = [v.number || v.name];
    if (v.gameVersions.length) bits.push(v.gameVersions.join(', '));
    if (v.file.size) bits.push(fmtBytes(v.file.size));
    return bits.join(' · ');
  }

  function updateLoadBtn() {
    const v = mrResolved && mrResolved.versions[el.mrVersion.selectedIndex];
    el.mrLoad.textContent = v && v.file.size ? 'Load (' + fmtBytes(v.file.size) + ')' : 'Load';
  }

  async function mrFetchProject() {
    const q = el.mrUrl.value.trim();
    if (!q) return;
    mrShowError('');
    el.mrPanel.hidden = true;
    el.mrFetch.disabled = true;
    el.mrFetch.textContent = 'Fetching…';
    try {
      const proj = await window.Modrinth.resolveProject(q);
      mrResolved = proj;
      if (proj.iconUrl) { el.mrIcon.src = proj.iconUrl; el.mrIcon.hidden = false; }
      else el.mrIcon.hidden = true;
      el.mrTitle.textContent = proj.title;
      el.mrTitle.href = 'https://modrinth.com/' + proj.projectType + '/' + proj.slug;
      el.mrVersion.innerHTML = proj.versions.map(function (v, i) {
        return '<option value="' + i + '">' + esc(versionLabel(v)) + '</option>';
      }).join('');
      el.mrVersion.selectedIndex = 0;
      updateLoadBtn();
      el.mrPanel.hidden = false;
    } catch (err) {
      mrShowError(err.message || 'Could not load that project.');
    } finally {
      el.mrFetch.disabled = false;
      el.mrFetch.textContent = 'Fetch';
    }
  }

  async function mrLoadVersion() {
    const v = mrResolved && mrResolved.versions[el.mrVersion.selectedIndex];
    if (!v) return;
    mrShowError('');
    el.mrLoad.disabled = true;
    el.mrVersion.disabled = true;
    el.mrProgress.hidden = false;
    el.mrBar.style.width = '0%';
    el.mrPct.textContent = '0%';
    try {
      const buf = await window.Modrinth.downloadFile(v.file.url, function (p) {
        const pct = Math.round(p * 100);
        el.mrBar.style.width = pct + '%';
        el.mrPct.textContent = pct + '%';
      });
      const srcName = mrResolved ? mrResolved.title + ' ' + v.number : v.file.filename;
      await parseBuffer(buf, v.file.filename, srcName, {
        source: 'modrinth',
        modrinthSlug: mrResolved ? mrResolved.slug : null,
        version: v.number,
        autoPublish: true, // Modrinth packs are already public
      });
    } catch (err) {
      console.error(err);
      show('drop');
      mrShowError(err.message || 'Download failed.');
    } finally {
      el.mrLoad.disabled = false;
      el.mrVersion.disabled = false;
      el.mrProgress.hidden = true;
    }
  }

  // ---- events -------------------------------------------------------------

  el.mrForm.addEventListener('submit', function (e) { e.preventDefault(); mrFetchProject(); });
  el.mrVersion.addEventListener('change', updateLoadBtn);
  el.mrLoad.addEventListener('click', mrLoadVersion);

  ['dragenter', 'dragover'].forEach(function (ev) {
    el.dropzone.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      el.dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    el.dropzone.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      el.dropzone.classList.remove('drag');
    });
  });
  el.dropzone.addEventListener('drop', function (e) {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(f);
  });
  // Also accept drops anywhere on the page once loaded.
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    if (!el.dexView.hidden || !el.dropView.hidden) {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    }
  });

  el.fileInput.addEventListener('change', function (e) {
    handleFile(e.target.files && e.target.files[0]);
  });

  window.addEventListener('scroll', scheduleSpriteCheck, { passive: true });
  window.addEventListener('resize', scheduleSpriteCheck, { passive: true });

  el.search.addEventListener('input', applyFilters);
  el.typeFilter.addEventListener('change', applyFilters);
  el.sourceFilter.addEventListener('change', function () {
    state.sourceFilter = el.sourceFilter.value;
    applyFilters();
  });
  el.addPackBtn.addEventListener('click', function () {
    el.fileInput.value = '';
    el.mrPanel.hidden = true;
    el.mrProgress.hidden = true;
    mrShowError('');
    el.backBtn.hidden = state.entries.length === 0;
    show('drop');
  });
  el.backBtn.addEventListener('click', function () { show('dex'); });
  el.sharedBtn.addEventListener('click', openShared);
  el.sharedClose.addEventListener('click', closeShared);
  el.sharedBackdrop.addEventListener('click', closeShared);
  el.sharedSearch.addEventListener('input', scheduleSharedSearch);
  el.sharedType.addEventListener('change', doSharedSearch);

  el.grid.addEventListener('click', function (e) {
    const card = e.target.closest('.card');
    if (card) openDrawer(card.dataset.id);
  });
  el.dexMeta.addEventListener('click', function (e) {
    const btn = e.target.closest('.pub-btn');
    if (btn) publishNow(btn.dataset.pub);
  });
  el.drawerBackdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!el.drawer.hidden) closeDrawer();
    else if (!el.sharedModal.hidden) closeShared();
  });

  // ---- tooltips (moves + abilities) ---------------------------------------

  function fillTip(target) {
    const t = el.tooltip;
    t.textContent = '';
    const name = document.createElement('div');
    name.className = 'tip-name';
    name.textContent = target.dataset.tipName || '';
    t.appendChild(name);
    if (target.dataset.tipMeta) {
      const meta = document.createElement('div');
      meta.className = 'tip-meta';
      meta.textContent = target.dataset.tipMeta;
      t.appendChild(meta);
    }
    if (target.dataset.tipDesc) {
      const desc = document.createElement('div');
      desc.className = 'tip-desc';
      desc.textContent = target.dataset.tipDesc;
      t.appendChild(desc);
    }
    t.hidden = false;
  }

  function positionTip(x, y) {
    const t = el.tooltip;
    const r = t.getBoundingClientRect();
    let left = x + 14;
    let top = y + 16;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 12;
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, top) + 'px';
  }

  document.addEventListener('mouseover', function (e) {
    const target = e.target.closest('[data-tip-name]');
    if (!target) return;
    fillTip(target);
    positionTip(e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', function (e) {
    if (!el.tooltip.hidden) positionTip(e.clientX, e.clientY);
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('[data-tip-name]')) el.tooltip.hidden = true;
  });

  // ---- init: show the base Cobblemon dex by default -----------------------

  // Is the shared-dex backend reachable? (Only then reveal its UI + publishing.)
  function checkShared() {
    if (!window.SharedDex) return;
    window.SharedDex.listPacks().then(function () {
      state.sharedAvailable = true;
      el.sharedBtn.hidden = false;
    }).catch(function () { state.sharedAvailable = false; });
  }

  function init() {
    checkShared();
    const base = window.BASE_COBBLEMON;
    if (base && base.entries && base.entries.length) {
      // Clone entries so addSource can namespace ids without mutating the bundle
      // (matters if the page re-inits).
      const entries = base.entries.map(function (e) { return Object.assign({}, e); });
      const baseSprites = window.BASE_SPRITES
        ? { models: {}, textures: {}, poses: window.BASE_SPRITES.poses || {}, byId: window.BASE_SPRITES.byId }
        : null;
      addSource(BASE_SOURCE, entries, baseSprites, null);
      state.sourceFilter = '';
      el.sourceFilter.value = '';
      show('dex');
      applyFilters();
    } else {
      show('drop'); // no base bundled — fall back to the landing screen
    }
  }

  init();
})();
