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
    resetBtn: $('resetBtn'),
    topbarActions: $('topbarActions'),
    drawer: $('drawer'),
    drawerPanel: $('drawerPanel'),
    drawerBackdrop: $('drawerBackdrop'),
    footStatus: $('footStatus'),
    tooltip: $('tooltip'),
  };

  let state = { entries: [], byId: {}, filtered: [], customMoves: {}, customAbilities: {} };

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
    return (
      '<button class="card" data-id="' + esc(e.id) + '" style="--grad:' + grad + '">' +
        '<div class="card-top"><span class="dexno">' + num + '</span>' + tag + '</div>' +
        '<div class="card-name">' + esc(e.name) + '</div>' +
        '<div class="card-types">' + typeBadges(e) + '</div>' +
        '<div class="card-bst">BST <b>' + e.statTotal + '</b></div>' +
      '</button>'
    );
  }

  function renderGrid() {
    const list = state.filtered;
    el.grid.innerHTML = list.map(cardHTML).join('');
    el.emptyMsg.hidden = list.length !== 0;
  }

  // ---- filtering ----------------------------------------------------------

  function applyFilters() {
    const q = el.search.value.trim().toLowerCase();
    const type = el.typeFilter.value;
    state.filtered = state.entries.filter(function (e) {
      if (type && e.primaryType !== type && e.secondaryType !== type) return false;
      if (!q) return true;
      if (e.name.toLowerCase().includes(q)) return true;
      if ((e.primaryType || '').includes(q) || (e.secondaryType || '').includes(q)) return true;
      if (e.eggGroups.some(function (g) { return g.toLowerCase().includes(q); })) return true;
      if (e.abilities.some(function (a) { return a.name.toLowerCase().includes(q); })) return true;
      return false;
    });
    renderGrid();
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
    const header =
      '<div class="d-head" style="background:linear-gradient(135deg,' +
        typeColor(e.primaryType) + ',' + typeColor(e.secondaryType || e.primaryType) + ')">' +
        '<button class="d-close" id="drawerClose" aria-label="Close">✕</button>' +
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
  }

  function closeDrawer() {
    el.drawer.hidden = true;
    document.body.style.overflow = '';
  }

  // ---- load flow ----------------------------------------------------------

  function loadResult(result) {
    state.entries = result.entries;
    state.customMoves = result.customMoves || {};
    state.customAbilities = result.customAbilities || {};
    state.byId = {};
    for (const e of result.entries) state.byId[e.id] = e;

    // Populate type filter from what's actually present.
    const types = new Set();
    for (const e of result.entries) {
      if (e.primaryType) types.add(e.primaryType);
      if (e.secondaryType) types.add(e.secondaryType);
    }
    el.typeFilter.innerHTML = '<option value="">All types</option>' +
      Array.from(types).sort().map(function (t) {
        return '<option value="' + t + '">' + cap(t) + '</option>';
      }).join('');

    const m = result.meta;
    const speciesCount = result.entries.filter(function (e) { return e.kind === 'species'; }).length;
    const formCount = result.entries.length - speciesCount;
    el.dexMeta.innerHTML =
      '<strong>' + esc(m.fileName || 'pack') + '</strong> · ' +
      speciesCount + ' species' +
      (formCount ? ' · ' + formCount + ' forms/variants' : '') +
      (result.warnings.length ? ' · <span class="warn">' + result.warnings.length + ' warnings</span>' : '');

    show('dex');
    applyFilters();
  }

  async function handleFile(file) {
    if (!file) return;
    show('loading');
    el.loadingMsg.textContent = 'Reading ' + file.name + '…';
    try {
      const buf = await file.arrayBuffer();
      el.loadingMsg.textContent = 'Parsing species…';
      const result = await window.CobblemonParser.parseArchive(buf, file.name);
      if (!result.entries.length) {
        show('drop');
        alert('No Cobblemon species found in "' + file.name + '".\n' +
          'Make sure it contains data/<namespace>/species/…');
        return;
      }
      loadResult(result);
    } catch (err) {
      console.error(err);
      show('drop');
      alert('Could not read "' + file.name + '": ' + err.message);
    }
  }

  // ---- events -------------------------------------------------------------

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

  el.search.addEventListener('input', applyFilters);
  el.typeFilter.addEventListener('change', applyFilters);
  el.resetBtn.addEventListener('click', function () {
    el.fileInput.value = '';
    el.search.value = '';
    el.typeFilter.value = '';
    show('drop');
  });

  el.grid.addEventListener('click', function (e) {
    const card = e.target.closest('.card');
    if (card) openDrawer(card.dataset.id);
  });
  el.drawerBackdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.drawer.hidden) closeDrawer();
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
})();
