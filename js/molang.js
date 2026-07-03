/*
 * molang.js — evaluate a Molang expression to a number at a given anim time.
 *
 * Cobblemon idle animations put expressions like
 *   "51.4255 - 5*math.sin(q.anim_time*90)"
 * in keyframe values. We only need a static frame (t = 0), so this is a tiny
 * evaluator: it resolves query/variable terms, maps math.* to helpers (Molang
 * math is in DEGREES), whitelists the characters, then evaluates.
 */
(function (global) {
  'use strict';

  const D2R = Math.PI / 180;
  const HELPERS = {
    __sin: function (x) { return Math.sin(x * D2R); },
    __cos: function (x) { return Math.cos(x * D2R); },
    __tan: function (x) { return Math.tan(x * D2R); },
    __abs: Math.abs,
    __sqrt: Math.sqrt,
    __pow: Math.pow,
    __exp: Math.exp,
    __ln: Math.log,
    __min: Math.min,
    __max: Math.max,
    __round: Math.round,
    __floor: Math.floor,
    __ceil: Math.ceil,
    __trunc: Math.trunc,
    __sign: Math.sign,
    __mod: function (a, b) { return b ? a % b : 0; },
    __clamp: function (v, a, b) { return Math.min(Math.max(v, a), b); },
    __lerp: function (a, b, t) { return a + (b - a) * t; },
    __pi: function () { return Math.PI; },
  };
  const NAMES = Object.keys(HELPERS);
  const cache = {};

  function evaluate(expr, t) {
    if (typeof expr === 'number') return expr;
    if (typeof expr !== 'string') return 0;
    const key = expr + '@' + t;
    if (key in cache) return cache[key];

    let s = expr.toLowerCase().replace(/\s+/g, '');
    s = s.replace(/query\./g, 'q.').replace(/variable\./g, 'v.').replace(/temp\./g, 't.');
    // Static frame: time queries -> t, everything else query -> 0.
    s = s.replace(/q\.anim_time|q\.life_time|q\.modified_distance_moved/g, '(' + t + ')');
    s = s.replace(/q\.[a-z0-9_]+(\([^)]*\))?/g, '0');
    s = s.replace(/[vt]\.[a-z0-9_]+/g, '0');
    s = s.replace(/math\.pi/g, '__pi()');
    s = s.replace(/math\.([a-z0-9_]+)/g, '__$1');

    // Whitelist: digits, operators, parens, commas, dots, and __helper names.
    let stripped = s;
    NAMES.forEach(function (n) { stripped = stripped.split(n).join(''); });
    if (!/^[-+*/%(),.\d eE]*$/.test(stripped)) { cache[key] = 0; return 0; }

    let val = 0;
    try {
      const fn = new Function(NAMES.join(','), 'return (' + s + ');');
      val = fn.apply(null, NAMES.map(function (n) { return HELPERS[n]; }));
      if (!isFinite(val)) val = 0;
    } catch (e) { val = 0; }
    cache[key] = val;
    return val;
  }

  global.Molang = { evaluate: evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
