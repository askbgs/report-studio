/*!
 * Report Studio for Oracle APEX - visual report designer
 * Requires rpt-engine.js. Uses apex.server.process('RPT_AJAX') unless an `ajax` option is given.
 *
 *   RptDesigner.init({ el: '#rpt-designer', reportId: apex.item('P2_REPORT_ID').getValue(),
 *                      reportItem: 'P2_REPORT_ID', listUrl: '...' });
 */
(function (global) {
  'use strict';
  var E = global.RptEngine;
  if (!E) throw new Error('RptDesigner: load rpt-engine.js first');
  var PX_PER_PT = 96 / 72;
  var esc = E.esc;

  /* ------------------------------------------------------------- icons */
  var IC = {
    save: 'M3 2h8l3 3v9H2V2zm2 0v4h6V2M4 14v-4h8v4',
    undo: 'M5 4L2 7l3 3M2 7h8a4 4 0 0 1 0 8H7',
    redo: 'M11 4l3 3-3 3M14 7H6a4 4 0 0 0 0 8h3',
    copy: 'M5 5h9v9H5zM2 11V2h9',
    paste: 'M5 3H3v11h10V3h-2M6 2h4v3H6z',
    dup: 'M2 2h8v8H2zM6 6h8v8H6z',
    del: 'M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10',
    al: 'M2 1v14M5 4h9v3H5zM5 9h6v3H5z', ac: 'M8 1v14M3 4h10v3H3zM5 9h6v3H5z', ar: 'M14 1v14M2 4h9v3H2zM5 9h6v3H5z',
    at: 'M1 2h14M4 5h3v9H4zM9 5h3v6H9z', am: 'M1 8h14M4 3h3v10H4zM9 5h3v6H9z', ab: 'M1 14h14M4 2h3v9H4zM9 5h3v6H9z',
    front: 'M2 2h8v8H2zM6 6h8v8H6z', grid: 'M1 1h14v14H1zM1 6h14M1 11h14M6 1v14M11 1v14',
    zin: 'M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2zM11 11l4 4M5 7h4M7 5v4', zout: 'M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2zM11 11l4 4M5 7h4',
    eye: 'M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    pdf: 'M3 1h7l3 3v11H3zM10 1v3h3M5 9h6M5 12h6M5 6h3',
    exp: 'M8 1v9M4 6l4 4 4-4M2 12v3h12v-3', imp: 'M8 10V1M4 5l4-4 4 4M2 12v3h12v-3',
    hist: 'M8 2a6 6 0 1 1-6 6M2 3v5h5M8 5v3l2 2', list: 'M2 3h12M2 8h12M2 13h12',
    print: 'M4 6V1h8v5M4 12H2V6h12v6h-2M4 9h8v6H4z', close: 'M3 3l10 10M13 3L3 13', plus: 'M8 2v12M2 8h12',
    edit: 'M2 14l1-4 8-8 3 3-8 8zM10 3l3 3', up: 'M8 13V3M4 7l4-4 4 4', down: 'M8 3v10M4 9l4 4 4-4', gear: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3'
  };
  function icon(n) { return '<svg class="rs-ic" viewBox="0 0 16 16" aria-hidden="true"><path d="' + IC[n] + '"/></svg>'; }

  var PALETTE = [
    { type: 'text', label: 'Text', ic: 'T' },
    { type: 'field', label: 'Field', ic: '{ }' },
    { type: 'line', label: 'Line', ic: '—' },
    { type: 'rect', label: 'Box', ic: '▭' },
    { type: 'ellipse', label: 'Ellipse', ic: '◯' },
    { type: 'image', label: 'Image', ic: '▣' },
    { type: 'table', label: 'Table', ic: '▦' },
    { type: 'barcode', label: 'Barcode', ic: '▮▯▮' }
  ];
  var SYSTEM_TOKENS = [
    ['{{PAGE}}', 'Page number'], ['{{PAGES}}', 'Page count'], ['Page {{PAGE}} of {{PAGES}}', 'Page X of Y'],
    ['{{TODAY|DD-MON-YYYY}}', 'Today'], ['{{NOW|DD-MON-YYYY HH24:MI}}', 'Now'], ['{{APP_USER}}', 'User'],
    ['{{ROWNUM}}', 'Row number'], ['{{COUNT()}}', 'Row count']
  ];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function h(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function round(v, d) { var p = Math.pow(10, d == null ? 2 : d); return Math.round(v * p) / p; }
  function num(v, d) { v = parseFloat(v); return isNaN(v) ? (d === undefined ? 0 : d) : v; }

  function apexAjax(process) {
    return function (action, reportId, payload) {
      return new Promise(function (resolve, reject) {
        global.apex.server.process(process, {
          x01: action, x02: reportId == null ? '' : String(reportId), p_clob_01: JSON.stringify(payload || {})
        }, { dataType: 'text' })
          .done(function (txt) {
            if (txt == null || String(txt).trim() === '') {
              reject(new Error(process + ' returned an empty response. Check that the application process "' + process +
                '" exists (Ajax Callback) and that its authorization scheme passes for this user.'));
              return;
            }
            var r;
            try { r = JSON.parse(txt); } catch (e) {
              reject(new Error(process + ' did not return JSON: ' + String(txt).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)));
              return;
            }
            if (r && r.error) reject(new Error(r.error)); else resolve(r);
          })
          .fail(function (jq, st, err) { reject(new Error(process + ': ' + (err || st || 'request failed'))); });
      });
    };
  }

  /* ================================================================= */
  function Designer(opts) {
    this.o = opts || {};
    this.root = typeof this.o.el === 'string' ? $(this.o.el) : this.o.el;
    if (!this.root) throw new Error('RptDesigner: element not found');
    this.ajax = this.o.ajax || apexAjax(this.o.process || 'RPT_AJAX');
    this.report = { id: this.o.reportId ? Number(this.o.reportId) : null, code: '', name: 'New report', description: '', status: 'DRAFT' };
    this.layout = E.newLayout();
    this.sources = [];
    this.assets = [];
    this.assetData = {};
    this.sel = [];
    this.selBand = null;
    this.zoom = 1;
    this.snap = true;
    this.showGrid = true;
    this.grid = 5;
    this.history = [];
    this.future = [];
    this.dirty = false;
    this.leftTab = 'elements';
    this.clip = null;
    this.build();
    this.load();
  }

  var D = Designer.prototype;

  /* --------------------------------------------------------- skeleton */
  D.build = function () {
    var self = this;
    this.root.classList.add('rs-root');
    if (this.o.height) this.root.style.height = this.o.height;
    var tb = function (cmd, ic, title, label) {
      return '<button type="button" class="rs-tb" data-cmd="' + cmd + '" title="' + esc(title) + '">' + icon(ic) + (label ? '<span>' + esc(label) + '</span>' : '') + '</button>';
    };
    this.root.innerHTML =
      '<div class="rs-toolbar">' +
        (this.o.listUrl ? tb('list', 'list', 'Back to reports') : '') +
        '<div class="rs-title"><b class="rs-r-name"></b><span class="rs-r-code"></span></div>' +
        tb('save', 'save', 'Save (Ctrl+S)', 'Save') +
        '<span class="rs-sep"></span>' + tb('undo', 'undo', 'Undo (Ctrl+Z)') + tb('redo', 'redo', 'Redo (Ctrl+Y)') +
        '<span class="rs-sep"></span>' + tb('copy', 'copy', 'Copy (Ctrl+C)') + tb('paste', 'paste', 'Paste (Ctrl+V)') +
        tb('dup', 'dup', 'Duplicate (Ctrl+D)') + tb('delete', 'del', 'Delete (Del)') +
        '<span class="rs-sep"></span>' + tb('al', 'al', 'Align left') + tb('ac', 'ac', 'Align centre') + tb('ar', 'ar', 'Align right') +
        tb('at', 'at', 'Align top') + tb('am', 'am', 'Align middle') + tb('ab', 'ab', 'Align bottom') +
        tb('front', 'front', 'Bring to front (Shift = send to back)') +
        '<span class="rs-sep"></span>' + tb('grid', 'grid', 'Toggle grid & snap') +
        tb('zout', 'zout', 'Zoom out') + '<span class="rs-zoom">100%</span>' + tb('zin', 'zin', 'Zoom in') +
        '<span class="rs-sep"></span>' + tb('preview', 'eye', 'Preview with data', 'Preview') +
        (this.o.serverPdf !== false ? tb('pdf', 'pdf', 'Generate PDF on the server (saved version)', 'PDF') : '') +
        (this.o.serverStatus !== false ? '<button type="button" class="rs-srv rs-srv-unknown" data-cmd="server" title="Render server – click for details"><i></i><span>Render server</span></button>' : '') +
        '<span class="rs-grow"></span>' +
        tb('versions', 'hist', 'Version history') + tb('export', 'exp', 'Export report (.json)') + tb('import', 'imp', 'Import report (.json)') +
      '</div>' +
      '<div class="rs-main">' +
        '<aside class="rs-left"><div class="rs-tabs">' +
          '<button type="button" data-tab="elements">Elements</button><button type="button" data-tab="data">Data</button><button type="button" data-tab="images">Images</button>' +
        '</div><div class="rs-left-body"></div></aside>' +
        '<section class="rs-center"><div class="rs-scroll"><div class="rs-canvas-wrap"><div class="rs-canvas"></div></div></div></section>' +
        '<aside class="rs-right"><div class="rs-props"></div></aside>' +
      '</div>' +
      '<div class="rs-status"><span class="rs-st-msg">Loading…</span><span class="rs-grow"></span><span class="rs-st-pos"></span><span class="rs-st-ver"></span></div>' +
      '<div class="rs-toast-host"></div>';

    this.canvas = $('.rs-canvas', this.root);
    this.wrap = $('.rs-canvas-wrap', this.root);
    this.scroller = $('.rs-scroll', this.root);

    $('.rs-toolbar', this.root).addEventListener('click', function (e) {
      var b = e.target.closest('[data-cmd]');
      if (b) self.cmd(b.getAttribute('data-cmd'), e);
    });
    $('.rs-tabs', this.root).addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) { self.leftTab = b.getAttribute('data-tab'); self.renderLeft(); }
    });
    this.bindCanvas();
    this.bindKeys();
    global.addEventListener('beforeunload', function (e) {
      if (self.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  };

  /* ------------------------------------------------------------- load */
  D.load = function () {
    var self = this;
    this.status('Loading…');
    return this.ajax('LOAD', this.report.id, {}).then(function (r) {
      self.assets = r.assets || [];
      if (r.report) {
        self.report = { id: r.report.id, code: r.report.code, name: r.report.name, description: r.report.description || '',
          status: r.report.status || 'DRAFT', versionNo: r.report.versionNo };
        self.layout = E.normalizeLayout(r.report.layout || E.newLayout());
      } else {
        self.layout = E.newLayout();
      }
      self.sources = (r.sources || []).map(function (s) { return { name: s.name, sql: s.sql, params: s.params || {}, columns: [], binds: [] }; });
      self.history = []; self.future = []; self.dirty = false;
      self.renderAll();
      self.status(r.report ? 'Loaded ' + r.report.code : 'New report – set a code and name in Report properties, then save');
      self.describeAll();
      self.loadAssetData(self.usedAssets());
      self.startServerChecks();
    }).catch(function (err) { self.status('Error: ' + err.message); self.toast(err.message, 'error'); self.renderAll(); });
  };

  D.describeAll = function () {
    var self = this;
    this.sources.forEach(function (s) {
      self.ajax('DESCRIBE', self.report.id, { sql: s.sql }).then(function (r) {
        s.columns = r.columns || []; s.binds = r.binds || []; s.error = null;
        if (self.leftTab === 'data') self.renderLeft();
        self.renderProps();
      }).catch(function (err) { s.error = err.message; if (self.leftTab === 'data') self.renderLeft(); });
    });
  };

  D.usedAssets = function () {
    var out = {};
    this.layout.bands.forEach(function (b) { b.elements.forEach(function (e) { if (e.type === 'image' && e.src && e.src.indexOf('{{') < 0) out[String(e.src).toUpperCase()] = 1; }); });
    return Object.keys(out);
  };
  D.loadAssetData = function (codes) {
    var self = this;
    var need = codes.filter(function (c) { return !self.assetData[c] && self.assets.some(function (a) { return a.code === c; }); });
    return Promise.all(need.map(function (c) {
      return self.ajax('ASSET_GET', self.report.id, { code: c }).then(function (r) { if (r.dataUri) self.assetData[c] = r.dataUri; });
    })).then(function () { if (need.length) { self.renderCanvas(); if (self.leftTab === 'images') self.renderLeft(); } });
  };

  /* ---------------------------------------------------------- history */
  D.snapshot = function () {
    return JSON.stringify({ layout: this.layout, sources: this.sources.map(function (s) { return { name: s.name, sql: s.sql, params: s.params, columns: s.columns, binds: s.binds }; }) });
  };
  D.checkpoint = function () {
    this.history.push(this.snapshot());
    if (this.history.length > 150) this.history.shift();
    this.future = [];
    this.setDirty(true);
  };
  D.restore = function (snap) {
    var o = JSON.parse(snap);
    this.layout = E.normalizeLayout(o.layout);
    this.sources = o.sources;
    var ids = this.allElements().map(function (x) { return x.el.id; });
    this.sel = this.sel.filter(function (id) { return ids.indexOf(id) >= 0; });
    this.renderAll();
  };
  D.undo = function () {
    if (!this.history.length) return;
    this.future.push(this.snapshot());
    this.restore(this.history.pop());
    this.setDirty(true);
  };
  D.redo = function () {
    if (!this.future.length) return;
    this.history.push(this.snapshot());
    this.restore(this.future.pop());
    this.setDirty(true);
  };
  D.setDirty = function (v) {
    this.dirty = v;
    this.root.classList.toggle('rs-dirty', v);
    var s = $('.rs-st-ver', this.root);
    if (s) s.textContent = (v ? '● unsaved changes' : '') + (this.report.versionNo ? '  v' + this.report.versionNo : '');
  };

  /* --------------------------------------------------------- lookup */
  D.allElements = function () {
    var out = [];
    this.layout.bands.forEach(function (b) { b.elements.forEach(function (e) { out.push({ el: e, band: b }); }); });
    return out;
  };
  D.find = function (id) {
    for (var i = 0; i < this.layout.bands.length; i++) {
      var b = this.layout.bands[i];
      for (var j = 0; j < b.elements.length; j++) if (b.elements[j].id === id) return { el: b.elements[j], band: b, index: j };
    }
    return null;
  };
  D.band = function (id) { return this.layout.bands.filter(function (b) { return b.id === id; })[0]; };
  D.selected = function () { var self = this; return this.sel.map(function (id) { return self.find(id); }).filter(Boolean); };
  D.source = function (name) {
    name = String(name || '').toUpperCase();
    return this.sources.filter(function (s) { return s.name.toUpperCase() === name; })[0];
  };
  D.unit = function () { return this.layout.page.unit || 'mm'; };
  D.toU = function (pt) { return round(E.ptToUnit(pt, this.unit()), this.unit() === 'pt' ? 1 : 2); };
  D.fromU = function (v) { return E.unitToPt(v, this.unit()); };
  D.scale = function () { return this.zoom * PX_PER_PT; };
  D.snapV = function (v) { return this.snap ? Math.round(v / this.grid) * this.grid : round(v, 2); };

  /* ------------------------------------------------------------ render */
  D.renderAll = function () {
    $('.rs-r-name', this.root).textContent = this.report.name || 'Untitled';
    $('.rs-r-code', this.root).textContent = this.report.code ? ' · ' + this.report.code : '';
    this.renderCanvas();
    this.renderLeft();
    this.renderProps();
    this.setDirty(this.dirty);
  };

  D.renderCanvas = function () {
    var self = this, L = this.layout, P = L.page, cw = E.contentWidth(L);
    var html = '';
    L.bands.forEach(function (b) {
      var label = E.BAND_LABELS[b.type] + (b.type.indexOf('group') === 0 ? ' ' + (b.group + 1) + (L.groups[b.group] && L.groups[b.group].field ? ': ' + L.groups[b.group].field : '') : '');
      if (b.type === 'detail' && L.detailSource) label += ' · ' + L.detailSource;
      var extra = [];
      if (b.printOn && b.printOn !== 'all') extra.push(b.printOn === 'first' ? 'first page' : 'not first page');
      if (b.printWhen) extra.push('when ' + b.printWhen);
      html += '<div class="rs-band rs-band-' + b.type + (self.selBand === b.id && !self.sel.length ? ' rs-band-sel' : '') + '" data-band="' + b.id + '">' +
        '<div class="rs-band-head" style="padding-left:' + P.margin.left + 'pt"><span>' + esc(label) + '</span><em>' + self.toU(b.height) + ' ' + self.unit() + (extra.length ? ' · ' + esc(extra.join(', ')) : '') + '</em></div>' +
        '<div class="rs-band-body' + (self.showGrid ? ' rs-gridbg' : '') + '" style="margin-left:' + P.margin.left + 'pt;width:' + cw + 'pt;height:' + b.height + 'pt;background-size:' + self.grid + 'pt ' + self.grid + 'pt">' +
          b.elements.map(function (e, i) { return self.elHtml(e, i); }).join('') +
        '</div><div class="rs-band-resize" title="Drag to resize band"></div></div>';
    });
    this.canvas.style.width = P.width + 'pt';
    this.canvas.innerHTML = '<div class="rs-margin-top" style="height:' + Math.min(P.margin.top, 40) + 'pt"></div>' + html +
      '<div class="rs-margin-top" style="height:' + Math.min(P.margin.bottom, 40) + 'pt"></div>';
    this.applyZoom();
  };

  D.elHtml = function (e, i) {
    var sel = this.sel.indexOf(e.id) >= 0, single = sel && this.sel.length === 1;
    var hgt = e.type === 'table' ? E.tableDesignHeight(e) : num(e.h, 10);
    var cls = 'rs-el rs-el-' + e.type + (sel ? ' rs-sel' : '') + (sel && this.sel[0] === e.id ? ' rs-primary' : '') + (e.printWhen ? ' rs-cond' : '');
    var handles = single ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(function (d) { return '<i class="rs-h rs-h-' + d + '" data-h="' + d + '"></i>'; }).join('') : '';
    return '<div class="' + cls + '" data-id="' + e.id + '" style="left:' + num(e.x) + 'pt;top:' + num(e.y) + 'pt;width:' + num(e.w, 10) + 'pt;height:' + hgt + 'pt;z-index:' + (i + 1) + '">' +
      E.designHtml(e, this.layout.defaults, this.assetData) + handles + '</div>';
  };

  D.applyZoom = function () {
    var s = this.zoom;
    this.canvas.style.transform = 'scale(' + s + ')';
    var r = this.canvas.getBoundingClientRect();
    this.wrap.style.width = r.width + 'px';
    this.wrap.style.height = r.height + 'px';
    $('.rs-zoom', this.root).textContent = Math.round(s * 100) + '%';
  };

  D.status = function (msg) { var s = $('.rs-st-msg', this.root); if (s) s.textContent = msg; };
  // Notifications appear at the top of the designer, just under the toolbar
  D.toast = function (msg, type) {
    type = type || 'info';
    var host = $('.rs-toast-host', this.root), bar = $('.rs-toolbar', this.root);
    host.style.top = (bar ? bar.offsetHeight + 8 : 8) + 'px';
    var glyph = { ok: '✓', error: '!', warn: '!', info: 'i' }[type] || 'i';
    var t = h('<div class="rs-toast rs-toast-' + type + '" role="' + (type === 'error' ? 'alert' : 'status') + '">' +
      '<b class="rs-toast-ic">' + glyph + '</b><span class="rs-toast-msg">' + esc(msg) + '</span>' +
      '<button type="button" class="rs-toast-x" title="Dismiss">' + icon('close') + '</button></div>');
    var gone = false;
    var close = function () { if (gone) return; gone = true; t.classList.add('rs-out'); setTimeout(function () { t.remove(); }, 300); };
    $('.rs-toast-x', t).addEventListener('click', close);
    while (host.children.length >= 4) host.removeChild(host.firstChild);
    host.appendChild(t);
    var ms = type === 'error' ? 9000 : type === 'warn' ? 6000 : 3000, timer = setTimeout(close, ms);
    t.addEventListener('mouseenter', function () { clearTimeout(timer); });
    t.addEventListener('mouseleave', function () { timer = setTimeout(close, 2500); });
    return close;
  };

  /* ------------------------------------------------------- left panel */
  D.renderLeft = function () {
    var self = this, body = $('.rs-left-body', this.root);
    $$('.rs-tabs button', this.root).forEach(function (b) { b.classList.toggle('rs-active', b.getAttribute('data-tab') === self.leftTab); });
    if (this.leftTab === 'elements') {
      body.innerHTML = '<div class="rs-hint">Drag onto a band, or click to add to the selected band.</div><div class="rs-palette">' +
        PALETTE.map(function (p) { return '<div class="rs-pal" draggable="true" data-new="' + p.type + '"><b>' + esc(p.ic) + '</b>' + esc(p.label) + '</div>'; }).join('') +
        '</div><h4>System fields</h4><div class="rs-fields">' +
        SYSTEM_TOKENS.map(function (t) { return '<div class="rs-field" draggable="true" data-token="' + esc(t[0]) + '" title="' + esc(t[0]) + '">' + esc(t[1]) + '</div>'; }).join('') +
        '</div><h4>Keyboard</h4><div class="rs-hint">Arrows move (Shift = 10pt) · Del deletes · Ctrl+C/V/D · Ctrl+Z/Y · Ctrl+A selects band · Shift+click adds to selection · drag on empty band area to lasso.</div>';
    } else if (this.leftTab === 'data') {
      body.innerHTML = '<button type="button" class="rs-btn rs-btn-primary rs-wide" data-act="add-source">' + icon('plus') + ' Add data source</button>' +
        (this.sources.length ? '' : '<div class="rs-hint">A data source is a SQL query. Its columns become fields you can drag onto the report. Bind variables (:P1_ID) come from page items or parameters.</div>') +
        this.sources.map(function (s, i) {
          var det = self.layout.detailSource && self.layout.detailSource.toUpperCase() === s.name.toUpperCase();
          return '<div class="rs-src"><div class="rs-src-head"><b>' + esc(s.name) + '</b>' + (det ? '<span class="rs-tag">detail</span>' : '') +
            '<span class="rs-grow"></span><button type="button" class="rs-ib" data-act="edit-source" data-i="' + i + '" title="Edit">' + icon('edit') + '</button>' +
            '<button type="button" class="rs-ib" data-act="del-source" data-i="' + i + '" title="Delete">' + icon('del') + '</button></div>' +
            (s.error ? '<div class="rs-err">' + esc(s.error) + '</div>' : '') +
            '<div class="rs-fields">' + (s.columns || []).map(function (c) {
              return '<div class="rs-field rs-ft-' + esc(c.type) + '" draggable="true" data-src="' + esc(s.name) + '" data-col="' + esc(c.name) + '" data-type="' + esc(c.type) + '" title="' + esc(c.type) + '">' + esc(c.name) + '</div>';
            }).join('') + '</div>' +
            (s.binds && s.binds.length ? '<div class="rs-binds">Binds: ' + s.binds.map(function (b) { return ':' + esc(b); }).join(', ') + '</div>' : '') +
            '</div>';
        }).join('');
    } else {
      body.innerHTML = '<label class="rs-btn rs-btn-primary rs-wide">' + icon('plus') + ' Upload image<input type="file" accept="image/*" class="rs-file" hidden></label>' +
        '<div class="rs-hint">Images are shared by all reports and referenced by code. Click an image to use it in the selected image element.</div><div class="rs-assets">' +
        this.assets.map(function (a) {
          var d = self.assetData[a.code];
          return '<div class="rs-asset" data-code="' + esc(a.code) + '"><div class="rs-thumb">' + (d ? '<img src="' + esc(d) + '" alt="">' : '<span>…</span>') + '</div>' +
            '<div class="rs-asset-foot"><span title="' + esc(a.fileName || '') + '">' + esc(a.code) + '</span><button type="button" class="rs-ib" data-act="del-asset" data-code="' + esc(a.code) + '" title="Delete">' + icon('del') + '</button></div></div>';
        }).join('') + '</div>';
      this.loadAssetData(this.assets.map(function (a) { return a.code; }));
      var fi = $('.rs-file', body);
      fi.addEventListener('change', function () { if (fi.files[0]) self.uploadAsset(fi.files[0]); fi.value = ''; });
    }
    if (!body._bound) {
      body._bound = true;
      body.addEventListener('click', function (e) {
        var pal = e.target.closest('[data-new]');
        if (pal) { self.addElement(pal.getAttribute('data-new')); return; }
        var a = e.target.closest('[data-act]');
        if (a) {
          var act = a.getAttribute('data-act'), i = +a.getAttribute('data-i');
          if (act === 'add-source') self.editSource(-1);
          if (act === 'edit-source') self.editSource(i);
          if (act === 'del-source') self.deleteSource(i);
          if (act === 'del-asset') { e.stopPropagation(); self.deleteAsset(a.getAttribute('data-code')); }
          return;
        }
        var as = e.target.closest('.rs-asset');
        if (as) self.useAsset(as.getAttribute('data-code'));
      });
      body.addEventListener('dragstart', function (e) {
        var t = e.target.closest('[draggable]');
        if (!t) return;
        var payload;
        if (t.hasAttribute('data-new')) payload = { kind: 'new', type: t.getAttribute('data-new') };
        else if (t.hasAttribute('data-token')) payload = { kind: 'token', token: t.getAttribute('data-token') };
        else payload = { kind: 'field', src: t.getAttribute('data-src'), col: t.getAttribute('data-col'), type: t.getAttribute('data-type') };
        self.dragPayload = payload;
        e.dataTransfer.setData('text/plain', JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'copy';
      });
    }
  };

  /* ------------------------------------------------------ add element */
  D.targetBand = function () {
    var b = this.selBand && this.band(this.selBand);
    if (!b && this.sel.length) { var f = this.find(this.sel[0]); if (f) b = f.band; }
    return b || this.layout.bands.filter(function (x) { return x.type === 'detail'; })[0];
  };

  D.fieldText = function (col, type) {
    if (type === 'NUMBER') return '{{' + col + '|#,##0.00}}';
    if (type === 'DATE' || type === 'TIMESTAMP') return '{{' + col + '|DD-MON-YYYY}}';
    return '{{' + col + '}}';
  };

  D.newElement = function (type, extra) {
    var cw = E.contentWidth(this.layout), e = { id: E.uid('e'), type: type, x: 0, y: 0, style: {} };
    switch (type) {
      case 'text': e.w = 120; e.h = 16; e.text = 'Text'; break;
      case 'field': e.type = 'text'; e.w = 110; e.h = 16; e.text = '{{FIELD}}'; break;
      case 'line': e.w = 200; e.h = 6; e.dir = 'h'; e.style = { lineWidth: 1, color: '#000000' }; break;
      case 'rect': e.w = 120; e.h = 40; e.style = { borderWidth: 1, borderColor: '#000000' }; break;
      case 'ellipse': e.w = 60; e.h = 40; e.style = { borderWidth: 1, borderColor: '#000000' }; break;
      case 'image': e.w = 80; e.h = 50; e.src = ''; e.fit = 'contain'; break;
      case 'barcode': e.w = 150; e.h = 40; e.value = '12345678'; e.showText = true; e.style = { fontSize: 8 }; break;
      case 'table': {
        var src = this.layout.detailSource ? this.source(this.layout.detailSource) : this.sources[this.sources.length - 1];
        e.w = cw; e.source = src ? src.name : ''; e.columns = []; e.headerHeight = 18; e.rowHeight = 16; e.zebra = true;
        e.headerStyle = { bg: '#e8edf3', bold: true }; e.rowStyle = {}; e.repeatHeader = true; e.canGrow = true;
        if (src && src.columns.length) e.columns = this.columnsFor(src, cw);
        else e.columns = [{ header: 'Column', value: '{{COLUMN}}', width: cw, align: 'left' }];
        e.h = E.tableDesignHeight(e);
        break;
      }
    }
    for (var k in (extra || {})) e[k] = extra[k];
    return e;
  };

  D.columnsFor = function (src, width) {
    var self = this, cols = src.columns.slice(0, 8);
    var w = width / Math.max(1, cols.length);
    return cols.map(function (c) {
      var n = c.type === 'NUMBER';
      return { header: c.name.replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); }),
        value: self.fieldText(c.name, c.type), width: round(w, 1), align: n ? 'right' : 'left', total: 'none' };
    });
  };

  D.addElement = function (type, band, x, y, extra) {
    band = band || this.targetBand();
    var e = this.newElement(type, extra);
    var cw = E.contentWidth(this.layout);
    e.x = this.snapV(Math.max(0, Math.min(x == null ? 4 : x, cw - Math.min(e.w, cw))));
    e.y = this.snapV(Math.max(0, y == null ? 2 : y));
    if (e.type !== 'table' && e.x + e.w > cw) e.w = cw - e.x;
    this.checkpoint();
    band.elements.push(e);
    if (e.y + (e.type === 'table' ? E.tableDesignHeight(e) : e.h) > band.height) band.height = round(e.y + (e.type === 'table' ? E.tableDesignHeight(e) : e.h) + 2, 2);
    this.sel = [e.id];
    this.selBand = band.id;
    this.renderCanvas();
    this.renderProps();
    return e;
  };

  /* ------------------------------------------------------ canvas events */
  D.bindCanvas = function () {
    var self = this, c = this.canvas;

    c.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      var hd = ev.target.closest('.rs-h');
      var elNode = ev.target.closest('.rs-el');
      var br = ev.target.closest('.rs-band-resize');
      var bandNode = ev.target.closest('.rs-band');
      if (hd && elNode) { ev.preventDefault(); self.startResize(ev, elNode.getAttribute('data-id'), hd.getAttribute('data-h')); return; }
      if (elNode) { ev.preventDefault(); self.startMove(ev, elNode.getAttribute('data-id')); return; }
      if (br && bandNode) { ev.preventDefault(); self.startBandResize(ev, bandNode.getAttribute('data-band')); return; }
      if (bandNode) {
        var body = ev.target.closest('.rs-band-body');
        self.selBand = bandNode.getAttribute('data-band');
        if (body) { ev.preventDefault(); self.startLasso(ev, body, self.selBand); return; }
        self.sel = [];
        self.renderCanvas(); self.renderProps();
      }
    });
    c.addEventListener('dblclick', function (ev) {
      var elNode = ev.target.closest('.rs-el');
      if (!elNode) return;
      var ta = $('.rs-props textarea[data-k="text"], .rs-props input[data-k="value"]', self.root);
      if (ta) { ta.focus(); ta.select(); }
    });
    c.addEventListener('pointermove', function (ev) {
      var body = ev.target.closest('.rs-band-body');
      if (!body) return;
      var r = body.getBoundingClientRect(), s = self.scale();
      $('.rs-st-pos', self.root).textContent = 'x ' + self.toU((ev.clientX - r.left) / s) + '  y ' + self.toU((ev.clientY - r.top) / s) + ' ' + self.unit();
    });
    c.addEventListener('dragover', function (ev) {
      if (!self.dragPayload) return;
      if (ev.target.closest('.rs-band-body')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; }
    });
    c.addEventListener('drop', function (ev) {
      var body = ev.target.closest('.rs-band-body');
      var p = self.dragPayload; self.dragPayload = null;
      if (!body || !p) return;
      ev.preventDefault();
      var band = self.band(body.parentNode.getAttribute('data-band'));
      var r = body.getBoundingClientRect(), s = self.scale();
      var x = (ev.clientX - r.left) / s, y = (ev.clientY - r.top) / s;
      var tableNode = ev.target.closest('.rs-el-table');
      if (p.kind === 'field' && tableNode) {
        var t = self.find(tableNode.getAttribute('data-id')).el;
        self.checkpoint();
        t.columns.push({ header: p.col.replace(/_/g, ' '), value: self.fieldText(p.col, p.type), width: 70, align: p.type === 'NUMBER' ? 'right' : 'left', total: 'none' });
        self.sel = [t.id]; self.renderCanvas(); self.renderProps();
        return;
      }
      if (p.kind === 'new') self.addElement(p.type, band, x, y);
      else if (p.kind === 'token') self.addElement('text', band, x, y, { text: p.token, w: 120 });
      else {
        var extra = { text: self.fieldText(p.col, p.type) };
        if (p.type === 'NUMBER') extra.style = { align: 'right' };
        if (/DESC|NOTE|ADDRESS|REMARK|COMMENT/i.test(p.col)) extra.canGrow = true;
        self.addElement('field', band, x, y, extra);
      }
    });
  };

  D.startMove = function (ev, id) {
    var self = this;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
      var i = this.sel.indexOf(id);
      if (i >= 0) this.sel.splice(i, 1); else this.sel.push(id);
      this.selBand = this.find(id).band.id;
      this.renderCanvas(); this.renderProps();
      return;
    }
    if (this.sel.indexOf(id) < 0) { this.sel = [id]; }
    else if (this.sel[0] !== id) { this.sel.splice(this.sel.indexOf(id), 1); this.sel.unshift(id); }
    var f = this.find(id);
    this.selBand = f.band.id;
    this.renderCanvas(); this.renderProps();
    var s = this.scale(), sx = ev.clientX, sy = ev.clientY, moved = false;
    var items = this.selected().map(function (x) { return { f: x, x: num(x.el.x), y: num(x.el.y), node: $('.rs-el[data-id="' + x.el.id + '"]', self.canvas) }; });
    var prim = items[0];
    var grab = { x: (ev.clientX - prim.node.getBoundingClientRect().left) / s, y: (ev.clientY - prim.node.getBoundingClientRect().top) / s };
    var move = function (e) {
      var dx = (e.clientX - sx) / s, dy = (e.clientY - sy) / s;
      if (!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 3) return;
      if (!moved) { moved = true; items.forEach(function (it) { it.node.classList.add('rs-dragging'); }); }
      var ddx = self.snapV(prim.x + dx) - prim.x, ddy = self.snapV(prim.y + dy) - prim.y;
      items.forEach(function (it) { it.node.style.left = (it.x + ddx) + 'pt'; it.node.style.top = (it.y + ddy) + 'pt'; });
      items.ddx = ddx; items.ddy = ddy;
    };
    var up = function (e) {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (!moved) return;
      self.checkpoint();
      var target = null;
      items.forEach(function (it) { it.node.style.pointerEvents = 'none'; });
      var under = document.elementFromPoint(e.clientX, e.clientY);
      var body = under && under.closest && under.closest('.rs-band-body');
      if (body) target = self.band(body.parentNode.getAttribute('data-band'));
      if (target && target.id !== prim.f.band.id) {
        var r = body.getBoundingClientRect();
        var ny = self.snapV(Math.max(0, (e.clientY - r.top) / s - grab.y));
        var baseY = prim.y;
        items.forEach(function (it) {
          var src = it.f.band;
          src.elements.splice(src.elements.indexOf(it.f.el), 1);
          it.f.el.x = Math.max(0, round(it.x + items.ddx, 2));
          it.f.el.y = Math.max(0, round(ny + (it.y - baseY), 2));
          target.elements.push(it.f.el);
          var eh = it.f.el.type === 'table' ? E.tableDesignHeight(it.f.el) : num(it.f.el.h);
          if (it.f.el.y + eh > target.height) target.height = round(it.f.el.y + eh, 2);
        });
        self.selBand = target.id;
      } else {
        items.forEach(function (it) {
          it.f.el.x = Math.max(0, round(it.x + items.ddx, 2));
          it.f.el.y = Math.max(0, round(it.y + items.ddy, 2));
        });
      }
      self.renderCanvas(); self.renderProps();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  D.startResize = function (ev, id, dir) {
    var self = this, f = this.find(id), e = f.el, s = this.scale();
    var o = { x: num(e.x), y: num(e.y), w: num(e.w), h: num(e.h) }, sx = ev.clientX, sy = ev.clientY;
    var node = $('.rs-el[data-id="' + id + '"]', this.canvas), started = false;
    var minH = e.type === 'line' ? 0.5 : 2;
    var move = function (m) {
      var dx = (m.clientX - sx) / s, dy = (m.clientY - sy) / s;
      if (!started) { started = true; self.checkpoint(); }
      var n = { x: o.x, y: o.y, w: o.w, h: o.h };
      if (dir.indexOf('e') >= 0) n.w = Math.max(2, self.snapV(o.x + o.w + dx) - o.x);
      if (dir.indexOf('s') >= 0) n.h = Math.max(minH, self.snapV(o.y + o.h + dy) - o.y);
      if (dir.indexOf('w') >= 0) { n.x = Math.min(o.x + o.w - 2, self.snapV(o.x + dx)); n.w = o.w + (o.x - n.x); }
      if (dir.indexOf('n') >= 0) { n.y = Math.min(o.y + o.h - minH, self.snapV(o.y + dy)); n.h = o.h + (o.y - n.y); }
      e.x = round(Math.max(0, n.x), 2); e.y = round(Math.max(0, n.y), 2); e.w = round(n.w, 2);
      if (e.type !== 'table') e.h = round(n.h, 2);
      node.style.left = e.x + 'pt'; node.style.top = e.y + 'pt'; node.style.width = e.w + 'pt';
      if (e.type !== 'table') node.style.height = e.h + 'pt';
      $('.rs-st-pos', self.root).textContent = 'w ' + self.toU(e.w) + '  h ' + self.toU(e.h) + ' ' + self.unit();
    };
    var up = function () {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (!started) return;
      if (e.type === 'table' && o.w > 0) {
        var k = e.w / o.w;
        e.columns.forEach(function (c) { c.width = round(num(c.width, 60) * k, 2); });
      }
      self.renderCanvas(); self.renderProps();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  D.startBandResize = function (ev, bandId) {
    var self = this, b = this.band(bandId), s = this.scale(), sy = ev.clientY, oh = b.height, started = false;
    var body = $('.rs-band[data-band="' + bandId + '"] .rs-band-body', this.canvas);
    var move = function (m) {
      if (!started) { started = true; self.checkpoint(); }
      b.height = Math.max(0, self.snapV(oh + (m.clientY - sy) / s));
      body.style.height = b.height + 'pt';
      $('.rs-st-pos', self.root).textContent = 'band height ' + self.toU(b.height) + ' ' + self.unit();
    };
    var up = function () {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (started) { self.selBand = bandId; self.sel = []; self.renderCanvas(); self.renderProps(); }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  D.startLasso = function (ev, body, bandId) {
    var self = this, s = this.scale(), r = body.getBoundingClientRect();
    var x0 = (ev.clientX - r.left) / s, y0 = (ev.clientY - r.top) / s, box = null, add = ev.shiftKey;
    var move = function (m) {
      var x1 = (m.clientX - r.left) / s, y1 = (m.clientY - r.top) / s;
      if (!box) { box = h('<div class="rs-lasso"></div>'); body.appendChild(box); }
      var L = Math.min(x0, x1), T = Math.min(y0, y1);
      box.style.cssText = 'left:' + L + 'pt;top:' + T + 'pt;width:' + Math.abs(x1 - x0) + 'pt;height:' + Math.abs(y1 - y0) + 'pt';
      box._r = { l: L, t: T, r: Math.max(x0, x1), b: Math.max(y0, y1) };
    };
    var up = function () {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      var b = self.band(bandId);
      if (!add) self.sel = [];
      if (box && box._r) {
        var q = box._r;
        b.elements.forEach(function (e) {
          var eh = e.type === 'table' ? E.tableDesignHeight(e) : num(e.h);
          if (e.x < q.r && e.x + e.w > q.l && e.y < q.b && e.y + eh > q.t && self.sel.indexOf(e.id) < 0) self.sel.push(e.id);
        });
      }
      self.renderCanvas(); self.renderProps();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  /* --------------------------------------------------------- keyboard */
  D.bindKeys = function () {
    var self = this;
    document.addEventListener('keydown', function (e) {
      if (!self.root.isConnected || $('.rs-modal', document.body)) return;
      var t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); self.save(); return; }
      if (typing) return;
      if (!self.root.contains(t) && t !== document.body) return;
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) self.redo(); else self.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); self.redo(); return; }
      if (mod && k === 'c') { self.copy(); return; }
      if (mod && k === 'x') { self.copy(); self.deleteSel(); return; }
      if (mod && k === 'v') { self.paste(); return; }
      if (mod && k === 'd') { e.preventDefault(); self.copy(); self.paste(); return; }
      if (mod && k === 'a') {
        var b = self.targetBand();
        if (b) { e.preventDefault(); self.sel = b.elements.map(function (x) { return x.id; }); self.renderCanvas(); self.renderProps(); }
        return;
      }
      if (k === 'delete' || k === 'backspace') { if (self.sel.length) { e.preventDefault(); self.deleteSel(); } return; }
      if (k === 'escape') { self.sel = []; self.renderCanvas(); self.renderProps(); return; }
      var d = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
      if (d && self.sel.length) {
        e.preventDefault();
        var step = e.shiftKey ? 10 : 1;
        if (!self._nudge) { self.checkpoint(); }
        clearTimeout(self._nudge);
        self._nudge = setTimeout(function () { self._nudge = null; }, 600);
        self.selected().forEach(function (f) {
          f.el.x = Math.max(0, round(num(f.el.x) + d[0] * step, 2));
          f.el.y = Math.max(0, round(num(f.el.y) + d[1] * step, 2));
        });
        self.renderCanvas(); self.renderProps();
      }
    });
  };

  /* --------------------------------------------------------- commands */
  D.cmd = function (c, ev) {
    switch (c) {
      case 'list': if (!this.dirty || global.confirm('Discard unsaved changes?')) { this.dirty = false; global.location.href = this.o.listUrl; } break;
      case 'save': this.save(); break;
      case 'undo': this.undo(); break;
      case 'redo': this.redo(); break;
      case 'copy': this.copy(); break;
      case 'paste': this.paste(); break;
      case 'dup': this.copy(); this.paste(); break;
      case 'delete': this.deleteSel(); break;
      case 'al': case 'ac': case 'ar': case 'at': case 'am': case 'ab': this.align(c); break;
      case 'front': this.zorder(ev && ev.shiftKey); break;
      case 'grid': this.showGrid = !this.showGrid; this.snap = this.showGrid; this.renderCanvas(); this.toast('Grid & snap ' + (this.snap ? 'on' : 'off')); break;
      case 'zin': this.zoom = Math.min(3, round(this.zoom + 0.25, 2)); this.applyZoom(); break;
      case 'zout': this.zoom = Math.max(0.25, round(this.zoom - 0.25, 2)); this.applyZoom(); break;
      case 'preview': this.preview(); break;
      case 'pdf': this.serverPdf(); break;
      case 'server': this.showServer(); break;
      case 'export': this.exportReport(); break;
      case 'import': this.importReport(); break;
      case 'versions': this.showVersions(); break;
    }
  };

  D.copy = function () {
    var sel = this.selected();
    if (!sel.length) return;
    this.clip = { band: sel[0].band.id, els: sel.map(function (f) { return E.clone(f.el); }) };
    this.status(sel.length + ' element(s) copied');
  };
  D.paste = function () {
    if (!this.clip) return;
    var cur = this.sel.length && this.find(this.sel[0]);
    var band = (cur && cur.band) || (this.selBand && this.band(this.selBand)) || this.band(this.clip.band) || this.targetBand();
    var self = this;
    this.checkpoint();
    this.sel = [];
    this.clip.els.forEach(function (src) {
      var e = E.clone(src);
      e.id = E.uid('e');
      if (band.id === self.clip.band) { e.x = round(num(e.x) + 10, 2); e.y = round(num(e.y) + 10, 2); }
      band.elements.push(e);
      self.sel.push(e.id);
    });
    this.clip.els = this.clip.els.map(function (x) { var c = E.clone(x); c.x = num(c.x) + 10; c.y = num(c.y) + 10; return c; });
    this.selBand = band.id;
    this.renderCanvas(); this.renderProps();
  };
  D.deleteSel = function () {
    var sel = this.selected();
    if (!sel.length) return;
    this.checkpoint();
    sel.forEach(function (f) { f.band.elements.splice(f.band.elements.indexOf(f.el), 1); });
    this.sel = [];
    this.renderCanvas(); this.renderProps();
  };
  D.align = function (how) {
    var sel = this.selected();
    if (sel.length < 2) { this.toast('Select two or more elements (Shift+click). The first one is the reference.'); return; }
    this.checkpoint();
    var p = sel[0].el, ph = num(p.h);
    sel.slice(1).forEach(function (f) {
      var e = f.el;
      if (how === 'al') e.x = p.x;
      if (how === 'ar') e.x = round(num(p.x) + num(p.w) - num(e.w), 2);
      if (how === 'ac') e.x = round(num(p.x) + num(p.w) / 2 - num(e.w) / 2, 2);
      if (how === 'at') e.y = p.y;
      if (how === 'ab') e.y = round(num(p.y) + ph - num(e.h), 2);
      if (how === 'am') e.y = round(num(p.y) + ph / 2 - num(e.h) / 2, 2);
    });
    this.renderCanvas(); this.renderProps();
  };
  D.zorder = function (back) {
    var sel = this.selected();
    if (!sel.length) return;
    this.checkpoint();
    sel.forEach(function (f) {
      f.band.elements.splice(f.band.elements.indexOf(f.el), 1);
      if (back) f.band.elements.unshift(f.el); else f.band.elements.push(f.el);
    });
    this.renderCanvas();
  };

  /* ------------------------------------------------------ properties */
  D.renderProps = function () {
    var host = $('.rs-props', this.root), sel = this.selected();
    var html;
    if (sel.length) html = this.elementProps(sel);
    else if (this.selBand && this.band(this.selBand)) html = this.bandProps(this.band(this.selBand));
    else html = this.reportProps();
    host.innerHTML = html;
    this.bindProps(host);
  };

  // field helpers -------------------------------------------------------
  function row(label, input, full) { return '<div class="rs-row' + (full ? ' rs-full' : '') + '"><label>' + esc(label) + '</label>' + input + '</div>'; }
  function inp(k, v, type, attrs) { return '<input type="' + (type || 'text') + '" data-k="' + k + '" value="' + esc(v == null ? '' : v) + '"' + (attrs || '') + '>'; }
  function chk(k, v, label) { return '<label class="rs-chk"><input type="checkbox" data-k="' + k + '"' + (v ? ' checked' : '') + '> ' + esc(label) + '</label>'; }
  function sel(k, v, opts) {
    return '<select data-k="' + k + '">' + opts.map(function (o) {
      var val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(val) + '"' + (String(v == null ? '' : v) === String(val) ? ' selected' : '') + '>' + esc(lab) + '</option>';
    }).join('') + '</select>';
  }
  function color(k, v) {
    return '<span class="rs-color"><input type="color" data-k="' + k + '" value="' + esc(/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000') + '"' + (v ? '' : ' data-empty="1"') + '>' +
      '<input type="text" data-k="' + k + '" data-colortext="1" value="' + esc(v || '') + '" placeholder="none"></span>';
  }
  function section(title, body, open) { return '<details class="rs-sec"' + (open !== false ? ' open' : '') + '><summary>' + esc(title) + '</summary>' + body + '</details>'; }

  D.tokenSelect = function (target) {
    var self = this, o = '<option value="">Insert field…</option>';
    this.sources.forEach(function (s) {
      if (!s.columns.length) return;
      o += '<optgroup label="' + esc(s.name) + '">' + s.columns.map(function (c) {
        return '<option value="' + esc(self.fieldText(c.name, c.type)) + '">' + esc(c.name) + '</option>';
      }).join('') + '</optgroup>';
      var nums = s.columns.filter(function (c) { return c.type === 'NUMBER'; });
      if (nums.length) o += '<optgroup label="' + esc(s.name) + ' totals">' + nums.map(function (c) {
        return '<option value="{{SUM(' + esc(c.name) + ')|#,##0.00}}">SUM(' + esc(c.name) + ')</option>';
      }).join('') + '<option value="' + esc("{{WORDS(SUM(" + nums[nums.length - 1].name + "),'Rupees','Cents')}} Only") + '">Amount in words</option></optgroup>';
    });
    o += '<optgroup label="System">' + SYSTEM_TOKENS.map(function (t) { return '<option value="' + esc(t[0]) + '">' + esc(t[1]) + '</option>'; }).join('') + '</optgroup>';
    return '<select class="rs-token" data-target="' + target + '">' + o + '</select>';
  };

  D.fontOptions = function (withDefault) {
    var o = E.FONTS.slice();
    return (withDefault ? [['', '(default)']] : []).concat(o);
  };

  D.styleFields = function (s, prefix, opts) {
    opts = opts || {};
    prefix = prefix || 'style.';
    var f = '';
    f += row('Font', sel(prefix + 'fontFamily', s.fontFamily, this.fontOptions(true)));
    f += row('Size (pt)', inp(prefix + 'fontSize', s.fontSize, 'number', ' step="0.5" min="1" placeholder="' + (this.layout.defaults.fontSize || 10) + '"'));
    f += '<div class="rs-row rs-inline">' + chk(prefix + 'bold', s.bold, 'Bold') + chk(prefix + 'italic', s.italic, 'Italic') + chk(prefix + 'underline', s.underline, 'Underline') + '</div>';
    f += row('Colour', color(prefix + 'color', s.color));
    f += row('Background', color(prefix + 'bg', s.bg));
    if (!opts.noAlign) {
      f += row('Align', sel(prefix + 'align', s.align || 'left', ['left', 'center', 'right', 'justify']));
      f += row('V-align', sel(prefix + 'valign', s.valign || 'top', ['top', 'middle', 'bottom']));
    }
    if (!opts.noBox) {
      f += row('Padding (pt)', inp(prefix + 'padding', s.padding, 'number', ' step="0.5" min="0" placeholder="1"'));
      f += row('Line height', inp(prefix + 'lineHeight', s.lineHeight, 'number', ' step="0.05" min="0.5" placeholder="1.25"'));
      f += this.borderFields(s, prefix);
    }
    return f;
  };
  D.borderFields = function (s, prefix, noSides) {
    var sides = s.borderSides || 'TRBL';
    var f = row('Border (pt)', inp(prefix + 'borderWidth', s.borderWidth, 'number', ' step="0.25" min="0" placeholder="0"'));
    f += row('Border colour', color(prefix + 'borderColor', s.borderColor));
    f += row('Border style', sel(prefix + 'borderStyle', s.borderStyle || 'solid', ['solid', 'dashed', 'dotted', 'double']));
    if (!noSides) f += '<div class="rs-row rs-inline rs-sides"><label>Sides</label>' + ['T', 'R', 'B', 'L'].map(function (x) {
      return '<label class="rs-chk"><input type="checkbox" data-side="' + x + '" data-prefix="' + prefix + '"' + (sides.indexOf(x) >= 0 ? ' checked' : '') + '>' + x + '</label>';
    }).join('') + '</div>';
    f += row('Radius (pt)', inp(prefix + 'radius', s.radius, 'number', ' step="0.5" min="0" placeholder="0"'));
    return f;
  };

  D.elementProps = function (items) {
    var self = this, e = items[0].el, s = e.style || {}, u = this.unit();
    var multi = items.length > 1;
    var title = (multi ? items.length + ' elements' : ({ text: /^\s*\{\{[^}]+\}\}\s*$/.test(e.text || '') ? 'Field' : 'Text', line: 'Line', rect: 'Box', ellipse: 'Ellipse', image: 'Image', table: 'Table', barcode: 'Barcode' })[e.type]);
    var html = '<div class="rs-ptitle">' + esc(title) + '<span>' + esc(E.BAND_LABELS[items[0].band.type]) + '</span></div>';
    var geo = '<div class="rs-grid2">' + row('X (' + u + ')', inp('x', this.toU(e.x), 'number', ' step="any"')) + row('Y (' + u + ')', inp('y', this.toU(e.y), 'number', ' step="any"')) +
      row('Width', inp('w', this.toU(e.w), 'number', ' step="any" min="0"')) +
      (e.type === 'table' ? row('Height', '<input type="text" disabled value="auto">') : row('Height', inp('h', this.toU(e.h), 'number', ' step="any" min="0"'))) + '</div>';
    if (e.type !== 'table') geo += '<div class="rs-row rs-inline">' + chk('stretch', e.stretch, 'Stretch with band (follows growing rows)') + '</div>';
    html += section('Position', geo);
    switch (e.type) {
      case 'text':
        html += section('Content', row('Text / fields', '<textarea data-k="text" rows="4" spellcheck="false">' + esc(e.text || '') + '</textarea>', true) +
          this.tokenSelect('text') +
          '<div class="rs-row rs-inline">' + chk('canGrow', e.canGrow, 'Can grow (wrap long text)') + '</div>' +
          '<div class="rs-hint">Fields: <code>{{COLUMN}}</code>, <code>{{source.COLUMN}}</code>, <code>{{:P1_ITEM}}</code>. Format after a bar: <code>{{AMOUNT|#,##0.00}}</code>, <code>{{D|DD-Mon-YYYY}}</code>. Expressions: <code>{{QTY*PRICE}}</code>, <code>{{IIF(PAID==\'Y\',\'Paid\',\'Due\')}}</code>.</div>');
        html += section('Style', this.styleFields(s));
        break;
      case 'line':
        html += section('Line', row('Direction', sel('dir', e.dir || 'h', [['h', 'Horizontal'], ['v', 'Vertical'], ['d1', 'Diagonal ↘'], ['d2', 'Diagonal ↗']])) +
          row('Thickness (pt)', inp('style.lineWidth', s.lineWidth == null ? 1 : s.lineWidth, 'number', ' step="0.25" min="0.1"')) +
          row('Colour', color('style.color', s.color || '#000000')) +
          row('Dash', sel('style.dash', s.dash || 'solid', ['solid', 'dashed', 'dotted'])));
        break;
      case 'rect': case 'ellipse':
        html += section('Shape', row('Fill', color('style.bg', s.bg)) + this.borderFields(s, 'style.', true));
        break;
      case 'image':
        html += section('Image', row('Image code', '<input type="text" data-k="src" list="rs-assetlist" value="' + esc(e.src || '') + '" placeholder="LOGO or {{IMG_COL}}">' +
          '<datalist id="rs-assetlist">' + this.assets.map(function (a) { return '<option value="' + esc(a.code) + '">'; }).join('') + '</datalist>') +
          row('Fit', sel('fit', e.fit || 'contain', [['contain', 'Contain'], ['cover', 'Cover (crop)'], ['stretch', 'Stretch']])) +
          '<div class="rs-hint">Upload images in the Images tab, then click one to use it here. A field such as <code>{{PHOTO_CODE}}</code> picks the image per row.</div>' +
          this.borderFields(s, 'style.', true));
        break;
      case 'barcode':
        html += section('Barcode (Code 128)', row('Value', '<input type="text" data-k="value" value="' + esc(e.value || '') + '" placeholder="{{INV_NO}}">') + this.tokenSelect('value') +
          '<div class="rs-row rs-inline">' + chk('showText', e.showText !== false, 'Show text') + '</div>' +
          row('Text size', inp('style.fontSize', s.fontSize, 'number', ' step="0.5" min="4" placeholder="8"')) +
          row('Colour', color('style.color', s.color)) + row('Background', color('style.bg', s.bg)));
        break;
      case 'table':
        html += section('Table data', row('Data source', sel('source', e.source || '', [['', '(detail / current scope)']].concat(this.sources.map(function (x) { return x.name; })))) +
          '<div class="rs-cols">' + (e.columns || []).map(function (c, i) {
            return '<div class="rs-col" data-ci="' + i + '"><div class="rs-col-top"><input type="text" data-c="header" value="' + esc(c.header || '') + '" placeholder="Header">' +
              '<button type="button" class="rs-ib" data-colact="up" title="Move up">' + icon('up') + '</button><button type="button" class="rs-ib" data-colact="down" title="Move down">' + icon('down') + '</button>' +
              '<button type="button" class="rs-ib" data-colact="del" title="Remove">' + icon('del') + '</button></div>' +
              '<input type="text" data-c="value" value="' + esc(c.value || '') + '" placeholder="{{COLUMN}}" spellcheck="false">' +
              '<div class="rs-col-bot"><input type="number" data-c="width" value="' + esc(self.toU(num(c.width, 60))) + '" step="any" title="Width (' + u + ')">' +
              '<select data-c="align">' + ['left', 'center', 'right'].map(function (a) { return '<option' + ((c.align || 'left') === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select>' +
              '<select data-c="total" title="Total">' + ['none', 'sum', 'count', 'avg', 'min', 'max'].map(function (a) { return '<option' + ((c.total || 'none') === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></div></div>';
          }).join('') + '</div>' +
          '<div class="rs-row rs-inline"><button type="button" class="rs-btn" data-colact="add">' + icon('plus') + ' Column</button>' +
          '<button type="button" class="rs-btn" data-colact="fill">Fill from source</button></div>' +
          row('Total label', inp('totalLabel', e.totalLabel == null ? 'Total' : e.totalLabel)));
        html += section('Table layout',
          row('Header height (pt)', inp('headerHeight', e.headerHeight == null ? 18 : e.headerHeight, 'number', ' step="0.5" min="0"')) +
          row('Row height (pt)', inp('rowHeight', e.rowHeight == null ? 16 : e.rowHeight, 'number', ' step="0.5" min="4"')) +
          row('Grid lines', sel('grid', e.grid || 'all', [['all', 'All'], ['horizontal', 'Horizontal'], ['none', 'None']])) +
          row('Line width (pt)', inp('borderWidth', e.borderWidth == null ? 0.5 : e.borderWidth, 'number', ' step="0.25" min="0"')) +
          row('Line colour', color('borderColor', e.borderColor || '#999999')) +
          '<div class="rs-row rs-inline">' + chk('showHeader', e.showHeader !== false, 'Header') + chk('repeatHeader', e.repeatHeader !== false, 'Repeat on each page') + '</div>' +
          '<div class="rs-row rs-inline">' + chk('zebra', e.zebra, 'Zebra rows') + chk('canGrow', e.canGrow !== false, 'Rows grow') + '</div>' +
          row('Zebra colour', color('zebraColor', e.zebraColor || '#f6f6f6')));
        html += section('Header style', this.styleFields(e.headerStyle || {}, 'headerStyle.', { noAlign: true, noBox: true }), false);
        html += section('Row style', this.styleFields(e.rowStyle || {}, 'rowStyle.', { noAlign: true, noBox: true }), false);
        html += section('Total row style', this.styleFields(e.totalStyle || {}, 'totalStyle.', { noAlign: true, noBox: true }), false);
        break;
    }
    html += section('Conditional', row('Print when', '<input type="text" data-k="printWhen" value="' + esc(e.printWhen || '') + '" placeholder="e.g. STATUS == \'PAID\'" spellcheck="false">') +
      '<div class="rs-hint">Leave empty to always print. Operators: == != &lt; &gt; AND OR NOT, functions like SUM(), NVL(), IIF().</div>', !!e.printWhen);
    return html;
  };

  D.bandProps = function (b) {
    var L = this.layout, g = L.groups[b.group] || {};
    var html = '<div class="rs-ptitle">' + esc(E.BAND_LABELS[b.type]) + (b.type.indexOf('group') === 0 ? ' ' + (b.group + 1) : '') + '<span>Band</span></div>';
    var f = row('Height (' + this.unit() + ')', inp('band.height', this.toU(b.height), 'number', ' step="any" min="0"'));
    if (b.type === 'pageHeader' || b.type === 'pageFooter') f += row('Print on', sel('band.printOn', b.printOn || 'all', [['all', 'Every page'], ['first', 'First page only'], ['notFirst', 'All but first page']]));
    if (b.type === 'groupHeader') {
      f += row('Group by field', this.detailColumnSelect('group.field', g.field));
      f += '<div class="rs-row rs-inline">' + chk('group.newPage', g.newPage, 'Start each group on a new page') + '</div>';
    }
    if (b.type === 'reportHeader') f += '<div class="rs-row rs-inline">' + chk('band.newPageAfter', b.newPageAfter, 'New page after (cover page)') + '</div>';
    if (b.type === 'summary') f += '<div class="rs-row rs-inline">' + chk('band.newPage', b.newPage, 'Start on a new page') + '</div>';
    f += row('Print when', '<input type="text" data-k="band.printWhen" value="' + esc(b.printWhen || '') + '" placeholder="expression" spellcheck="false">');
    html += section('Band', f);
    if (b.type === 'detail') html += '<div class="rs-hint">The detail band repeats once per row of the report’s detail data source (Report properties). Without a detail source it prints once.</div>';
    if (b.type === 'groupHeader' || b.type === 'groupFooter') html += '<div class="rs-hint">Group bands use the detail source, which must be ordered by the group field. Aggregates such as {{SUM(AMOUNT)}} are computed per group here.</div>';
    if (b.type !== 'detail') html += '<button type="button" class="rs-btn rs-danger rs-wide" data-act="remove-band">' + icon('del') + ' Remove band</button>';
    return html;
  };

  D.detailColumnSelect = function (k, v) {
    var s = this.source(this.layout.detailSource);
    var cols = s ? s.columns.map(function (c) { return c.name; }) : [];
    if (v && cols.indexOf(v) < 0) cols.unshift(v);
    return sel(k, v || '', [['', '(choose)']].concat(cols));
  };

  D.reportProps = function () {
    var L = this.layout, P = L.page, u = this.unit(), r = this.report;
    var srcNames = this.sources.map(function (s) { return s.name; });
    var html = '<div class="rs-ptitle">Report<span>properties</span></div>';
    html += section('Report', row('Code', inp('report.code', r.code, 'text', ' placeholder="INVOICE" style="text-transform:uppercase"')) +
      row('Name', inp('report.name', r.name)) + row('Description', '<textarea data-k="report.description" rows="2">' + esc(r.description || '') + '</textarea>') +
      row('Status', sel('report.status', r.status || 'DRAFT', ['DRAFT', 'PUBLISHED', 'ARCHIVED'])));
    html += section('Page', row('Paper', sel('page.size', P.size, Object.keys(E.PAPER).concat(['Custom']))) +
      row('Orientation', sel('page.orientation', P.orientation, [['portrait', 'Portrait'], ['landscape', 'Landscape']])) +
      (P.size === 'Custom' ? '<div class="rs-grid2">' + row('Width (' + u + ')', inp('page.width', this.toU(P.width), 'number', ' step="any"')) + row('Height (' + u + ')', inp('page.height', this.toU(P.height), 'number', ' step="any"')) + '</div>' : '') +
      row('Units', sel('page.unit', u, [['mm', 'Millimetres'], ['cm', 'Centimetres'], ['in', 'Inches'], ['pt', 'Points']])) +
      '<div class="rs-grid2">' + ['top', 'bottom', 'left', 'right'].map(function (m) { return row('Margin ' + m, inp('margin.' + m, this.toU(P.margin[m]), 'number', ' step="any" min="0"')); }, this).join('') + '</div>');
    html += section('Defaults', row('Font', sel('defaults.fontFamily', L.defaults.fontFamily || 'Noto Sans', this.fontOptions(false))) +
      row('Size (pt)', inp('defaults.fontSize', L.defaults.fontSize || 10, 'number', ' step="0.5" min="4"')) +
      row('Colour', color('defaults.color', L.defaults.color || '#000000')) +
      '<div class="rs-hint">Tamil and Sinhala text falls back to Noto Sans Tamil / Sinhala automatically.</div>');
    html += section('Data', row('Detail source', sel('detailSource', L.detailSource || '', [['', '(none – detail prints once)']].concat(srcNames))) +
      '<div class="rs-hint">The detail band repeats for each row of this source.</div>' +
      '<div class="rs-groups">' + L.groups.map(function (g, i) {
        return '<div class="rs-row rs-inline"><label>Group ' + (i + 1) + '</label>' + this.detailColumnSelect('groups.' + i, g.field) + '<button type="button" class="rs-ib" data-act="del-group" data-i="' + i + '" title="Remove group">' + icon('del') + '</button></div>';
      }, this).join('') + '</div>' +
      '<button type="button" class="rs-btn" data-act="add-group">' + icon('plus') + ' Add group</button>');
    html += section('Bands', ['pageHeader', 'reportHeader', 'summary', 'pageFooter'].map(function (t) {
      return '<div class="rs-row rs-inline">' + chk('hasBand.' + t, L.bands.some(function (b) { return b.type === t; }), E.BAND_LABELS[t]) + '</div>';
    }).join(''));
    html += section('Batch printing', row('One document per row of', sel('batch.source', L.batch.source || '', [['', '(off)']].concat(srcNames))) +
      row('Link column', inp('batch.key', L.batch.key || '', 'text', ' placeholder="INVOICE_ID"')) +
      '<div class="rs-hint">Each row of the batch source becomes its own document (page numbers restart). Other sources are filtered to rows whose link column matches.</div>', !!L.batch.source);
    return html;
  };

  // Generic property write-back ------------------------------------------
  D.setPath = function (obj, path, val) {
    var parts = path.split('.'), o = obj;
    for (var i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
    var last = parts[parts.length - 1];
    if (val === '' || val == null) delete o[last]; else o[last] = val;
  };

  D.bindProps = function (host) {
    var self = this;
    if (host._rsBound) return;
    host._rsBound = true;
    var handler = function (ev) {
      var t = ev.target;
      if (t.classList.contains('rs-token')) {
        var tk = t.value; t.value = '';
        if (!tk) return;
        var target = $('[data-k="' + t.getAttribute('data-target') + '"]', host);
        if (target) {
          var st = target.selectionStart == null ? target.value.length : target.selectionStart, en = target.selectionEnd == null ? st : target.selectionEnd;
          target.value = target.value.slice(0, st) + tk + target.value.slice(en);
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }
      if (t.hasAttribute('data-side')) {
        var pre = t.getAttribute('data-prefix'), sides = $$('[data-side][data-prefix="' + pre + '"]', host).filter(function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-side'); }).join('');
        self.applyProp(pre + 'borderSides', sides === 'TRBL' ? '' : (sides || 'none'));
        return;
      }
      var col = t.closest('.rs-col');
      if (col && t.hasAttribute('data-c')) {
        var f = self.selected()[0], c = f.el.columns[+col.getAttribute('data-ci')], k = t.getAttribute('data-c');
        self.checkpoint();
        c[k] = k === 'width' ? round(self.fromU(num(t.value, 10)), 2) : t.value;
        self.renderCanvas();
        return;
      }
      var key = t.getAttribute('data-k');
      if (!key) return;
      var v;
      if (t.type === 'checkbox') v = t.checked;
      else if (t.type === 'number') v = t.value === '' ? '' : num(t.value);
      else v = t.value;
      if (t.getAttribute('data-colortext')) { var pk = $('input[type=color][data-k="' + key + '"]', host); if (pk && /^#[0-9a-f]{6}$/i.test(v)) pk.value = v; }
      else if (t.type === 'color') { var tx = $('input[data-colortext][data-k="' + key + '"]', host); if (tx) tx.value = v; }
      self.applyProp(key, v);
    };
    host.addEventListener('change', handler);
    host.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-colact],[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-colact') || b.getAttribute('data-act');
      if (act === 'add-group') return self.addGroup();
      if (act === 'del-group') return self.removeGroup(+b.getAttribute('data-i'));
      if (act === 'remove-band') return self.removeBand(self.selBand);
      var f = self.selected()[0];
      if (!f || f.el.type !== 'table') return;
      var cols = f.el.columns, col = b.closest('.rs-col'), i = col ? +col.getAttribute('data-ci') : -1;
      self.checkpoint();
      if (act === 'add') cols.push({ header: 'Column', value: '{{COLUMN}}', width: 70, align: 'left', total: 'none' });
      if (act === 'del') cols.splice(i, 1);
      if (act === 'up' && i > 0) cols.splice(i - 1, 0, cols.splice(i, 1)[0]);
      if (act === 'down' && i < cols.length - 1) cols.splice(i + 1, 0, cols.splice(i, 1)[0]);
      if (act === 'fill') {
        var s = self.source(f.el.source || self.layout.detailSource);
        if (!s || !s.columns.length) { self.toast('Choose a data source with columns first'); return; }
        f.el.columns = self.columnsFor(s, num(f.el.w));
      }
      self.renderCanvas(); self.renderProps();
    });
  };

  D.applyProp = function (key, v) {
    var self = this, L = this.layout, P = L.page;
    var geo = { x: 1, y: 1, w: 1, h: 1 };
    var sel = this.selected();
    this.checkpoint();
    if (sel.length && !/^(report|page|margin|defaults|band|group|groups|hasBand|batch|detailSource)\b/.test(key)) {
      sel.forEach(function (f, idx) {
        if (geo[key]) {
          if (idx > 0 && sel.length > 1 && (key === 'x' || key === 'y')) return; // move only primary on x/y
          var pt = round(self.fromU(num(v)), 2);
          if (key === 'w' && f.el.type === 'table' && num(f.el.w) > 0) {
            var k = pt / num(f.el.w);
            f.el.columns.forEach(function (c) { c.width = round(num(c.width, 60) * k, 2); });
          }
          f.el[key] = pt;
        } else if (idx === 0 || /^(style|headerStyle|rowStyle|totalStyle)\./.test(key)) {
          self.setPath(f.el, key, v);
        }
      });
      this.renderCanvas();
      if (/^(style\.align|style\.borderWidth|source|showHeader|grid)$/.test(key) || key === 'src') this.renderProps();
      if (key === 'src') this.loadAssetData([String(v).toUpperCase()]);
      return;
    }
    var parts = key.split('.');
    switch (parts[0]) {
      case 'report':
        this.report[parts[1]] = parts[1] === 'code' ? String(v).toUpperCase().replace(/[^A-Z0-9_\-]/g, '_') : v;
        $('.rs-r-name', this.root).textContent = this.report.name || 'Untitled';
        $('.rs-r-code', this.root).textContent = this.report.code ? ' · ' + this.report.code : '';
        if (parts[1] === 'code') this.renderProps();
        return;
      case 'page':
        if (parts[1] === 'width' || parts[1] === 'height') P[parts[1]] = this.fromU(num(v));
        else P[parts[1]] = v;
        if (parts[1] === 'size' && v === 'Custom') { /* keep current */ }
        E.normalizeLayout(L);
        break;
      case 'margin': P.margin[parts[1]] = round(this.fromU(num(v)), 2); break;
      case 'defaults': this.setPath(L.defaults, parts[1], v); break;
      case 'detailSource': L.detailSource = v; break;
      case 'batch': L.batch[parts[1]] = parts[1] === 'key' ? String(v).toUpperCase() : v; break;
      case 'groups': L.groups[+parts[1]].field = v; break;
      case 'group': { var b = this.band(this.selBand); L.groups[b.group] = L.groups[b.group] || {}; L.groups[b.group][parts[1]] = v; break; }
      case 'band': {
        var bd = this.band(this.selBand);
        if (parts[1] === 'height') bd.height = round(this.fromU(num(v)), 2);
        else this.setPath(bd, parts[1], v);
        break;
      }
      case 'hasBand': {
        var t = parts[1];
        if (v) L.bands.push({ id: E.uid('b'), type: t, height: t === 'pageFooter' ? 24 : 40, elements: [] });
        else {
          var victim = L.bands.filter(function (x) { return x.type === t; })[0];
          if (victim && victim.elements.length && !global.confirm('Remove the ' + E.BAND_LABELS[t] + ' band and its ' + victim.elements.length + ' element(s)?')) { this.renderProps(); return; }
          L.bands = L.bands.filter(function (x) { return x.type !== t; });
        }
        E.sortBands(L);
        break;
      }
    }
    this.renderCanvas();
    this.renderProps();
  };

  D.addGroup = function () {
    var L = this.layout;
    if (!L.detailSource) { this.toast('Set a detail source first (Report properties → Data)', 'error'); return; }
    this.checkpoint();
    var gi = L.groups.length;
    L.groups.push({ field: '', newPage: false });
    var src = this.source(L.detailSource);
    L.bands.push({ id: E.uid('b'), type: 'groupHeader', group: gi, height: 20, elements: [] });
    L.bands.push({ id: E.uid('b'), type: 'groupFooter', group: gi, height: 20, elements: [] });
    E.sortBands(L);
    this.renderCanvas(); this.renderProps();
    if (src && !src.columns.length) this.toast('Tip: validate the detail source to list its columns');
  };
  D.removeGroup = function (i) {
    var L = this.layout;
    this.checkpoint();
    L.groups.splice(i, 1);
    L.bands = L.bands.filter(function (b) { return !((b.type === 'groupHeader' || b.type === 'groupFooter') && b.group === i); });
    L.bands.forEach(function (b) { if ((b.type === 'groupHeader' || b.type === 'groupFooter') && b.group > i) b.group--; });
    E.sortBands(L);
    this.renderCanvas(); this.renderProps();
  };
  D.removeBand = function (id) {
    var b = this.band(id);
    if (!b) return;
    if (b.type === 'groupHeader' || b.type === 'groupFooter') { this.removeGroup(b.group); this.selBand = null; return; }
    if (b.elements.length && !global.confirm('Remove this band and its ' + b.elements.length + ' element(s)?')) return;
    this.checkpoint();
    this.layout.bands = this.layout.bands.filter(function (x) { return x.id !== id; });
    this.selBand = null;
    this.renderCanvas(); this.renderProps();
  };

  /* ----------------------------------------------------------- modal */
  D.modal = function (o) {
    var self = this;
    var m = h('<div class="rs-modal' + (o.full ? ' rs-modal-full' : '') + '"><div class="rs-modal-box' + (o.wide ? ' rs-wide-box' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="rs-modal-head"><b>' + esc(o.title || '') + '</b><span class="rs-grow"></span>' + (o.headExtra || '') +
      '<button type="button" class="rs-ib rs-modal-x" title="Close">' + icon('close') + '</button></div>' +
      '<div class="rs-modal-body"></div><div class="rs-modal-foot"></div></div></div>');
    var body = $('.rs-modal-body', m), foot = $('.rs-modal-foot', m);
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    var close = function () { m.remove(); document.removeEventListener('keydown', onKey, true); if (o.onClose) o.onClose(); };
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    (o.buttons || []).forEach(function (b) {
      var btn = h('<button type="button" class="rs-btn' + (b.primary ? ' rs-btn-primary' : '') + (b.danger ? ' rs-danger' : '') + '">' + esc(b.label) + '</button>');
      btn.addEventListener('click', function () { if (b.action) { var r = b.action(api); if (r === false) return; } if (b.close !== false) close(); });
      foot.appendChild(btn);
    });
    if (!(o.buttons || []).length) foot.remove();
    $('.rs-modal-x', m).addEventListener('click', close);
    m.addEventListener('pointerdown', function (e) { if (e.target === m && !o.full) close(); });
    document.body.appendChild(m);
    var api = { el: m, body: body, close: close };
    var first = $('input,textarea,select', body);
    if (first && o.focus !== false) setTimeout(function () { first.focus(); }, 30);
    return api;
  };

  /* ------------------------------------------------------ data sources */
  D.editSource = function (i) {
    var self = this, isNew = i < 0;
    var s = isNew ? { name: 'SRC' + (this.sources.length + 1), sql: 'select *\n  from dual', params: {}, columns: [], binds: [] } : E.clone(this.sources[i]);
    var body = h('<div class="rs-srcedit">' +
      row('Name', '<input type="text" class="rs-s-name" value="' + esc(s.name) + '" style="text-transform:uppercase" maxlength="30">') +
      row('SQL query', '<textarea class="rs-s-sql rs-code" rows="12" spellcheck="false">' + esc(s.sql) + '</textarea>', true) +
      '<div class="rs-row rs-inline"><button type="button" class="rs-btn rs-s-val">Validate &amp; describe</button><span class="rs-s-msg"></span></div>' +
      '<div class="rs-s-binds"></div><div class="rs-s-cols"></div>' +
      '<div class="rs-hint">Use bind variables like <code>:P10_INVOICE_ID</code>. At run time they come from the parameters you pass or from APEX session state (page items). Test values below are used by Preview. Order the detail source by any group fields.</div></div>');
    var paint = function () {
      $('.rs-s-binds', body).innerHTML = (s.binds || []).length ? '<h4>Test values</h4>' + s.binds.map(function (b) {
        return row(':' + b, '<input type="text" data-bind="' + esc(b) + '" value="' + esc(s.params[b] == null ? '' : s.params[b]) + '">');
      }).join('') : '';
      $('.rs-s-cols', body).innerHTML = (s.columns || []).length ? '<h4>Columns</h4><div class="rs-fields">' + s.columns.map(function (c) { return '<span class="rs-field rs-ft-' + esc(c.type) + '">' + esc(c.name) + ' <small>' + esc(c.type) + '</small></span>'; }).join('') + '</div>' : '';
    };
    var validate = function () {
      var msg = $('.rs-s-msg', body);
      msg.className = 'rs-s-msg'; msg.textContent = 'Checking…';
      s.sql = $('.rs-s-sql', body).value;
      return self.ajax('DESCRIBE', self.report.id, { sql: s.sql }).then(function (r) {
        s.columns = r.columns || []; s.binds = r.binds || []; s.error = null;
        msg.className = 'rs-s-msg rs-ok'; msg.textContent = s.columns.length + ' columns' + (s.binds.length ? ', ' + s.binds.length + ' bind(s)' : '');
        paint();
        return true;
      }).catch(function (err) { msg.className = 'rs-s-msg rs-err'; msg.textContent = err.message; s.error = err.message; return false; });
    };
    $('.rs-s-val', body).addEventListener('click', validate);
    paint();
    this.modal({
      title: isNew ? 'New data source' : 'Edit data source ' + s.name, body: body, wide: true,
      buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, close: false, action: function (api) {
        var name = $('.rs-s-name', body).value.trim().toUpperCase();
        if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(name)) { self.toast('Name: letters, digits and _ (start with a letter)', 'error'); return false; }
        if (self.sources.some(function (x, j) { return j !== i && x.name.toUpperCase() === name; })) { self.toast('A source named ' + name + ' already exists', 'error'); return false; }
        $$('[data-bind]', body).forEach(function (inpEl) { s.params[inpEl.getAttribute('data-bind')] = inpEl.value; });
        validate().then(function (ok) {
          if (!ok && !global.confirm('The query did not validate. Save anyway?')) return;
          var old = isNew ? null : self.sources[i].name;
          self.checkpoint();
          s.name = name;
          if (isNew) self.sources.push(s); else self.sources[i] = s;
          if (old && old !== name && self.layout.detailSource && self.layout.detailSource.toUpperCase() === old.toUpperCase()) self.layout.detailSource = name;
          if (!self.layout.detailSource && /LINE|DETAIL|ITEM|ROWS/i.test(name)) self.layout.detailSource = name;
          api.close();
          self.leftTab = 'data';
          self.renderAll();
        });
        return false;
      } }]
    });
  };

  D.deleteSource = function (i) {
    var s = this.sources[i];
    if (!global.confirm('Delete data source ' + s.name + '?')) return;
    this.checkpoint();
    this.sources.splice(i, 1);
    if (this.layout.detailSource && this.layout.detailSource.toUpperCase() === s.name.toUpperCase()) this.layout.detailSource = '';
    this.renderAll();
  };

  /* ------------------------------------------------------------ assets */
  D.uploadAsset = function (file) {
    var self = this;
    if (file.size > 5 * 1024 * 1024) { this.toast('Image is larger than 5 MB', 'error'); return; }
    var code = file.name.replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9_\-]/g, '_').slice(0, 60);
    var body = h('<div>' + row('Image code', '<input type="text" class="rs-a-code" value="' + esc(code) + '" style="text-transform:uppercase">') + '<div class="rs-hint">Reports refer to images by this code, e.g. LOGO.</div></div>');
    this.modal({ title: 'Upload ' + file.name, body: body, buttons: [{ label: 'Cancel' }, { label: 'Upload', primary: true, action: function () {
      var c = $('.rs-a-code', body).value.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '_');
      var rd = new FileReader();
      rd.onload = function () {
        var uri = rd.result, b64 = String(uri).split(',')[1];
        self.status('Uploading…');
        self.ajax('ASSET_SAVE', self.report.id, { code: c, mime: file.type || 'image/png', fileName: file.name, base64: b64 }).then(function (r) {
          self.assets = r.assets || self.assets;
          self.assetData[c] = uri;
          self.leftTab = 'images'; self.renderLeft(); self.renderCanvas();
          self.status('Image ' + c + ' uploaded');
        }).catch(function (err) { self.toast(err.message, 'error'); });
      };
      rd.readAsDataURL(file);
    } }] });
  };
  D.deleteAsset = function (code) {
    var self = this;
    if (!global.confirm('Delete image ' + code + '? Reports using it will show nothing.')) return;
    this.ajax('ASSET_DELETE', this.report.id, { code: code }).then(function (r) {
      self.assets = r.assets || []; delete self.assetData[code]; self.renderLeft(); self.renderCanvas();
    }).catch(function (err) { self.toast(err.message, 'error'); });
  };
  D.useAsset = function (code) {
    var f = this.selected()[0];
    if (f && f.el.type === 'image') { this.applyProp('src', code); this.renderProps(); return; }
    var e = this.addElement('image', null, null, null, { src: code });
    if (e) this.renderCanvas();
  };

  /* ------------------------------------------------------------ save */
  D.payload = function () {
    return {
      report: { code: this.report.code, name: this.report.name, description: this.report.description, status: this.report.status },
      layout: this.layout,
      sources: this.sources.map(function (s) { return { name: s.name, sql: s.sql, params: s.params || {} }; })
    };
  };
  D.save = function () {
    var self = this;
    if (!this.report.code || !this.report.name) {
      this.sel = []; this.selBand = null; this.renderCanvas(); this.renderProps();
      this.toast('Enter a report code and name first', 'error');
      var ci = $('[data-k="report.code"]', this.root); if (ci) ci.focus();
      return Promise.resolve(false);
    }
    this.status('Saving…');
    return this.ajax('SAVE', this.report.id, this.payload()).then(function (r) {
      var wasNew = !self.report.id;
      self.report.id = r.id; self.report.versionNo = r.versionNo;
      self.setDirty(false);
      self.status('Saved ' + self.report.code + ' (version ' + r.versionNo + ')');
      self.toast('Saved', 'ok');
      if (wasNew && self.o.reportItem && global.apex && global.apex.item) global.apex.item(self.o.reportItem).setValue(r.id);
      if (self.o.onSaved) self.o.onSaved(r);
      return true;
    }).catch(function (err) { self.status('Save failed'); self.toast(err.message, 'error'); return false; });
  };

  /* --------------------------------------------------------- preview */
  D.previewData = function () {
    var self = this;
    return this.ajax('PREVIEW_DATA', this.report.id, {
      sources: this.sources.map(function (s) { return { name: s.name, sql: s.sql, params: s.params || {} }; }),
      params: {}
    }).then(function (data) {
      return self.loadAssetData(self.usedAssets().concat(self.assets.map(function (a) { return a.code; }))).then(function () {
        data.assets = self.assetData;
        return data;
      });
    });
  };

  D.preview = function () {
    var self = this;
    var body = h('<div class="rs-preview"><div class="rs-pv-msg">Running queries…</div><div class="rs-pv-pages"></div></div>');
    var pz = 1;
    var m = this.modal({ title: 'Preview – ' + (this.report.name || ''), body: body, full: true, focus: false,
      headExtra: '<span class="rs-pv-info"></span><button type="button" class="rs-tb" data-pv="zout">' + icon('zout') + '</button><button type="button" class="rs-tb" data-pv="zin">' + icon('zin') + '</button>' +
        '<button type="button" class="rs-tb" data-pv="print">' + icon('print') + '<span>Print / Save PDF</span></button>' });
    var result = null;
    $('.rs-modal-head', m.el).addEventListener('click', function (e) {
      var b = e.target.closest('[data-pv]');
      if (!b || !result) return;
      var a = b.getAttribute('data-pv');
      if (a === 'zin') pz = Math.min(3, pz + 0.25);
      if (a === 'zout') pz = Math.max(0.25, pz - 0.25);
      if (a === 'print') return RptPrintHelper.printHtml(result, self.o.fontCss);
      $('.rs-pv-pages', body).style.zoom = pz;
    });
    this.previewData().then(function (data) {
      var errs = [];
      Object.keys(data.sources || {}).forEach(function (k) { if (data.sources[k].error) errs.push(data.sources[k].error); if (data.sources[k].truncated) errs.push(k + ': preview limited to ' + data.sources[k].rows.length + ' rows'); });
      return E.renderAsync(self.layout, data).then(function (r) {
        result = r;
        errs = errs.concat(r.errors);
        $('.rs-pv-msg', body).innerHTML = errs.length ? '<div class="rs-err">' + errs.map(esc).join('<br>') + '</div>' : '';
        $('.rs-pv-info', m.el).textContent = r.pageCount + ' page' + (r.pageCount === 1 ? '' : 's');
        $('.rs-pv-pages', body).innerHTML = r.pages.join('');
      });
    }).catch(function (err) { $('.rs-pv-msg', body).innerHTML = '<div class="rs-err">' + esc(err.message) + '</div>'; });
  };

  /* ------------------------------------------------- render server */
  D.startServerChecks = function () {
    var self = this;
    if (this.o.serverStatus === false || this._srvTimer) return;
    this.checkServer(false);
    var every = this.o.serverCheckInterval == null ? 120000 : this.o.serverCheckInterval;
    if (every > 0) this._srvTimer = setInterval(function () { if (!document.hidden && self.root.isConnected) self.checkServer(false); }, every);
  };

  D.checkServer = function (manual) {
    var self = this;
    if (this.o.serverStatus === false) return Promise.resolve(null);
    this.serverChecking = true;
    this.renderServerChip();
    return this.ajax('SERVER_STATUS', this.report.id, {}).catch(function (err) {
      return { ok: false, error: err.message, hint: 'The designer could not ask the database (RPT_AJAX). Check that RPT_UTIL and RPT_DESIGNER are valid.' };
    }).then(function (r) {
      var prev = self.server;
      r.checkedAt = new Date();
      r.mismatch = r.ok && r.engine && r.engine !== E.VERSION;
      self.server = r;
      self.serverChecking = false;
      self.renderServerChip();
      if (self._srvModal) self.paintServerModal();
      if (manual) self.toast(r.ok ? 'Render server connected' + (r.ms != null ? ' (' + r.ms + ' ms)' : '') : 'Render server not reachable: ' + r.error, r.ok ? (r.mismatch ? 'warn' : 'ok') : 'error');
      else if (prev && prev.ok && !r.ok) self.toast('Render server connection lost: ' + r.error, 'error');
      else if (prev && !prev.ok && r.ok) self.toast('Render server is back online', 'ok');
      return r;
    });
  };

  D.serverState = function () {
    var r = this.server;
    if (this.serverChecking && !r) return { cls: 'checking', label: 'Checking…' };
    if (!r) return { cls: 'unknown', label: 'Render server' };
    if (!r.ok) return { cls: 'error', label: 'Server offline' };
    if (r.mismatch) return { cls: 'warn', label: 'Server connected' };
    return { cls: 'ok', label: 'Server connected' };
  };

  D.renderServerChip = function () {
    var b = $('.rs-srv', this.root);
    if (!b) return;
    var st = this.serverState(), r = this.server;
    b.className = 'rs-srv rs-srv-' + st.cls + (this.serverChecking ? ' rs-srv-busy' : '');
    $('span', b).textContent = st.label + (r && r.ok && r.ms != null ? ' · ' + r.ms + ' ms' : '');
    b.title = r ? (r.ok ? 'Connected to ' + (r.url || '') + (r.mismatch ? '\nEngine version differs: server ' + r.engine + ', designer ' + E.VERSION : '') : 'Not reachable: ' + r.error) + '\nLast checked ' + r.checkedAt.toLocaleTimeString() + ' – click for details'
      : 'Render server – click for details';
  };

  D.showServer = function () {
    var self = this;
    var body = h('<div class="rs-server"></div>');
    this._srvModal = this.modal({
      title: 'Render server connection', body: body, wide: true, focus: false,
      onClose: function () { self._srvModal = null; },
      buttons: [
        { label: 'Close' },
        { label: 'Test PDF', close: false, action: function () { self.serverPdf(); return false; } },
        { label: 'Check again', primary: true, close: false, action: function () { self.checkServer(true); return false; } }
      ]
    });
    this.paintServerModal();
    if (!this.server || Date.now() - this.server.checkedAt > 15000) this.checkServer(false);
  };

  D.paintServerModal = function () {
    if (!this._srvModal) return;
    var body = this._srvModal.body, r = this.server, st = this.serverState();
    if (!r) { body.innerHTML = '<div class="rs-srv-banner rs-srv-checking"><i></i><b>Checking connection…</b></div>'; return; }
    var rows = [
      ['Status', r.ok ? (r.mismatch ? 'Connected – engine version differs' : 'Connected') : 'Not connected'],
      ['Render URL', r.url || '(not set)'],
      ['Health check URL', r.healthUrl || ''],
      ['Response time', r.ms != null ? r.ms + ' ms' : ''],
      ['HTTP status', r.httpStatus || ''],
      ['API key', { valid: 'Accepted', invalid: 'Rejected – keys differ', 'not-sent': 'Not sent (RENDER_API_KEY empty)' }[r.apiKey] || ''],
      ['Chromium', r.chromium || ''],
      ['Engine version', r.engine ? 'server ' + r.engine + ' · designer ' + E.VERSION : ''],
      ['Render queue', r.active != null ? r.active + ' running, ' + r.queued + ' waiting' : ''],
      ['Server uptime', r.uptime != null ? Math.floor(r.uptime / 3600) + ' h ' + Math.floor(r.uptime % 3600 / 60) + ' min' : ''],
      ['Last checked', r.checkedAt.toLocaleString() + (r.checkedBy ? ' by ' + r.checkedBy : '')]
    ].filter(function (x) { return x[1] !== '' && x[1] != null; });
    body.innerHTML =
      '<div class="rs-srv-banner rs-srv-' + st.cls + '"><i></i><div><b>' + esc(r.ok ? 'The database can reach the render server.' : 'The database cannot use the render server.') + '</b>' +
        (r.error ? '<div class="rs-srv-err">' + esc(r.error) + '</div>' : '') + '</div></div>' +
      (r.hint ? '<div class="rs-srv-hint"><b>What to check</b><br>' + esc(r.hint) + '</div>' : '') +
      (r.mismatch ? '<div class="rs-srv-hint"><b>Engine versions differ</b><br>Copy the same rpt-engine.js to the render server and to Static Application Files so the preview and the PDF match.</div>' : '') +
      '<table class="rs-kv">' + rows.map(function (x) { return '<tr><th>' + esc(x[0]) + '</th><td>' + esc(String(x[1])) + '</td></tr>'; }).join('') + '</table>' +
      '<div class="rs-hint">The check runs from the database through APEX_WEB_SERVICE, the same route a PDF takes, so it also catches network ACL, URL and API-key problems. ' +
      'It repeats every ' + Math.round((this.o.serverCheckInterval == null ? 120000 : this.o.serverCheckInterval) / 1000) + ' s while the designer is open. Settings live in RPT_CONFIG.</div>';
  };

  D.serverPdf = function () {
    var self = this;
    if (!this.report.id) { this.toast('Save the report first', 'error'); return; }
    if (this.dirty && !global.confirm('The server renders the saved version. Generate anyway (without unsaved changes)?')) return;
    this.status('Generating PDF on server…');
    var run = this.o.serverPdf && typeof this.o.serverPdf === 'function' ? this.o.serverPdf(this.report.code)
      : (global.RptPrint ? global.RptPrint.pdf(this.report.code, { test: true }) : Promise.reject(new Error('rpt-print.js is not loaded')));
    Promise.resolve(run).then(function () { self.status('PDF ready'); })
      .catch(function (err) { self.status('PDF failed'); self.toast(err.message, 'error'); self.checkServer(false); });
  };

  /* ---------------------------------------------- export/import/versions */
  function download(name, text, mime) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  D.exportReport = function () {
    var self = this;
    if (!this.report.id) { this.toast('Save the report first', 'error'); return; }
    this.ajax('EXPORT', this.report.id, {}).then(function (r) {
      download((self.report.code || 'report').toLowerCase() + '.report.json', JSON.stringify(r, null, 1));
    }).catch(function (err) { self.toast(err.message, 'error'); });
  };
  D.importReport = function () {
    var self = this;
    var body = h('<div>' + row('Export file', '<input type="file" accept=".json,application/json" class="rs-i-file">') +
      row('Save as code (optional)', '<input type="text" class="rs-i-code" placeholder="keep original" style="text-transform:uppercase">') +
      '<div class="rs-hint">A report with the same code is overwritten (its previous version stays in history). Images are imported too.</div></div>');
    this.modal({ title: 'Import report', body: body, buttons: [{ label: 'Cancel' }, { label: 'Import', primary: true, close: false, action: function (api) {
      var f = $('.rs-i-file', body).files[0];
      if (!f) { self.toast('Choose a file', 'error'); return false; }
      var rd = new FileReader();
      rd.onload = function () {
        var bundle;
        try { bundle = JSON.parse(rd.result); } catch (e) { self.toast('Not valid JSON', 'error'); return; }
        var nc = $('.rs-i-code', body).value.trim().toUpperCase();
        self.ajax('IMPORT', null, { bundle: bundle, newCode: nc || null }).then(function (r) {
          api.close();
          self.toast('Imported', 'ok');
          self.report.id = r.id;
          self.dirty = false;
          if (self.o.reportItem && global.apex && global.apex.item) global.apex.item(self.o.reportItem).setValue(r.id);
          self.load();
        }).catch(function (err) { self.toast(err.message, 'error'); });
      };
      rd.readAsText(f);
      return false;
    } }] });
  };
  D.showVersions = function () {
    var self = this;
    if (!this.report.id) { this.toast('No saved versions yet'); return; }
    this.ajax('VERSIONS', this.report.id, {}).then(function (r) {
      var body = h('<div class="rs-versions">' + (r.versions || []).map(function (v) {
        return '<div class="rs-ver"><b>v' + v.versionNo + '</b><span>' + esc(String(v.savedOn).replace('T', ' ')) + ' · ' + esc(v.savedBy) + '</span><span class="rs-grow"></span>' +
          '<button type="button" class="rs-btn" data-vid="' + v.versionId + '">Load</button></div>';
      }).join('') + '</div>');
      var m = self.modal({ title: 'Version history', body: body, buttons: [{ label: 'Close' }] });
      body.addEventListener('click', function (e) {
        var b = e.target.closest('[data-vid]');
        if (!b) return;
        self.ajax('VERSION_GET', self.report.id, { versionId: +b.getAttribute('data-vid') }).then(function (vr) {
          self.checkpoint();
          self.layout = E.normalizeLayout(vr.layout);
          self.sources = (vr.sources || []).map(function (s) { return { name: s.name, sql: s.sql, params: s.params || {}, columns: [], binds: [] }; });
          self.sel = []; self.selBand = null;
          m.close();
          self.renderAll(); self.describeAll();
          self.toast('Version ' + vr.versionNo + ' loaded – Save to make it current (Undo to go back)');
        }).catch(function (err) { self.toast(err.message, 'error'); });
      });
    }).catch(function (err) { self.toast(err.message, 'error'); });
  };

  /* --------------------------------------------- shared print helper */
  var RptPrintHelper = {
    printHtml: function (result, fontCss) {
      var f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      document.body.appendChild(f);
      var links = fontCss ? '<link rel="stylesheet" href="' + esc(fontCss) + '">' : '';
      // copy @font-face rules / font stylesheets from the host page so measurements match
      $$('link[rel="stylesheet"]').forEach(function (l) { if (/font/i.test(l.href)) links += '<link rel="stylesheet" href="' + esc(l.href) + '">'; });
      var d = f.contentWindow.document;
      d.open();
      d.write('<!DOCTYPE html><html><head><meta charset="utf-8">' + links + '<style>' + result.css + 'html,body{margin:0;padding:0}</style></head><body>' + result.html + '</body></html>');
      d.close();
      var go = function () {
        f.contentWindow.focus();
        f.contentWindow.print();
        setTimeout(function () { f.remove(); }, 60000);
      };
      var ready = f.contentWindow.document.fonts ? f.contentWindow.document.fonts.ready : Promise.resolve();
      Promise.resolve(ready).then(function () { setTimeout(go, 200); });
    }
  };

  global.RptDesigner = {
    init: function (opts) { return new Designer(opts); },
    Designer: Designer,
    printHtml: RptPrintHelper.printHtml
  };
})(window);
