/*
 * thumbs.js — consume the pre-rendered base-dex thumbnail atlas (data/base-thumbs.js).
 *
 * The grid shows base Cobblemon sprites straight from a shipped WebP atlas, so
 * cards paint instantly with no per-card WebGL work and without waiting on the
 * (multi-MB) model bundle. Live baking still covers pack sprites, shiny mode and
 * any id missing from the atlas.
 */
(function (global) {
  'use strict';

  const T = global.BASE_THUMBS || null;

  function has(id) {
    return !!(T && T.index && Object.prototype.hasOwnProperty.call(T.index, id));
  }

  // { url, x, y, cell } for the atlas cell holding `id`, or null.
  function cellFor(id) {
    if (!has(id)) return null;
    const i = T.index[id];
    const page = Math.floor(i / T.perPage);
    const pos = i % T.perPage;
    const col = pos % T.cols;
    const row = Math.floor(pos / T.cols);
    const v = T.version ? '?v=' + T.version : '';
    return { url: T.pages[page] + v, x: -col * T.cell, y: -row * T.cell, cell: T.cell };
  }

  // Inline style painting `id`'s cell as a background — for a fixed-size element.
  function styleFor(id) {
    const c = cellFor(id);
    if (!c) return '';
    return 'width:' + c.cell + 'px;height:' + c.cell + 'px;' +
      'background-image:url(' + c.url + ');' +
      'background-position:' + c.x + 'px ' + c.y + 'px;background-repeat:no-repeat';
  }

  global.Thumbs = { has: has, cellFor: cellFor, styleFor: styleFor, version: T ? T.version : null };
})(window);
