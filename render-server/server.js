/*
 * Report Studio render server
 * POST /render       { layout, data, name?, format? }  -> PDF (default), format 'docx' -> Word, 'xlsx' -> Excel
 * POST /render/html  { layout, data }         -> text/html (debugging)
 * GET  /health
 *
 * Environment:
 *   PORT=3900  HOST=0.0.0.0  API_KEY=change-me  MAX_PAGES=4 (parallel renders)
 *   CHROME_PATH=/path/to/chrome (optional, otherwise Puppeteer's bundled Chrome)
 *   BROWSER_PROFILE=<folder> (optional, default ./browser-profile)  CHROME_ARGS="--flag ..." (optional)
 *   ALLOW_REMOTE_IMAGES=0|1 (default 0: only embedded data: images are loaded)
 * HTTPS (optional) - set ONE of:
 *   TLS_PFX=C:\certs\render.pfx  TLS_PASSPHRASE=secret        (Windows: a .pfx / .p12 export)
 *   TLS_CERT=server.crt  TLS_KEY=server.key  [TLS_CA=chain.crt]  (PEM files)
 *   With HTTPS, PORT is the HTTPS port; the browser inside uses plain HTTP on
 *   127.0.0.1:INTERNAL_PORT (default PORT+1), which is never reachable from outside.
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
const TLS = !!(process.env.TLS_PFX || (process.env.TLS_CERT && process.env.TLS_KEY));
const INTERNAL_PORT = Number(process.env.INTERNAL_PORT || PORT + 1);
// URL where Chromium can reach this app (change when mounted under a path inside another Express app)
let SELF_URL = (process.env.SELF_URL || `http://127.0.0.1:${TLS ? INTERNAL_PORT : PORT}`).replace(/\/$/, '');

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
    // A profile folder of our own: under a Windows service account the default
    // locations are often not writable, and Edge/Chrome then exit at start-up.
    const profile = process.env.BROWSER_PROFILE || path.join(__dirname, 'browser-profile');
    try { require('fs').mkdirSync(profile, { recursive: true }); } catch (e) { /* reported by launch */ }
    const extra = (process.env.CHROME_ARGS || '').split(/\s+/).filter(Boolean);
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
      userDataDir: profile,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--disable-gpu',
             '--no-first-run', '--no-default-browser-check', '--disable-extensions',
             '--disable-background-networking', '--disable-sync', '--disable-crash-reporter',
             '--disable-features=msEdgeIdentity,msEdgeSync,EdgeCollections,Translate'].concat(extra)
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

// In the page: turn everything Word cannot draw natively into PNG (barcodes, SVG/WebP pictures,
// ellipses, diagonal lines, rounded boxes) and record each picture's natural size.
const RASTERIZE = async (doc) => {
  const SCALE = 3;
  const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  const canvasFor = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * SCALE)); c.height = Math.max(1, Math.round(h * SCALE)); return c; };
  for (const pg of doc.pages) {
    for (const it of pg.items) {
      try {
        if (it.kind === 'watermark') {
          // full-page transparent PNG: optional image + rotated text, drawn with the page's own fonts
          const S = 2, c = document.createElement('canvas'); c.width = Math.round(it.w * S); c.height = Math.round(it.h * S);
          const g = c.getContext('2d');
          g.globalAlpha = it.opacity; g.translate(c.width / 2, c.height / 2); g.rotate(it.angle * Math.PI / 180);
          const lines = it.text ? String(it.text).split('\n') : [], fs = it.fs * S, lh = fs * 1.1;
          let imgH = 0, img = null;
          if (it.src) { img = await load(it.src); if (img) imgH = (it.w * it.imgPct / 100) * S * (img.naturalHeight / Math.max(1, img.naturalWidth)); }
          const gap = lines.length && img ? fs * 0.15 : 0, total = imgH + gap + lines.length * lh;
          let y = -total / 2;
          if (img) { const iw = (it.w * it.imgPct / 100) * S; g.drawImage(img, -iw / 2, y, iw, imgH); y += imgH + gap; }
          if (lines.length) {
            const font = (it.bold ? '700 ' : '400 ') + fs + 'px "' + it.fontFamily + '", "Noto Sans", "Noto Sans Tamil", "Noto Sans Sinhala", sans-serif';
            try { await document.fonts.load(font, it.text); } catch (e) { /* use what is there */ }
            g.font = font; g.fillStyle = it.color || '#c0392b'; g.textAlign = 'center'; g.textBaseline = 'middle';
            if ('letterSpacing' in g) g.letterSpacing = (fs * 0.04) + 'px';
            lines.forEach((l) => { g.fillText(l, 0, y + lh / 2); y += lh; });
          }
          it.png = c.toDataURL('image/png'); it.nw = 0; it.nh = 0; it.fit = 'stretch';
        } else if (it.kind === 'image' && it.src) {
          const img = await load(it.src);
          if (!img) continue;
          it.nw = img.naturalWidth || it.w; it.nh = img.naturalHeight || it.h;
          if (!/^data:image\/(png|jpe?g|gif)/i.test(it.src)) {
            const c = canvasFor(it.nw / SCALE, it.nh / SCALE); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); it.png = c.toDataURL('image/png');
          }
        } else if ((it.kind === 'barcode' || it.kind === 'qr') && it.svg) {
          const showText = it.showText, th = showText ? Math.min(it.h * 0.3, (Number(it.st.fontSize) || 8) * 1.4) : 0;
          const c = canvasFor(it.w, it.h), g = c.getContext('2d');
          if (it.st.bg) { g.fillStyle = it.st.bg; g.fillRect(0, 0, c.width, c.height); }
          // size only the outer <svg> tag (the bars inside keep their own width/height)
          const svg = it.svg.replace(/^<svg[^>]*>/, (tag) => tag.replace(/\s(width|height)="[^"]*"/g, '')
            .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(it.w * SCALE) + '" height="' + Math.round((it.h - th) * SCALE) + '" '));
          const img = await load('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
          if (img) g.drawImage(img, 0, 0, c.width, Math.round((it.h - th) * SCALE));
          if (showText) {
            g.fillStyle = it.st.color || '#000'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.font = ((Number(it.st.fontSize) || 8) * SCALE) + 'px "' + (it.st.fontFamily || 'Noto Sans') + '", sans-serif';
            g.fillText(it.value, c.width / 2, c.height - (th * SCALE) / 2);
          }
          it.png = c.toDataURL('image/png'); it.nw = 0; it.nh = 0; it.fit = 'stretch';
        } else if (it.raster) {
          const st = it.st || {}, c = canvasFor(it.w, it.h), g = c.getContext('2d'), W = c.width, H = c.height;
          const bw = (Number(it.kind === 'line' ? st.lineWidth || 1 : st.borderWidth) || 0) * SCALE;
          g.strokeStyle = (it.kind === 'line' ? st.color : st.borderColor) || '#000'; g.lineWidth = bw;
          if (it.kind === 'line') {
            if (st.dash === 'dashed') g.setLineDash([bw * 4, bw * 3]); else if (st.dash === 'dotted') g.setLineDash([bw, bw * 2]);
            g.beginPath();
            if (it.dir === 'd1') { g.moveTo(0, 0); g.lineTo(W, H); }
            else if (it.dir === 'd2') { g.moveTo(0, H); g.lineTo(W, 0); }
            else if (it.dir === 'v') { g.moveTo(W / 2, 0); g.lineTo(W / 2, H); }
            else { g.moveTo(0, H / 2); g.lineTo(W, H / 2); }
            g.stroke();
          } else {
            g.beginPath();
            if (it.kind === 'ellipse') g.ellipse(W / 2, H / 2, Math.max(1, W / 2 - bw / 2), Math.max(1, H / 2 - bw / 2), 0, 0, Math.PI * 2);
            else { const r = Math.min((Number(st.radius) || 0) * SCALE, W / 2, H / 2); g.roundRect(bw / 2, bw / 2, W - bw, H - bw, r); }
            if (st.bg) { g.fillStyle = st.bg; g.fill(); }
            if (bw > 0) g.stroke();
          }
          it.png = c.toDataURL('image/png'); it.nw = 0; it.nh = 0; it.fit = 'stretch';
        }
      } catch (e) { /* leave the item out of the Word file rather than fail the document */ }
    }
  }
  return doc;
};

async function renderInPage(payload, wantPdf, collect) {
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
      const r = await window.RptEngine.renderAsync(p.layout, p.data || {}, { maxPages: p.maxPages || 5000, collect: !!p.collect });
      document.getElementById('rpt-css').textContent = r.css;
      document.getElementById('out').innerHTML = r.html;
      document.title = p.name || p.code || 'report';
      await document.fonts.ready;
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map((i) => i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; })));
      if (p.collect) window.__rptDoc = r.doc;
      return { pageCount: r.pageCount, width: r.width, height: r.height, errors: r.errors };
    }, Object.assign({}, payload, { collect: !!collect }));
    if (collect) {
      const doc = await page.evaluate(`(${RASTERIZE.toString()})(window.__rptDoc)`);
      info.ms = Date.now() - t0;
      return { info, doc };
    }
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

/* ---------------------------------------------------------------- formats */
const office = require('./office');
const FORMATS = {
  pdf:  { ext: 'pdf',  mime: 'application/pdf' },
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
};
function normFormat(f) {
  f = String(f || 'pdf').toLowerCase();
  if (f === 'word' || f === 'doc') return 'docx';
  if (f === 'excel' || f === 'xls') return 'xlsx';
  return FORMATS[f] ? f : 'pdf';
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
      chromium: chromiumState, uptime: Math.round(process.uptime()), formats: Object.keys(FORMATS),
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
    const t0 = Date.now();
    try {
      if (!req.body || !req.body.layout) return res.status(400).json({ error: 'Body must contain layout and data' });
      const format = normFormat(req.body.format);
      const base = String(req.body.code || 'report').toLowerCase().replace(/[^a-z0-9_\-]/g, '_');
      let info, body;
      if (format === 'pdf') {
        const r = await renderInPage(req.body, true);
        info = r.info; body = Buffer.from(r.pdf);
      } else {
        const r = await renderInPage(req.body, false, true);
        info = r.info;
        const meta = { title: req.body.name || req.body.code || 'Report' };
        body = format === 'docx' ? await office.buildDocx(r.doc, meta) : await office.buildXlsx(r.doc, (req.body.data || {}), meta);
        info.ms = Date.now() - t0;
      }
      res.set({
        'Content-Type': FORMATS[format].mime, 'Content-Disposition': `inline; filename="${base}.${FORMATS[format].ext}"`,
        'X-Page-Count': String(info.pageCount), 'X-Render-Ms': String(info.ms), 'X-Format': format,
        'X-Render-Warnings': String(info.errors.length)
      });
      if (info.errors.length) console.warn(`[render] ${req.body.code || ''}: ${info.errors.slice(0, 5).join(' | ')}`);
      console.log(`[render] ${req.body.code || 'report'} ${format} ${info.pageCount} page(s) ${info.ms} ms`);
      res.end(body);
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
  let server;
  if (TLS) {
    const tls = process.env.TLS_PFX
      ? { pfx: fs.readFileSync(process.env.TLS_PFX), passphrase: process.env.TLS_PASSPHRASE || undefined }
      : { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY),
          ca: process.env.TLS_CA ? fs.readFileSync(process.env.TLS_CA) : undefined, passphrase: process.env.TLS_PASSPHRASE || undefined };
    tls.minVersion = 'TLSv1.2';
    server = require('https').createServer(tls, app);
    // the page the browser renders in is loaded over plain HTTP on the loopback interface only
    require('http').createServer(app).listen(INTERNAL_PORT, '127.0.0.1');
  } else {
    server = require('http').createServer(app);
  }
  server.listen(PORT, HOST, () => {
    console.log(`Report Studio render server on ${TLS ? 'https' : 'http'}://${HOST}:${PORT}  (engine ${require(ENGINE_PATH).VERSION}, ${MAX_PAGES} parallel)` +
      (TLS ? `, internal http://127.0.0.1:${INTERNAL_PORT}` : ''));
    if (API_KEY === 'change-me') console.warn('WARNING: set API_KEY (and RPT_CONFIG.RENDER_API_KEY) before production use');
    getBrowser().then(() => console.log('Chromium ready')).catch((e) => console.error('Chromium failed to start:', e.message));
  });
  const stop = async () => { try { (await browserPromise) && (await browserPromise).close(); } catch (e) { /* ignore */ } process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { createApp, renderInPage };
