/* Offline mock of the RPT_AJAX back end (demo / testing only). Mirrors rpt_designer.ajax actions. */
(function (global) {
  'use strict';
  var S = global.RptSamples, KEY = 'report-studio-demo-v1';
  var db = null;
  function seed() {
    var d = { seq: 10, reports: {}, sources: {}, versions: {}, assets: { LOGO: { mime: 'image/svg+xml', fileName: 'logo.svg', dataUri: S.logoDataUri } } };
    S.reports.forEach(function (r, i) {
      var id = i + 1;
      d.reports[id] = { id: id, code: r.report.code, name: r.report.name, description: r.report.description, status: r.report.status, versionNo: 1, layout: JSON.parse(JSON.stringify(r.layout)) };
      d.sources[id] = r.sources.map(function (s) { return { name: s.name, sql: s.sql, params: s.params }; });
      d.versions[id] = [];
    });
    return d;
  }
  function load() {
    if (db) return db;
    try { db = JSON.parse(global.localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db) db = seed();
    return db;
  }
  function persist() { try { global.localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage unavailable */ } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sampleFor(name, sql) {
    for (var i = 0; i < S.reports.length; i++) {
      var r = S.reports[i];
      for (var j = 0; j < r.sources.length; j++) if (r.sources[j].name === String(name).toUpperCase() || r.sources[j].sql === sql) return { r: r, s: r.sources[j] };
    }
    return null;
  }
  function guessColumns(sql) {
    var m = /select([\s\S]*?)\bfrom\b/i.exec(sql || '');
    if (!m) return [];
    return m[1].split(',').map(function (p) {
      p = p.trim(); var a = /(?:\bas\s+)?([A-Za-z_][A-Za-z0-9_$#]*)\s*$/i.exec(p);
      return a ? { name: a[1].toUpperCase(), type: 'VARCHAR2' } : null;
    }).filter(Boolean);
  }
  function binds(sql) {
    var out = [], re = /:([A-Za-z][A-Za-z0-9_$#]*)/g, m, code = String(sql || '').replace(/'([^']|'')*'/g, "''");
    while ((m = re.exec(code))) if (out.indexOf(m[1].toUpperCase()) < 0) out.push(m[1].toUpperCase());
    return out;
  }
  function assetList() {
    return Object.keys(db.assets).sort().map(function (c) { return { code: c, mime: db.assets[c].mime, fileName: db.assets[c].fileName }; });
  }

  var actions = {
    LOAD: function (id) {
      var r = id && db.reports[id];
      return { report: r ? clone(r) : null, sources: r ? clone(db.sources[id]) : [], assets: assetList(), user: 'DEMO' };
    },
    SAVE: function (id, p) {
      if (!p.report.code) throw new Error('Report code is required');
      var dup = Object.keys(db.reports).filter(function (k) { return db.reports[k].code === p.report.code && String(k) !== String(id); });
      if (dup.length) throw new Error('Another report already uses code ' + p.report.code);
      if (!id) { id = ++db.seq; db.reports[id] = { id: id, versionNo: 0 }; db.versions[id] = []; }
      var r = db.reports[id];
      r.code = p.report.code; r.name = p.report.name; r.description = p.report.description; r.status = p.report.status;
      r.layout = p.layout; r.versionNo++;
      db.sources[id] = p.sources;
      db.versions[id].unshift({ versionId: id * 1000 + r.versionNo, versionNo: r.versionNo, savedBy: 'DEMO', savedOn: new Date().toISOString().slice(0, 19), layout: p.layout, sources: p.sources });
      persist();
      return { id: id, versionNo: r.versionNo, ok: true };
    },
    DESCRIBE: function (id, p) {
      if (!/^\s*(select|with)\b/i.test(p.sql || '')) throw new Error('Only SELECT or WITH queries are allowed');
      var sm = sampleFor('', p.sql);
      var cols = sm ? sm.r.mock(sm.s.name, sm.s.params).columns : guessColumns(p.sql);
      return { columns: cols, binds: binds(p.sql) };
    },
    PREVIEW_DATA: function (id, p) {
      var out = { sources: {}, params: {}, user: 'DEMO' };
      (p.sources || []).forEach(function (s) {
        var sm = sampleFor(s.name, s.sql);
        var params = {};
        Object.keys(s.params || {}).forEach(function (k) { params[k.toUpperCase()] = s.params[k]; });
        Object.keys(p.params || {}).forEach(function (k) { params[k.replace(/^:/, '').toUpperCase()] = p.params[k]; });
        Object.keys(params).forEach(function (k) { out.params[k] = params[k]; });
        out.sources[s.name.toUpperCase()] = sm ? sm.r.mock(sm.s.name, params)
          : { columns: guessColumns(s.sql), rows: [], error: s.name + ': demo mode only returns data for the sample queries' };
      });
      return out;
    },
    ASSETS: function () { return { assets: assetList() }; },
    ASSET_GET: function (id, p) { var a = db.assets[String(p.code).toUpperCase()]; return { code: p.code, dataUri: a ? a.dataUri : null }; },
    ASSET_SAVE: function (id, p) { db.assets[p.code] = { mime: p.mime, fileName: p.fileName, dataUri: 'data:' + p.mime + ';base64,' + p.base64 }; persist(); return { ok: true, assets: assetList() }; },
    ASSET_DELETE: function (id, p) { delete db.assets[p.code]; persist(); return { ok: true, assets: assetList() }; },
    EXPORT: function (id) {
      var r = db.reports[id];
      var used = [];
      r.layout.bands.forEach(function (b) { b.elements.forEach(function (e) { if (e.type === 'image' && db.assets[e.src]) used.push(e.src); }); });
      return { format: 'report-studio', formatVersion: 1, exportedOn: new Date().toISOString().slice(0, 19), report: clone(r), sources: clone(db.sources[id]),
        assets: used.map(function (c) { var a = db.assets[c]; return { code: c, mime: a.mime, fileName: a.fileName, base64: a.dataUri.split(',')[1] }; }) };
    },
    IMPORT: function (id, p) {
      var b = p.bundle || p;
      if (b.format !== 'report-studio') throw new Error('Not a Report Studio export file');
      (b.assets || []).forEach(function (a) { db.assets[a.code] = { mime: a.mime, fileName: a.fileName, dataUri: 'data:' + a.mime + ';base64,' + a.base64 }; });
      var code = (p.newCode || b.report.code).toUpperCase();
      var existing = Object.keys(db.reports).filter(function (k) { return db.reports[k].code === code; })[0];
      return actions.SAVE(existing ? Number(existing) : null, { report: { code: code, name: b.report.name, description: b.report.description, status: 'DRAFT' }, layout: b.report.layout, sources: b.sources });
    },
    VERSIONS: function (id) { return { versions: (db.versions[id] || []).map(function (v) { return { versionId: v.versionId, versionNo: v.versionNo, savedBy: v.savedBy, savedOn: v.savedOn }; }) }; },
    VERSION_GET: function (id, p) { var v = (db.versions[id] || []).filter(function (x) { return x.versionId === p.versionId; })[0]; return v ? clone(v) : {}; },
    DELETE: function (id) { delete db.reports[id]; persist(); return { ok: true }; },
    SERVER_STATUS: function () {
      if (global.RptMock.serverDown) return { ok: false, url: 'http://localhost:3900/render', healthUrl: 'http://localhost:3900/health', ms: 2,
        error: 'ORA-29273: HTTP request failed ORA-12541: Cannot connect. No listener at host localhost port 3900.',
        hint: 'Nothing is listening there: start the render server (nssm start ReportStudioRender). If it runs on another machine, start it with HOST=0.0.0.0 and open the port.', checkedBy: 'DEMO' };
      return { ok: true, url: 'demo (browser rendering)', healthUrl: '-', httpStatus: 200, ms: 7 + Math.round(Math.random() * 20),
        engine: global.RptEngine.VERSION, apiKey: 'valid', chromium: 'ready', active: 0, queued: 0, uptime: 5400, checkedBy: 'DEMO' };
    }
  };

  global.RptMock = {
    reset: function () { try { global.localStorage.removeItem(KEY); } catch (e) { /* ignore */ } db = seed(); },
    list: function () { load(); return Object.keys(db.reports).map(function (k) { return { id: Number(k), code: db.reports[k].code, name: db.reports[k].name }; }); },
    ajax: function (action, id, payload) {
      load();
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try {
            var fn = actions[action];
            if (!fn) throw new Error('Unknown action ' + action);
            resolve(clone(fn(id ? Number(id) : null, payload || {})));
          } catch (e) { reject(e); }
        }, 60);
      });
    },
    // stand-in for apex.server.process('RPT_RUN', {x01:'PAYLOAD'}) so RptPrint works offline
    payload: function (code, params) {
      load();
      var id = Object.keys(db.reports).filter(function (k) { return db.reports[k].code === code; })[0];
      if (!id) return Promise.reject(new Error('Report ' + code + ' does not exist'));
      var r = db.reports[id];
      return actions.PREVIEW_DATA(id, { sources: db.sources[id] }) && Promise.resolve({
        code: code, name: r.name, layout: clone(r.layout),
        data: (function () { var d = actions.PREVIEW_DATA(id, { sources: db.sources[id], params: params }); d.assets = {}; Object.keys(db.assets).forEach(function (c) { d.assets[c] = db.assets[c].dataUri; }); return d; })()
      });
    }
  };
})(window);
