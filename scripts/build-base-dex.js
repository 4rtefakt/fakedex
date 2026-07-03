/*
 * Generates data/base-cobblemon.js — the parsed base Cobblemon Pokédex, bundled
 * so Fakédex shows the vanilla dex by default (fakemon packs add on top).
 *
 *   node scripts/build-base-dex.js <path-to-Cobblemon.jar>
 *
 * Only species + lang are read (not the 100 MB of models/textures), and sprites
 * are skipped — base mons render as data-only cards.
 */
const fs = require('fs');
const path = require('path');

const jarPath = process.argv[2];
if (!jarPath) { console.error('usage: node scripts/build-base-dex.js <Cobblemon.jar>'); process.exit(1); }

global.window = {};
global.fflate = require(path.join(__dirname, '..', 'vendor', 'fflate.js'));
// fflate's async unzip spawns workers for large archives, which fail under this
// Node/UMD setup — route it through the synchronous path for the build.
const _unzipSync = global.fflate.unzipSync;
global.fflate.unzip = function (data, opts, cb) {
  try { cb(null, _unzipSync(data, opts)); } catch (e) { cb(e); }
};
require(path.join(__dirname, '..', 'js', 'parser.js'));

// Fields we don't need in the bundle (recomputable or sprite-only) — dropped to
// keep the download small.
const DROP = ['source', 'speciesName', 'aspects', 'implemented', 'baseName'];

(async function () {
  const buf = fs.readFileSync(jarPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const result = await window.CobblemonParser.parseArchive(ab, 'Cobblemon', { skipSprites: true });

  const entries = result.entries.map(function (e) {
    const o = Object.assign({}, e);
    DROP.forEach(function (k) { delete o[k]; });
    return o;
  });

  const out =
    '/* Auto-generated base Cobblemon dex. Regenerate: node scripts/build-base-dex.js <jar> */\n' +
    'window.BASE_COBBLEMON = ' + JSON.stringify({
      version: 'cobblemon',
      entries: entries,
    }) + ';\n';

  const outPath = path.join(__dirname, '..', 'data', 'base-cobblemon.js');
  fs.writeFileSync(outPath, out);
  console.log('wrote', outPath);
  console.log('entries:', entries.length, '| bytes:', out.length, '(' + (out.length / 1048576).toFixed(1) + ' MB)');
})().catch(function (e) { console.error(e); process.exit(1); });
