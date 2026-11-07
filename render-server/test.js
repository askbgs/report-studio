// Smoke test: renders the two sample reports through a running server and writes PDFs to ./out
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../samples/samples.js');

const URL = process.env.RENDER_URL || 'http://127.0.0.1:3900/render';
const KEY = process.env.API_KEY || 'change-me';

(async () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  for (const r of S.reports) {
    const data = { sources: {}, params: {}, user: 'TEST', assets: { LOGO: S.logoDataUri } };
    for (const s of r.sources) { data.sources[s.name] = r.mock(s.name, s.params); Object.assign(data.params, s.params); }
    const t0 = Date.now();
    const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ code: r.report.code, name: r.report.name, layout: r.layout, data }) });
    if (!res.ok) { console.error(r.report.code, res.status, await res.text()); process.exitCode = 1; continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const file = path.join(__dirname, 'out', r.report.code.toLowerCase() + '.pdf');
    fs.writeFileSync(file, buf);
    console.log(`${r.report.code}: ${res.headers.get('x-page-count')} page(s), ${buf.length} bytes, ${Date.now() - t0} ms -> ${file}`);
  }
})();
