// Smoke test: renders the sample reports and HR templates through a running server
// in every format and writes them to ./out
//   API_KEY=... node test.js                 (all formats)
//   TEST_FORMATS=pdf node test.js            (PDF only)
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../samples/samples.js');
let T = { reports: [] };
try { T = require('../samples/templates.js'); } catch (e) { /* templates are optional */ }

const URL = process.env.RENDER_URL || 'http://127.0.0.1:3900/render';
const KEY = process.env.API_KEY || 'change-me';
const FORMATS = (process.env.TEST_FORMATS || 'pdf,docx,xlsx').split(',').map((f) => f.trim()).filter(Boolean);

(async () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  for (const r of S.reports.concat(T.reports)) {
    const data = { sources: {}, params: {}, user: 'TEST', assets: { LOGO: S.logoDataUri } };
    for (const s of r.sources) { data.sources[s.name] = r.mock(s.name, s.params || {}); Object.assign(data.params, s.params || {}); }
    for (const format of FORMATS) {
      const t0 = Date.now();
      const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY },
        body: JSON.stringify({ code: r.report.code, name: r.report.name, layout: r.layout, data, format }) });
      if (!res.ok) { console.error(r.report.code, format, res.status, await res.text()); process.exitCode = 1; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const file = path.join(__dirname, 'out', r.report.code.toLowerCase() + '.' + format);
      fs.writeFileSync(file, buf);
      console.log(`${r.report.code} ${format}: ${res.headers.get('x-page-count')} page(s), ${buf.length} bytes, ${Date.now() - t0} ms -> ${file}`);
    }
  }
})();
