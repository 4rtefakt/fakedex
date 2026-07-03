/*
 * parser.js — turns a Cobblemon mod archive (.jar / .zip / datapack) into a
 * normalized "dex" of fakemon, entirely in the browser.
 *
 * All four Modrinth distribution formats (Fabric jar, NeoForge jar, datapack
 * zip, resourcepack zip) are just ZIP containers. The species data always lives
 * at data/<namespace>/species/**.json, so one parser handles every format.
 *
 * Depends on the global `fflate` (vendor/fflate.js, UMD build).
 */
(function (global) {
  'use strict';

  // ---- low-level: unzip an ArrayBuffer into { path: Uint8Array } -----------

  // Unzip only entries matching `filterFn` (keeps us from inflating the whole
  // archive — mostly textures/sounds/models we don't all need).
  function unzip(arrayBuffer, filterFn) {
    return new Promise(function (resolve, reject) {
      fflate.unzip(
        new Uint8Array(arrayBuffer),
        { filter: function (file) { return filterFn(file.name); } },
        function (err, unzipped) { if (err) reject(err); else resolve(unzipped); }
      );
    });
  }

  function isDataFile(n) {
    return (
      (/(^|\/)data\/[^/]+\/species(_additions)?\//.test(n) && n.endsWith('.json')) ||
      /(^|\/)data\/[^/]+\/moves\/.+\.js(on)?$/.test(n) ||
      /(^|\/)assets\/[^/]+\/lang\/en_us\.json$/.test(n) ||
      /(^|\/)assets\/[^/]+\/bedrock\/pokemon\/(models|resolvers|posers)\/.+\.json$/.test(n)
    );
  }

  const decoder = new TextDecoder('utf-8');
  function text(bytes) {
    return decoder.decode(bytes);
  }

  // Cobblemon lang files (and some hand-edited data files) aren't always strict
  // JSON — they carry `#section#` / `//` comment lines and occasional trailing
  // commas. Try strict first, then fall back to a lenient clean-up pass.
  function lenientJson(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      const cleaned = str
        .split(/\r?\n/)
        .filter(function (l) { return !/^\s*#/.test(l) && !/^\s*\/\//.test(l); })
        .join('\n')
        .replace(/,(\s*[}\]])/g, '$1'); // drop trailing commas
      return JSON.parse(cleaned);
    }
  }

  // ---- lang: collect all en_us.json maps for description lookups -----------

  function collectLang(files) {
    const lang = {};
    for (const path in files) {
      if (/assets\/[^/]+\/lang\/en_us\.json$/.test(path)) {
        try {
          Object.assign(lang, lenientJson(text(files[path])));
        } catch (e) {
          /* a malformed lang file shouldn't kill the whole parse */
        }
      }
    }
    return lang;
  }

  // ---- move / ability string parsing --------------------------------------

  // Cobblemon move entries look like "1:tackle", "tm:protect", "tutor:swift",
  // "egg:wish", "legacy:toxic". A leading integer means "learned at that level".
  function parseMoves(raw) {
    const out = { level: [], tm: [], tutor: [], egg: [], legacy: [], other: [] };
    if (!Array.isArray(raw)) return out;
    for (const entry of raw) {
      const idx = entry.indexOf(':');
      if (idx === -1) {
        out.other.push({ move: entry });
        continue;
      }
      const key = entry.slice(0, idx);
      const move = entry.slice(idx + 1);
      const lvl = parseInt(key, 10);
      if (!Number.isNaN(lvl) && String(lvl) === key) {
        out.level.push({ level: lvl, move: move });
      } else if (out[key]) {
        out[key].push({ move: move });
      } else {
        out.other.push({ prefix: key, move: move });
      }
    }
    out.level.sort(function (a, b) { return a.level - b.level; });
    return out;
  }

  // "levitate" -> normal ability; "h:stellarize" -> hidden ability.
  function parseAbilities(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (a) {
      if (a.startsWith('h:')) return { name: a.slice(2), hidden: true };
      if (a.startsWith('ha:')) return { name: a.slice(3), hidden: true };
      return { name: a, hidden: false };
    });
  }

  function resolveDesc(pokedex, lang) {
    if (!Array.isArray(pokedex)) return '';
    return pokedex
      .map(function (key) { return lang[key] || ''; })
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  function prettyForm(name) {
    return String(name).replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // A form is "distinct" (worth its own dex card) if it changes stats or typing,
  // rather than just aspects/textures (shiny-like colour variants).
  function isDistinctForm(form, base) {
    if (form.baseStats) return true;
    if (form.primaryType && form.primaryType !== base.primaryType) return true;
    if (form.secondaryType !== undefined && form.secondaryType !== base.secondaryType) return true;
    if (Array.isArray(form.abilities) && form.abilities.length) return true;
    return false;
  }

  // Custom move files (data/<ns>/moves/*.js) are Pokémon Showdown-format object
  // literals that may contain JS functions (onHit, etc.), so we can't JSON.parse
  // them. We only need a few scalar fields — pull them out with targeted regexes.
  function extractMove(id, src) {
    function str(key) {
      // Value may be double- or single-quoted (packs mix both).
      let m = src.match(new RegExp(key + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
      if (!m) m = src.match(new RegExp(key + "\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'"));
      return m ? m[1].replace(/\\(['"])/g, '$1') : null;
    }
    function num(key) {
      const m = src.match(new RegExp(key + '\\s*:\\s*(true|\\d+)'));
      if (!m) return null;
      return m[1] === 'true' ? 0 : parseInt(m[1], 10);
    }
    return {
      n: str('name') || null,
      t: str('type') || null,
      c: str('category') || null, // Physical | Special | Status
      p: num('basePower') || 0,
      a: num('accuracy'),
      pp: num('pp') || 0,
      d: str('shortDesc') || str('desc') || '',
    };
  }

  const STAT_KEYS = ['hp', 'attack', 'defence', 'special_attack', 'special_defence', 'speed'];

  function normStats(s) {
    s = s || {};
    return {
      hp: s.hp || 0,
      attack: s.attack || 0,
      defence: s.defence || 0,
      special_attack: s.special_attack || 0,
      special_defence: s.special_defence || 0,
      speed: s.speed || 0,
    };
  }

  function statTotal(s) {
    return STAT_KEYS.reduce(function (t, k) { return t + (s[k] || 0); }, 0);
  }

  // Build a normalized entry from a raw species/form object.
  function makeEntry(obj, opts, lang) {
    opts = opts || {};
    const stats = normStats(obj.baseStats);
    const name = opts.name || obj.name || '(unknown)';
    return {
      id: opts.id || (obj.name ? obj.name.toLowerCase() : name.toLowerCase()),
      name: name,
      baseName: opts.baseName || name,
      formName: opts.formName || null,
      kind: opts.kind || 'species', // 'species' | 'form' | 'addition'
      dexNumber: obj.nationalPokedexNumber || null,
      primaryType: obj.primaryType || null,
      secondaryType: obj.secondaryType || null,
      abilities: parseAbilities(obj.abilities),
      eggGroups: Array.isArray(obj.eggGroups) ? obj.eggGroups : [],
      baseStats: stats,
      statTotal: statTotal(stats),
      evYield: obj.evYield || null,
      moves: parseMoves(obj.moves),
      evolutions: Array.isArray(obj.evolutions) ? obj.evolutions : [],
      forms: Array.isArray(obj.forms) ? obj.forms.map(function (f) { return f.name; }).filter(Boolean) : [],
      labels: Array.isArray(obj.labels) ? obj.labels : [],
      aspects: Array.isArray(obj.aspects) ? obj.aspects : [],
      speciesName: (opts.baseName || obj.name || name).toLowerCase().replace(/[^a-z0-9]/g, ''),
      description: resolveDesc(obj.pokedex, lang),
      catchRate: obj.catchRate ?? null,
      experienceGroup: obj.experienceGroup || null,
      eggCycles: obj.eggCycles ?? null,
      baseFriendship: obj.baseFriendship ?? null,
      baseExperienceYield: obj.baseExperienceYield ?? null,
      maleRatio: obj.maleRatio ?? null,
      height: obj.height ?? null,
      weight: obj.weight ?? null,
      implemented: obj.implemented !== false,
      source: opts.source || null,
    };
  }

  // ---- sprite resolution (bedrock models + resolvers) ---------------------

  // Cobblemon texture refs are usually a string, but can be an array of options
  // (random) or a molang object — normalise to a single string ref.
  function normalizeRef(ref) {
    if (Array.isArray(ref)) return normalizeRef(ref[0]);
    return typeof ref === 'string' ? ref : null;
  }

  // "cobblemon:textures/pokemon/x/y.png" -> "assets/cobblemon/textures/pokemon/x/y.png"
  function refToAssetPath(ref) {
    ref = normalizeRef(ref);
    if (!ref) return null;
    const i = ref.indexOf(':');
    if (i === -1) return 'assets/cobblemon/' + ref;
    return 'assets/' + ref.slice(0, i) + '/' + ref.slice(i + 1);
  }

  // Pick the resolver variation that best matches an entry's aspects: all of the
  // variation's aspects must be present, and among those we take the most specific.
  function matchVariation(variations, aspects) {
    const set = {};
    aspects.forEach(function (a) { set[a] = true; });
    let best = null, bestScore = -1;
    for (const v of variations) {
      const va = v.aspects || [];
      if (va.every(function (a) { return set[a]; }) && va.length > bestScore) {
        best = v; bestScore = va.length;
      }
    }
    return best;
  }

  // Build { models, textures(paths only), byId } from the bedrock files. Returns
  // the set of texture paths still to extract (done in a second unzip pass).
  function buildSpriteIndex(files) {
    const modelsByRef = {};   // "ns:name.geo" -> geoJson
    const resolversBySpecies = {}; // speciesKey -> [variations...]

    for (const path in files) {
      let m = path.match(/(^|\/)assets\/([^/]+)\/bedrock\/pokemon\/models\/(.+)\.json$/);
      if (m) {
        try { modelsByRef[m[2] + ':' + m[3]] = JSON.parse(text(files[path])); }
        catch (e) { /* skip bad model */ }
        continue;
      }
      m = path.match(/(^|\/)assets\/[^/]+\/bedrock\/pokemon\/resolvers\/.+\.json$/);
      if (m) {
        try {
          const r = JSON.parse(text(files[path]));
          const key = (r.species || '').split(':').pop().replace(/[^a-z0-9]/g, '');
          if (!resolversBySpecies[key]) resolversBySpecies[key] = [];
          (r.variations || []).forEach(function (v) { resolversBySpecies[key].push(v); });
        } catch (e) { /* skip bad resolver */ }
      }
    }
    return { modelsByRef: modelsByRef, resolversBySpecies: resolversBySpecies };
  }

  // ---- top level: archive -> { entries, meta, warnings } ------------------

  async function parseArchive(arrayBuffer, fileName) {
    const files = await unzip(arrayBuffer, isDataFile);
    const lang = collectLang(files);
    const entries = [];
    const warnings = [];
    let speciesFiles = 0;
    let additionFiles = 0;

    // Custom (pack-defined) move metadata, keyed by move id (filename stem).
    const customMoves = {};
    for (const path in files) {
      const mm = path.match(/(^|\/)data\/[^/]+\/moves\/(.+)\.js(on)?$/);
      if (!mm) continue;
      const id = mm[2].split('/').pop();
      try {
        customMoves[id] = extractMove(id, text(files[path]));
      } catch (e) { /* skip unparseable move */ }
    }

    // Custom ability descriptions come from lang keys cobblemon.ability.<id>.desc
    const customAbilities = {};
    for (const key in lang) {
      const am = key.match(/(^|\.)ability\.([a-z0-9_]+)\.desc$/);
      if (am) customAbilities[am[2]] = lang[key];
    }

    for (const path in files) {
      const isSpecies = /(^|\/)data\/[^/]+\/species\//.test(path);
      const isAddition = /(^|\/)data\/[^/]+\/species_additions\//.test(path);
      if (!isSpecies && !isAddition) continue;

      let obj;
      try {
        obj = lenientJson(text(files[path]));
      } catch (e) {
        warnings.push('Could not parse JSON: ' + path);
        continue;
      }

      if (isSpecies) {
        speciesFiles++;
        entries.push(makeEntry(obj, { kind: 'species', source: path }, lang));
        // Inline forms carried inside a species file. Many are purely cosmetic
        // (colour/aspect variants that inherit the base's stats and types) — we
        // only surface a form as its own entry when it's a real battle form,
        // i.e. it defines its own baseStats or its own typing.
        if (Array.isArray(obj.forms)) {
          for (const form of obj.forms) {
            if (!form || !form.name) continue;
            if (!isDistinctForm(form, obj)) continue;
            const merged = Object.assign({}, obj, form); // form overrides base
            merged.name = obj.name;
            entries.push(
              makeEntry(merged, {
                kind: 'form',
                id: (obj.name + '-' + form.name).toLowerCase(),
                name: obj.name + ' (' + prettyForm(form.name) + ')',
                baseName: obj.name,
                formName: prettyForm(form.name),
                source: path,
              }, lang)
            );
          }
        }
      } else {
        // species_additions: forms grafted onto an existing (often vanilla) mon.
        additionFiles++;
        const target = (obj.target || '').split(':').pop() || '?';
        const targetName = target.charAt(0).toUpperCase() + target.slice(1);
        if (Array.isArray(obj.forms)) {
          for (const form of obj.forms) {
            if (!form || !form.name) continue;
            if (!form.baseStats && !form.primaryType) continue; // skip cosmetic-only
            entries.push(
              makeEntry(form, {
                kind: 'addition',
                id: (target + '-' + form.name).toLowerCase(),
                name: targetName + ' (' + prettyForm(form.name) + ')',
                baseName: targetName,
                formName: prettyForm(form.name),
                source: path,
              }, lang)
            );
          }
        }
      }
    }

    // Stable ordering: dex number first (nulls last), then name.
    entries.sort(function (a, b) {
      const an = a.dexNumber, bn = b.dexNumber;
      if (an != null && bn != null && an !== bn) return an - bn;
      if (an != null && bn == null) return -1;
      if (an == null && bn != null) return 1;
      return a.name.localeCompare(b.name);
    });

    // Resolve a renderable model + textures for each entry, where the pack ships
    // one. (Forms of vanilla mons often reuse base-Cobblemon models we don't have.)
    const sprIdx = buildSpriteIndex(files);
    const spriteById = {};
    const neededTextures = {};
    for (const entry of entries) {
      const variations = sprIdx.resolversBySpecies[entry.speciesName];
      if (!variations || !variations.length) continue;
      const baseVar = variations.find(function (v) { return !(v.aspects && v.aspects.length); }) || variations[0];
      const matched = matchVariation(variations, entry.aspects) || baseVar;
      const modelRef = normalizeRef(matched.model || baseVar.model);
      const layers = matched.layers || baseVar.layers || [];
      const basePath = refToAssetPath(matched.texture || baseVar.texture);
      if (!modelRef || !basePath || !sprIdx.modelsByRef[modelRef]) continue;
      const texPaths = [basePath];
      layers.forEach(function (l) {
        const p = l && l.texture ? refToAssetPath(l.texture) : null;
        if (p) texPaths.push(p);
      });
      texPaths.forEach(function (p) { neededTextures[p] = true; });
      spriteById[entry.id] = { modelRef: modelRef, texturePaths: texPaths };
    }

    // Second unzip pass: pull just the texture PNGs the sprites reference. A
    // failure here only costs sprites, never the rest of the dex.
    let textures = {};
    if (Object.keys(neededTextures).length) {
      try {
        textures = await unzip(arrayBuffer, function (n) { return neededTextures[n] === true; });
      } catch (e) {
        warnings.push('Could not extract sprite textures: ' + e.message);
      }
    }

    const sprites = {
      models: sprIdx.modelsByRef,
      textures: textures,
      byId: spriteById,
    };

    return {
      sprites: sprites,
      entries: entries,
      warnings: warnings,
      customMoves: customMoves,
      customAbilities: customAbilities,
      meta: {
        fileName: fileName || null,
        speciesFiles: speciesFiles,
        additionFiles: additionFiles,
        entryCount: entries.length,
        langKeys: Object.keys(lang).length,
        customMoves: Object.keys(customMoves).length,
        spriteCount: Object.keys(spriteById).length,
      },
      lang: lang,
    };
  }

  global.CobblemonParser = { parseArchive: parseArchive, STAT_KEYS: STAT_KEYS };
})(window);
