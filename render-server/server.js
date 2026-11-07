/*
 * Report Studio render server
 * POST /render       { layout, data, name? }  -> application/pdf
 * POST /render/html  { layout, data }         -> text/html (debugging)
 * GET  /health
 *
 * Environment:
 *   PORT=3900  HOST=0.0.0.0  API_KEY=change-me  MAX_PAGES=4 (parallel renders)
 *   CHROME_PATH=/path/to/chrome (optional, otherwise Puppeteer's bundled Chrome)
 *   ALLOW_REMOTE_IMAGES=0|1 (default 0: only embedded data: images are loaded)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');

const PORT = Number(process.env.PORT || 3900);
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.API_KEY || 'change-me';
const MAX_PAGES = Number(process.env.MAX_PAGES || 4);
const ALLOW_REMOTE = process.env.ALLOW_REMOTE_IMAGES === '1';
const RENDER_TIMEOUT = Number(process.env.RENDER_TIMEOUT_MS || 90000);
// URL where Chromium can reach this app (change when mounted under a path inside another Express app)
let SELF_URL = (process.env.SELF_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');

// The engine is shared with the APEX designer: look next to us first, then in ../static
const ENGINE_PATH = [path.join(__dirname, 'rpt-engine.js'), path.join(__dirname, '..', 'static', 'rpt-engine.js')]
  .find((p) => fs.existsSync(p));
if (!ENGINE_PATH) throw new Error('rpt-engine.js not found (copy it next to server.js)');

const FONT_PACKAGES = {
  'noto-sans': ['400.css', '700.css', '400-italic.css', '700-italic.css'],
  'noto-serif': ['400.css', '700.css', '400-italic.css', '700-italic.css'],
  'noto-sans-tamil': ['400.css', '700.css'],
  'noto-sans-sinhala': ['400.css', '700.css'],
  'noto-sans-mono': ['400.css', '700.css']
};
function fontDir(pkg) {
  try { return path.dirname(require.resolve('@fontsource/' + pkg + '/package.json')); } catch (e) { return null; }
}
const fontLinks = Object.keys(FONT_PACKAGES).filter(fontDir).map((pkg) =>
  FONT_PACKAGES[pkg].filter((f) => fs.existsSync(path.join(fontDir(pkg), f)))
    .map((f) => `<link rel="stylesheet" href="fonts/${pkg}/${f}">`).join('')).join('');

const SHELL = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>report</title>${fontLinks}
<style id="rpt-css"></style><style>html,body{margin:0;padding:0;background:#fff}</style>
<script src="engine.js"></script></head><body><div id="out"></div></body></html>`;

/* ---------------------------------------------------------------- browser */
let browserPromise = null;
let chromiumState = 'not started';
function getBrowser() {
  if (!browserPromise) {
    const puppeteer = require('puppeteer');
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--disable-gpu']
    }).then((b) => {
      chromiumState = 'ready';
      b.on('disconnected', () => { browserPromise = null; chromiumState = 'disconnected'; });
      return b;
    }).catch((e) => { browserPromise = null; chromiumState = 'error: ' + e.message; throw e; });
  }
  return browserPromise;
}

let active = 0;
const queue = [];
function acquire() {
  return new Promise((resolve) => {
    if (active < MAX_PAGES) { active++; resolve(); } else queue.push(resolve);
  });
}
function release() {
  const next = queue.shift();
  if (next) next(); else active--;
}

async function renderInPage(payload, wantPdf) {
  await acquire();
  const browser = await getBrowser();
  const page = await browser.newPage();
  const t0 = Date.now();
  try {
    page.setDefaultTimeout(RENDER_TIMEOUT);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u.startsWith('data:') || u.startsWith(SELF_URL + '/')) return req.continue();
      if (ALLOW_REMOTE && /^https?:/.test(u) && req.resourceType() === 'image') return req.continue();
      return req.abort();
    });
    await page.goto(`${SELF_URL}/shell`, { waitUntil: 'load' });
    const info = await page.evaluate(async (p) => {
      const r = await window.RptEngine.renderAsync(p.layout, p.data || {}, { maxPages: p.maxPages || 5000 });
      document.getElementById('rpt-css').textContent = r.css;
      document.getElementById('out').innerHTML = r.html;
      document.title = p.name || p.code || 'report';
      await document.fonts.ready;
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map((i) => i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; })));
      return { pageCount: r.pageCount, width: r.width, height: r.height, errors: r.errors };
    }, payload);
    if (!wantPdf) {
      const html = await page.content();
      return { info, html };
    }
    const pdf = await page.pdf({
      width: (info.width / 72) + 'in', height: (info.height / 72) + 'in', printBackground: true,
      preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    info.ms = Date.now() - t0;
    return { info, pdf };
  } finally {
    await page.close().catch(() => {});
    release();
  }
}

/* ----------------------------------------------------------------- routes */
/**
 * createApp({ selfUrl }) returns an Express app. To mount inside an existing server:
 *   app.use('/report-studio', require('./server').createApp({ selfUrl: 'http://127.0.0.1:3000/report-studio' }));
 */
function createApp(opts) {
  if (opts && opts.selfUrl) SELF_URL = String(opts.selfUrl).replace(/\/$/, '');
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (req, res) => {
    const key = req.get('x-api-key');
    res.set('Cache-Control', 'no-store').json({
      ok: true, engine: require(ENGINE_PATH).VERSION, active, queued: queue.length,
      chromium: chromiumState, uptime: Math.round(process.uptime()),
      apiKey: key == null ? 'not-sent' : (key === API_KEY ? 'valid' : 'invalid')
    });
  });
  app.get('/shell', (req, res) => res.type('html').send(SHELL));
  app.get('/engine.js', (req, res) => res.type('application/javascript').sendFile(ENGINE_PATH));
  Object.keys(FONT_PACKAGES).forEach((pkg) => { const d = fontDir(pkg); if (d) app.use('/fonts/' + pkg, express.static(d, { maxAge: '30d' })); });

  const auth = (req, res, next) => {
    if (req.get('x-api-key') !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
    next();
  };
  const json = express.json({ limit: process.env.BODY_LIMIT || '60mb' });

  app.post('/render', auth, json, async (req, res) => {
    try {
      if (!req.body || !req.body.layout) return res.status(400).json({ error: 'Body must contain layout and data' });
      const { info, pdf } = await renderInPage(req.body, true);
      const name = String(req.body.code || 'report').toLowerCase().replace(/[^a-z0-9_\-]/g, '_') + '.pdf';
      res.set({
        'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`,
        'X-Page-Count': String(info.pageCount), 'X-Render-Ms': String(info.ms),
        'X-Render-Warnings': String(info.errors.length)
      });
      if (info.errors.length) console.warn(`[render] ${req.body.code || ''}: ${info.errors.slice(0, 5).join(' | ')}`);
      console.log(`[render] ${req.body.code || 'report'} ${info.pageCount} page(s) ${info.ms} ms`);
      res.end(Buffer.from(pdf));
    } catch (e) {
      console.error('[render] failed:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/render/html', auth, json, async (req, res) => {
    try {
      const { html } = await renderInPage(req.body, false);
      res.type('html').send(html);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Always answer with JSON, so PL/SQL shows a readable message instead of an HTML error page
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const msg = err.type === 'entity.parse.failed'
      ? 'Request body is not valid JSON (' + err.message + '). Received ' + (req.get('content-length') || '?') + ' bytes - check that the body is sent as UTF-8 and is not truncated.'
      : err.type === 'entity.too.large' ? 'Request body too large; raise BODY_LIMIT (now ' + (process.env.BODY_LIMIT || '60mb') + ')'
      : err.message;
    console.error('[render] ' + msg);
    res.status(err.status || 500).json({ error: msg });
  });
  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`Report Studio render server on http://${HOST}:${PORT}  (engine ${require(ENGINE_PATH).VERSION}, ${MAX_PAGES} parallel)`);
    if (API_KEY === 'change-me') console.warn('WARNING: set API_KEY (and RPT_CONFIG.RENDER_API_KEY) before production use');
    getBrowser().then(() => console.log('Chromium ready')).catch((e) => console.error('Chromium failed to start:', e.message));
  });
  const stop = async () => { try { (await browserPromise) && (await browserPromise).close(); } catch (e) { /* ignore */ } process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { createApp, renderInPage };
