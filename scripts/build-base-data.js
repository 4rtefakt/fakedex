/*
 * Regenerates data/base-moves.js and data/base-abilities.js from Pokémon
 * Showdown's public data (the same dataset Cobblemon uses under the hood).
 *
 *   node scripts/build-base-data.js
 *
 * These bundled files give real move/ability display names, types, damage
 * categories and descriptions for every standard move/ability, so packs only
 * need to supply their custom (fakemon-original) definitions.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'data');
const MOVES_URL = 'https://play.pokemonshowdown.com/data/moves.json';
const ABILITIES_URL = 'https://play.pokemonshowdown.com/data/abilities.js';

function get(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      if (res.statusCode !== 200) return reject(new Error(url + ' -> ' + res.statusCode));
      let body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () { resolve(body); });
    }).on('error', reject);
  });
}

(async function () {
  // moves.json: id -> { name, type, category, basePower, accuracy, pp, shortDesc, desc }
  const moves = JSON.parse(await get(MOVES_URL));
  const outM = {};
  for (const id in moves) {
    const m = moves[id];
    outM[id] = {
      n: m.name,
      t: m.type,
      c: m.category,
      p: m.basePower || 0,
      a: m.accuracy === true ? 0 : (m.accuracy || 0),
      pp: m.pp || 0,
      d: m.shortDesc || m.desc || '',
    };
  }
  fs.writeFileSync(
    path.join(OUT, 'base-moves.js'),
    '/* Auto-generated from Pokemon Showdown moves data. Move id -> metadata. */\n' +
      'window.BASE_MOVES = ' + JSON.stringify(outM) + ';\n'
  );
  console.log('base-moves.js:', Object.keys(outM).length, 'moves');

  // abilities.js: `exports.BattleAbilities = {...}`
  const ex = {};
  new Function('exports', await get(ABILITIES_URL))(ex);
  const ab = ex.BattleAbilities || {};
  const outA = {};
  for (const id in ab) {
    outA[id] = { n: ab[id].name, d: ab[id].shortDesc || ab[id].desc || '' };
  }
  fs.writeFileSync(
    path.join(OUT, 'base-abilities.js'),
    '/* Auto-generated from Pokemon Showdown abilities data. Ability id -> metadata. */\n' +
      'window.BASE_ABILITIES = ' + JSON.stringify(outA) + ';\n'
  );
  console.log('base-abilities.js:', Object.keys(outA).length, 'abilities');
})().catch(function (e) { console.error(e); process.exit(1); });
