/*
 * Builds the base Cobblemon sprite assets so Fakédex can render base mons and
 * texture-only variant packs (which reuse base models).
 *
 *   node scripts/build-base-assets.js <Cobblemon.jar>
 *
 * Outputs:
 *   assets/cobblemon-base.zip   — fetched once by the client, cached in IndexedDB
 *                                 (referenced models + primary textures)
 *   data/base-sprites.js        — small index: base entry id -> { model, textures }
 */
const fs = require('fs');
const path = require('path');

const jarPath = process.argv[2];
if (!jarPath) { console.error('usage: node scripts/build-base-assets.js <Cobblemon.jar>'); process.exit(1); }

global.window = {};
const fflate = require(path.join(__dirname, '..', 'vendor', 'fflate.js'));
global.fflate = fflate;
const _unzipSync = fflate.unzipSync;
global.fflate.unzip = function (data, opts, cb) { try { cb(null, _unzipSync(data, opts)); } catch (e) { cb(e); } };
require(path.join(__dirname, '..', 'js', 'parser.js'));

function refToModelPath(ref) {
  const i = ref.indexOf(':');
  const ns = i === -1 ? 'cobblemon' : ref.slice(0, i);
  const name = i === -1 ? ref : ref.slice(i + 1);
  return 'assets/' + ns + '/bedrock/pokemon/models/' + name + '.json';
}

(async function () {
  const buf = fs.readFileSync(jarPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const result = await window.CobblemonParser.parseArchive(ab, 'Cobblemon');

  const models = result.sprites.models;  // ref -> geoJson (resolved locally)
  const textures = result.sprites.textures; // path -> Uint8Array
  const enc = new TextEncoder();

  // Keep only entries whose model is actually present in this bundle.
  const byId = {};
  const usedRefs = {};
  for (const id in result.sprites.byId) {
    const spec = result.sprites.byId[id];
    if (!models[spec.modelRef]) continue;
    byId[id] = { modelRef: spec.modelRef, texturePaths: spec.texturePaths };
    usedRefs[spec.modelRef] = true;
  }

  const zipEntries = {};
  let modelCount = 0;
  for (const ref in usedRefs) {
    if (!models[ref]) continue;
    zipEntries[refToModelPath(ref)] = enc.encode(JSON.stringify(models[ref]));
    modelCount++;
  }
  let texCount = 0;
  for (const p in textures) { zipEntries[p] = textures[p]; texCount++; }

  const zipped = fflate.zipSync(zipEntries, { level: 9 });
  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'cobblemon-base.zip'), Buffer.from(zipped));

  // Bundled index (small).
  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'base-sprites.js'),
    '/* Auto-generated base Cobblemon sprite index. Regenerate: node scripts/build-base-assets.js <jar> */\n' +
    'window.BASE_SPRITES = ' + JSON.stringify({ version: 'cobblemon-1.7.3', byId: byId }) + ';\n'
  );

  console.log('models in bundle:', modelCount, '| textures:', texCount);
  console.log('cobblemon-base.zip:', (zipped.length / 1048576).toFixed(1), 'MB');
  console.log('base-sprites index entries:', Object.keys(byId).length);
})().catch(function (e) { console.error(e); process.exit(1); });
