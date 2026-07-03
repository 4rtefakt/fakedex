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
    STAT_LABELS: STAT_LABELS,
    CATEGORY: CATEGORY,
    rarityColor: rarityColor,
    prettify: prettify,
    cap: cap,
    pokemondbSlug: pokemondbSlug,
  };
})(window);
