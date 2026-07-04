/*
 * Pre-render every base-dex sprite to a static thumbnail atlas so the grid
 * paints instantly without per-card WebGL work.
 *
 *   node scripts/build-thumbnails.js
 *
 * Drives the system Chrome (via puppeteer-core) over scripts/thumb-harness.html,
 * which reuses the exact in-browser Sprite.render pipeline — so pre-rendered
 * thumbnails are pixel-identical to live-baked ones. Outputs:
 *
 *   assets/thumbs/thumbs-<n>.png   — atlas pages (20x20 cells of 96px)
 *   data/base-thumbs.js            — { cell, cols, pages[], index: id -> cell }
 *
 * Requires a Chrome/Chromium install; auto-detected, or pass CHROME_PATH.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'thumbs');
const INDEX_OUT = path.join(ROOT, 'data', 'base-thumbs.js');
const BATCH = 25;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.zip': 'application/zip', '.css': 'text/css',
};

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find(function (p) { return p && fs.existsSync(p); }) || null;
}

function startServer() {
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

(async function () {
  const chrome = findChrome();
  if (!chrome) { console.error('No Chrome/Chromium found. Set CHROME_PATH.'); process.exit(1); }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch (e) { console.error('puppeteer-core not installed. Run: npm install'); process.exit(1); }

  const server = await startServer();
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  console.log('Serving repo at ' + base + ' · Chrome: ' + chrome);

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--enable-webgl', '--ignore-gpu-blocklist',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    ],
  });

  try {
    const page = await browser.newPage();
    page.on('pageerror', function (e) { console.warn('[page error]', e.message); });
    page.on('console', function (m) { if (m.type() === 'error') console.warn('[console]', m.text()); });

    await page.goto(base + '/scripts/thumb-harness.html', { waitUntil: 'load' });
    const total = await page.evaluate(function () { return window.__ready; });
    const meta = await page.evaluate(function () { return window.__meta; });
    console.log('Rendering ' + total + ' sprites at ' + meta.cell + 'px…');

    for (let i = 0; i < total; i += BATCH) {
      const end = Math.min(i + BATCH, total);
      await page.evaluate(function (a, b) { return window.__renderRange(a, b); }, i, end);
      process.stdout.write('\r  ' + end + '/' + total);
    }
    process.stdout.write('\n');

    const pageCount = await page.evaluate(function () { return window.__pageCount(); });
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const pagePaths = [];
    for (let p = 0; p < pageCount; p++) {
      const dataUrl = await page.evaluate(function (n) { return window.__pagePNG(n); }, p);
      const b64 = dataUrl.split(',')[1];
      const rel = 'assets/thumbs/thumbs-' + p + '.webp';
      fs.writeFileSync(path.join(ROOT, rel), Buffer.from(b64, 'base64'));
      const kb = Math.round(fs.statSync(path.join(ROOT, rel)).size / 1024);
      console.log('  wrote ' + rel + ' (' + kb + ' KB)');
      pagePaths.push(rel);
    }

    const ids = await page.evaluate(function () { return window.__ids; });
    const index = {};
    ids.forEach(function (id, i) { index[id] = i; });

    const out = 'window.BASE_THUMBS = ' + JSON.stringify({
      version: meta.version,
      cell: meta.cell, cols: meta.cols, rows: meta.rows, perPage: meta.perPage,
      pages: pagePaths,
      index: index,
    }) + ';\n';
    fs.writeFileSync(INDEX_OUT,
      '/* Auto-generated thumbnail atlas index. Regenerate: node scripts/build-thumbnails.js */\n' + out);
    console.log('Wrote data/base-thumbs.js (' + ids.length + ' entries, ' + pageCount + ' pages).');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(function (e) { console.error(e); process.exit(1); });
