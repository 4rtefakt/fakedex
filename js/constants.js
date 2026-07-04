/* constants.js — display metadata: type colors, stat labels, prettifiers. */
(function (global) {
  'use strict';

  const TYPE_COLORS = {
    normal: '#9099A1', fire: '#FF9C54', water: '#4D90D5', electric: '#F3D23B',
    grass: '#63BC5A', ice: '#74CEC0', fighting: '#CE4069', poison: '#AB6AC8',
    ground: '#D97845', flying: '#8FA9DE', psychic: '#F97176', bug: '#90C12C',
    rock: '#C7B78B', ghost: '#5269AC', dragon: '#0B6DC3', dark: '#5A5366',
    steel: '#5A8EA1', fairy: '#EC8FE6',
  };

  function typeColor(t) {
    return (t && TYPE_COLORS[t.toLowerCase()]) || '#6b7280';
  }

  const ALL_TYPES = Object.keys(TYPE_COLORS);

  // Attacking type -> { defending type: multiplier } (only the non-1 entries).
  // Standard gen-6+ chart.
  const TYPE_CHART = {
    normal: { rock: .5, ghost: 0, steel: .5 },
    fire: { fire: .5, water: .5, grass: 2, ice: 2, bug: 2, rock: .5, dragon: .5, steel: 2 },
    water: { fire: 2, water: .5, grass: .5, ground: 2, rock: 2, dragon: .5 },
    electric: { water: 2, electric: .5, grass: .5, ground: 0, flying: 2, dragon: .5 },
    grass: { fire: .5, water: 2, grass: .5, poison: .5, ground: 2, flying: .5, bug: .5, rock: 2, dragon: .5, steel: .5 },
    ice: { fire: .5, water: .5, grass: 2, ice: .5, ground: 2, flying: 2, dragon: 2, steel: .5 },
    fighting: { normal: 2, ice: 2, poison: .5, flying: .5, psychic: .5, bug: .5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: .5 },
    poison: { grass: 2, poison: .5, ground: .5, rock: .5, ghost: .5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: .5, poison: 2, flying: 0, bug: .5, rock: 2, steel: 2 },
    flying: { electric: .5, grass: 2, fighting: 2, bug: 2, rock: .5, steel: .5 },
    psychic: { fighting: 2, poison: 2, psychic: .5, dark: 0, steel: .5 },
    bug: { fire: .5, grass: 2, fighting: .5, poison: .5, flying: .5, psychic: 2, ghost: .5, dark: 2, steel: .5, fairy: .5 },
    rock: { fire: 2, ice: 2, fighting: .5, ground: .5, flying: 2, bug: 2, steel: .5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: .5 },
    dragon: { dragon: 2, steel: .5, fairy: 0 },
    dark: { fighting: .5, psychic: 2, ghost: 2, dark: .5, fairy: .5 },
    steel: { fire: .5, water: .5, electric: .5, ice: 2, rock: 2, steel: .5, fairy: 2 },
    fairy: { fire: .5, fighting: 2, poison: .5, dragon: 2, dark: 2, steel: .5 },
  };

  // Damage multiplier of attacking type `attacker` against a mon with `types`.
  function typeMultiplier(attacker, types) {
    let m = 1;
    const row = TYPE_CHART[attacker] || {};
    (types || []).forEach(function (t) { if (t && row[t] != null) m *= row[t]; });
    return m;
  }

  // Group all attacking types by their multiplier vs `types` (neutral omitted).
  // -> { weak: [{type,mult}], resist: [...], immune: [...] }, each sorted.
  function defensiveMatchups(types) {
    types = (types || []).filter(Boolean).map(function (t) { return t.toLowerCase(); });
    const weak = [], resist = [], immune = [];
    if (!types.length) return { weak: weak, resist: resist, immune: immune };
    ALL_TYPES.forEach(function (a) {
      const m = typeMultiplier(a, types);
      if (m === 0) immune.push({ type: a, mult: 0 });
      else if (m > 1) weak.push({ type: a, mult: m });
      else if (m < 1) resist.push({ type: a, mult: m });
    });
    weak.sort(function (x, y) { return y.mult - x.mult; });
    resist.sort(function (x, y) { return x.mult - y.mult; });
    return { weak: weak, resist: resist, immune: immune };
  }

  // Short label for a type multiplier: 4, 2, .5, .25, 0.
  function multLabel(m) {
    if (m === 0) return '×0';
    if (m === 0.25) return '×¼';
    if (m === 0.5) return '×½';
    return '×' + m;
  }

  const STAT_LABELS = {
    hp: 'HP', attack: 'Atk', defence: 'Def',
    special_attack: 'Sp. Atk', special_defence: 'Sp. Def', speed: 'Speed',
  };

  // Cobblemon ids are lowercase, spaceless. We can't perfectly re-split
  // concatenated words without the base-game lang file, so this is best-effort:
  // turn "medium_slow" -> "Medium Slow" and capitalize a bare "swift" -> "Swift".
  // (A future step can wire in Cobblemon's own en_us.json for exact names.)
  function prettify(id) {
    if (!id) return '';
    return String(id)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // Spawn rarity bucket → colour.
  const RARITY = {
    common: '#63bc5a',
    uncommon: '#4d90d5',
    rare: '#ab6ac8',
    'ultra-rare': '#f0b429',
  };
  function rarityColor(b) { return (b && RARITY[b]) || '#6b7280'; }

  // Damage category → colour + short label.
  const CATEGORY = {
    Physical: { color: '#C92112', abbr: 'PHY' },
    Special: { color: '#4F5870', abbr: 'SPE' },
    Status: { color: '#8A8A99', abbr: 'STA' },
  };

  // PokémonDB move URL slug: "Dazzling Gleam" -> "dazzling-gleam".
  function pokemondbSlug(name) {
    return String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  global.DexConst = {
    TYPE_COLORS: TYPE_COLORS,
    typeColor: typeColor,
    TYPE_CHART: TYPE_CHART,
    typeMultiplier: typeMultiplier,
    defensiveMatchups: defensiveMatchups,
    multLabel: multLabel,
    STAT_LABELS: STAT_LABELS,
    CATEGORY: CATEGORY,
    rarityColor: rarityColor,
    prettify: prettify,
    cap: cap,
    pokemondbSlug: pokemondbSlug,
  };
})(window);
