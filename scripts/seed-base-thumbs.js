/*
 * Seed pre-rendered base Cobblemon thumbnails into the shared D1 `base_thumbs`
 * table, so social-preview (og:image) links for base-dex mons show the sprite
 * without shipping ~1000 image files in the repo.
 *
 *   node scripts/seed-base-thumbs.js            # seed the remote (production) DB
 *   node scripts/seed-base-thumbs.js --local    # seed the local wrangler DB
 *
 * Renders via scripts/thumb-harness.html (same Sprite.render pipeline), then
 * writes rows through `wrangler d1 execute` in batches. Requires Chrome and a
 * wrangler authenticated for the target database.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_NAME = 'fakedex-db';
const REMOTE = !process.argv.includes('--local');
const RENDER_BATCH = 25;
const STMTS_PER_FILE = 150; // one single-row INSERT per statement (avoids SQLITE_TOOBIG)

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.zip': 'application/zip', '.json': 'application/json' };

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const c = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return c.find(function (p) { return p && fs.existsSync(p); }) || null;
}

function startServer() {
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

function d1exec(sql) {
  const tmp = path.join(os.tmpdir(), 'fakedex-seed-' + process.pid + '.sql');
  fs.writeFileSync(tmp, sql);
  const fwd = tmp.replace(/\\/g, '/');
  const flag = REMOTE ? '--remote' : '--local';
  execSync('npx wrangler d1 execute ' + DB_NAME + ' ' + flag + ' --file "' + fwd + '" --yes',
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  try { fs.unlinkSync(tmp); } catch (e) {}
}

(async function () {
  const chrome = findChrome();
  if (!chrome) { console.error('No Chrome found. Set CHROME_PATH.'); process.exit(1); }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch (e) { console.error('Run: npm install'); process.exit(1); }

  const server = await startServer();
  const base = 'http://127.0.0.1:' + server.address().port;
  console.log('Rendering base thumbnails (' + (REMOTE ? 'remote' : 'local') + ' seed)…');

  const browser = await puppeteer.launch({
    executablePath: chrome, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const rows = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', function (e) { console.warn('[page]', e.message); });
    await page.goto(base + '/scripts/thumb-harness.html', { waitUntil: 'load' });
    const total = await page.evaluate(function () { return window.__ready; });

    for (let i = 0; i < total; i += RENDER_BATCH) {
      await page.evaluate(function (a, b) { return window.__renderRange(a, b); }, i, Math.min(i + RENDER_BATCH, total));
      process.stdout.write('\r  render ' + Math.min(i + RENDER_BATCH, total) + '/' + total);
    }
    process.stdout.write('\n');

    for (let i = 0; i < total; i += RENDER_BATCH) {
      const items = await page.evaluate(function (a, b) { return window.__ogBatch(a, b); }, i, Math.min(i + RENDER_BATCH, total));
      for (const it of items) {
        const b64 = it.webp.split(',')[1];
        const norm = String(it.id).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (b64 && norm) rows.push({ norm: norm, thumb: b64 });
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  // Dedup by normalised id (keep the last).
  const byNorm = {};
  rows.forEach(function (r) { byNorm[r.norm] = r.thumb; });
  const norms = Object.keys(byNorm);
  console.log('Seeding ' + norms.length + ' base thumbnails into ' + DB_NAME + '…');

  d1exec('CREATE TABLE IF NOT EXISTS base_thumbs (norm TEXT PRIMARY KEY, thumb TEXT NOT NULL);');

  for (let i = 0; i < norms.length; i += STMTS_PER_FILE) {
    const chunk = norms.slice(i, i + STMTS_PER_FILE);
    // One single-row statement each — keeps every statement small.
    const sql = chunk.map(function (n) {
      return "INSERT OR REPLACE INTO base_thumbs (norm,thumb) VALUES ('" + n + "','" + byNorm[n] + "');";
    }).join('\n');
    d1exec(sql);
    process.stdout.write('\r  seeded ' + Math.min(i + STMTS_PER_FILE, norms.length) + '/' + norms.length);
  }
  process.stdout.write('\n');
  console.log('Done.');
})().catch(function (e) { console.error(e); process.exit(1); });
