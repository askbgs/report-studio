/*!
 * Report Studio for Oracle APEX - layout engine
 * One engine shared by: the designer preview, browser printing (RptPrint) and the
 * Node/Puppeteer render server. Input = layout JSON + data JSON, output = paged HTML
 * (absolutely positioned, in pt units) that Chromium turns into an exact PDF.
 *
 * Layout units are points (1/72 inch) everywhere.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RptEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.3.0';
  var PX_TO_PT = 0.75;
  var FONT_FALLBACK = "'Noto Sans','Noto Sans Tamil','Noto Sans Sinhala',Arial,sans-serif";
  var FONTS = ['Noto Sans', 'Noto Serif', 'Noto Sans Tamil', 'Noto Sans Sinhala', 'Noto Sans Mono',
               'Arial', 'Times New Roman', 'Courier New'];
  var PAPER = {
    A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [419.53, 595.28], A6: [297.64, 419.53],
    B5: [498.9, 708.66], Letter: [612, 792], Legal: [612, 1008]
  };
  var UNITS = { pt: 1, mm: 72 / 25.4, cm: 72 / 2.54, in: 72 };
  var BAND_ORDER = ['pageHeader', 'reportHeader', 'groupHeader', 'detail', 'groupFooter', 'summary', 'pageFooter'];
  var BAND_LABELS = {
    pageHeader: 'Page Header', reportHeader: 'Report Header', groupHeader: 'Group Header',
    detail: 'Detail', groupFooter: 'Group Footer', summary: 'Summary', pageFooter: 'Page Footer'
  };
  var PAGE_MARK = '\u0001P\u0001', PAGES_MARK = '\u0001T\u0001';

  /* ------------------------------------------------------------------ utils */
  var idSeq = 0;
  function uid(prefix) {
    idSeq++;
    return (prefix || 'e') + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6) + idSeq;
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, d) { v = parseFloat(v); return isNaN(v) ? (d === undefined ? 0 : d) : v; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function unitToPt(v, unit) { return num(v) * (UNITS[unit] || 1); }
  function ptToUnit(v, unit) { return num(v) / (UNITS[unit] || 1); }
  function fontStack(f) { return f ? "'" + String(f).replace(/'/g, '') + "'," + FONT_FALLBACK : FONT_FALLBACK; }

  /* ---------------------------------------------------- layout normalising */
  function newLayout() {
    var m = 28.35; // 10 mm
    return normalizeLayout({
      version: 1,
      page: { size: 'A4', orientation: 'portrait', unit: 'mm', margin: { top: m, right: m, bottom: m, left: m } },
      defaults: { fontFamily: 'Noto Sans', fontSize: 10, color: '#000000' },
      detailSource: '', groups: [], batch: { source: '', key: '' },
      bands: [
        { type: 'pageHeader', height: 50, elements: [] },
        { type: 'reportHeader', height: 40, elements: [] },
        { type: 'detail', height: 20, elements: [] },
        { type: 'summary', height: 30, elements: [] },
        { type: 'pageFooter', height: 24, elements: [
          { type: 'text', x: 0, y: 4, w: 538.58, h: 16, text: 'Page {{PAGE}} of {{PAGES}}', style: { align: 'right', fontSize: 8, color: '#555555' } }
        ] }
      ]
    });
  }

  function pageSize(page) {
    var w = num(page.width), h = num(page.height);
    if (page.size && page.size !== 'Custom' && PAPER[page.size]) { w = PAPER[page.size][0]; h = PAPER[page.size][1]; }
    if (!w || !h) { w = PAPER.A4[0]; h = PAPER.A4[1]; }
    var land = page.orientation === 'landscape';
    return land ? { w: Math.max(w, h), h: Math.min(w, h) } : { w: Math.min(w, h), h: Math.max(w, h) };
  }

  function normalizeLayout(l) {
    l = l || {};
    l.version = l.version || 1;
    l.page = l.page || {};
    var p = l.page;
    p.size = p.size || 'A4';
    p.orientation = p.orientation || 'portrait';
    p.unit = p.unit || 'mm';
    p.margin = p.margin || {};
    ['top', 'right', 'bottom', 'left'].forEach(function (k) { if (p.margin[k] == null) p.margin[k] = 28.35; });
    var sz = pageSize(p);
    p.width = sz.w; p.height = sz.h;
    l.defaults = l.defaults || { fontFamily: 'Noto Sans', fontSize: 10, color: '#000000' };
    l.groups = l.groups || [];
    l.batch = l.batch || { source: '', key: '' };
    l.detailSource = l.detailSource || '';
    l.bands = (l.bands || []).filter(function (b) { return BAND_ORDER.indexOf(b.type) >= 0; });
    l.bands.forEach(function (b) {
      b.id = b.id || uid('b');
      b.height = num(b.height, 20);
      b.elements = b.elements || [];
      if (b.type === 'groupHeader' || b.type === 'groupFooter') b.group = num(b.group, 0);
      b.elements.forEach(function (e) { e.id = e.id || uid('e'); e.style = e.style || {}; });
    });
    if (!l.bands.some(function (b) { return b.type === 'detail'; })) l.bands.push({ id: uid('b'), type: 'detail', height: 20, elements: [] });
    sortBands(l);
    return l;
  }

  function bandRank(b) {
    var r = BAND_ORDER.indexOf(b.type) * 1000;
    if (b.type === 'groupHeader') r += b.group;
    if (b.type === 'groupFooter') r += 999 - b.group;
    return r;
  }
  function sortBands(l) { l.bands.sort(function (a, b) { return bandRank(a) - bandRank(b); }); }
  function contentWidth(l) { return l.page.width - l.page.margin.left - l.page.margin.right; }

  /* ------------------------------------------------------ expression parser */
  // Grammar: or > and > not > comparison > + - > * / % > unary > primary
  // Identifiers: COL, source.COL, :BIND / P10_ITEM (params), PAGE, PAGES, TODAY, NOW, APP_USER, ROWNUM
  function tokenize(src) {
    var toks = [], i = 0, m;
    while (i < src.length) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "'" || c === '"') {
        var j = i + 1, s = '';
        while (j < src.length && src[j] !== c) {
          if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
          s += src[j++];
        }
        if (j >= src.length) throw new Error('Unclosed string');
        toks.push({ t: 'str', v: s }); i = j + 1; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        m = /^[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/.exec(src.slice(i));
        toks.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (/[A-Za-z_$#]/.test(c) || (c === ':' && /[A-Za-z_]/.test(src[i + 1] || ''))) {
        m = /^:?[A-Za-z_$#][A-Za-z0-9_$#]*(?:\.[A-Za-z_$#][A-Za-z0-9_$#]*)?/.exec(src.slice(i));
        toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue;
      }
      var two = src.substr(i, 2);
      if (['==', '!=', '>=', '<=', '&&', '||', '<>'].indexOf(two) >= 0) {
        toks.push({ t: 'op', v: two === '<>' ? '!=' : two }); i += 2; continue;
      }
      if ('+-*/%<>!(),='.indexOf(c) >= 0) { toks.push({ t: 'op', v: c === '=' ? '==' : c }); i++; continue; }
      throw new Error('Unexpected character "' + c + '"');
    }
    return toks;
  }

  function parse(src) {
    var toks = tokenize(src), p = 0;
    function isOp(v) { return toks[p] && toks[p].t === 'op' && toks[p].v === v; }
    function isKw(k) { return toks[p] && toks[p].t === 'id' && toks[p].v.toUpperCase() === k; }
    function next() { return toks[p++]; }
    function or() { var l = and(); while (isOp('||') || isKw('OR')) { next(); l = { k: 'or', l: l, r: and() }; } return l; }
    function and() { var l = not(); while (isOp('&&') || isKw('AND')) { next(); l = { k: 'and', l: l, r: not() }; } return l; }
    function not() { if (isOp('!') || isKw('NOT')) { next(); return { k: 'not', e: not() }; } return cmp(); }
    function cmp() {
      var l = add();
      while (toks[p] && toks[p].t === 'op' && ['==', '!=', '<', '>', '<=', '>='].indexOf(toks[p].v) >= 0) {
        var op = next().v; l = { k: 'bin', op: op, l: l, r: add() };
      }
      return l;
    }
    function add() { var l = mul(); while (isOp('+') || isOp('-')) { var op = next().v; l = { k: 'bin', op: op, l: l, r: mul() }; } return l; }
    function mul() { var l = unary(); while (isOp('*') || isOp('/') || isOp('%')) { var op = next().v; l = { k: 'bin', op: op, l: l, r: unary() }; } return l; }
    function unary() {
      if (isOp('-')) { next(); return { k: 'neg', e: unary() }; }
      if (isOp('+')) { next(); return unary(); }
      return primary();
    }
    function primary() {
      var t = next();
      if (!t) throw new Error('Unexpected end of expression');
      if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v };
      if (t.t === 'op' && t.v === '(') {
        var e = or(); if (!isOp(')')) throw new Error('Missing )'); next(); return e;
      }
      if (t.t === 'id') {
        var u = t.v.toUpperCase();
        if (u === 'NULL') return { k: 'lit', v: null };
        if (u === 'TRUE') return { k: 'lit', v: true };
        if (u === 'FALSE') return { k: 'lit', v: false };
        if (isOp('(')) {
          next();
          var args = [];
          if (!isOp(')')) { args.push(or()); while (isOp(',')) { next(); args.push(or()); } }
          if (!isOp(')')) throw new Error('Missing ) after ' + t.v + '(');
          next();
          return { k: 'fn', name: u, args: args };
        }
        return { k: 'id', name: t.v };
      }
      throw new Error('Unexpected "' + t.v + '"');
    }
    var ast = or();
    if (p < toks.length) throw new Error('Unexpected "' + toks[p].v + '"');
    return ast;
  }

  var AST_CACHE = {};
  function compile(src) {
    var a = AST_CACHE[src];
    if (!a) { a = parse(src); AST_CACHE[src] = a; }
    return a;
  }

  function isNumeric(v) { return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(v)); }
  function toNum(v) { if (v == null || v === '') return 0; if (typeof v === 'boolean') return v ? 1 : 0; var n = Number(v); return isNaN(n) ? 0 : n; }
  function truthy(v) { return !(v == null || v === false || v === 0 || v === '' || v === '0' || v === 'N' || v === 'n'); }
  function str(v) { return v == null ? '' : (v instanceof Date ? formatDate(v, 'DD-MON-YYYY') : String(v)); }
  function eq(a, b) {
    if (a == null || a === '') return b == null || b === '';
    if (b == null || b === '') return false;
    if (isNumeric(a) && isNumeric(b)) return Number(a) === Number(b);
    return String(a) === String(b);
  }
  function cmpVals(a, b) {
    if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
    a = str(a); b = str(b); return a < b ? -1 : a > b ? 1 : 0;
  }

  function collectSources(node, out) {
    if (!node) return out;
    if (node.k === 'id' && node.name.indexOf('.') > 0) out.push(node.name.split('.')[0]);
    ['l', 'r', 'e'].forEach(function (k) { if (node[k]) collectSources(node[k], out); });
    if (node.args) node.args.forEach(function (a) { collectSources(a, out); });
    return out;
  }

  function evaluate(node, ctx) {
    switch (node.k) {
      case 'lit': return node.v;
      case 'id': return resolveId(node.name, ctx);
      case 'neg': return -toNum(evaluate(node.e, ctx));
      case 'not': return !truthy(evaluate(node.e, ctx));
      case 'and': return truthy(evaluate(node.l, ctx)) && truthy(evaluate(node.r, ctx));
      case 'or': return truthy(evaluate(node.l, ctx)) || truthy(evaluate(node.r, ctx));
      case 'bin': {
        var a = evaluate(node.l, ctx), b = evaluate(node.r, ctx);
        switch (node.op) {
          case '+': return (typeof a === 'string' && !isNumeric(a)) || (typeof b === 'string' && !isNumeric(b)) ? str(a) + str(b) : toNum(a) + toNum(b);
          case '-': return toNum(a) - toNum(b);
          case '*': return toNum(a) * toNum(b);
          case '/': return toNum(b) === 0 ? null : toNum(a) / toNum(b);
          case '%': return toNum(b) === 0 ? null : toNum(a) % toNum(b);
          case '==': return eq(a, b);
          case '!=': return !eq(a, b);
          case '<': return cmpVals(a, b) < 0;
          case '>': return cmpVals(a, b) > 0;
          case '<=': return cmpVals(a, b) <= 0;
          case '>=': return cmpVals(a, b) >= 0;
        }
        return null;
      }
      case 'fn': return callFn(node, ctx);
    }
    return null;
  }

  var AGG = { SUM: 1, COUNT: 1, AVG: 1, MIN: 1, MAX: 1 };
  function callFn(node, ctx) {
    var n = node.name, args = node.args;
    if (AGG[n]) {
      var rows;
      var srcs = args.length ? collectSources(args[0], []) : [];
      if (srcs.length) rows = rowsOf(ctx, srcs[0]);
      else rows = ctx.scopeRows || [];
      if (n === 'COUNT' && !args.length) return rows.length;
      var vals = [];
      var srcName = srcs.length ? srcs[0] : ctx.detailSource;
      rows.forEach(function (row, i) {
        var v = evaluate(args[0], child(ctx, { row: row, rowSource: srcName, rowNum: i + 1 }));
        if (v != null && v !== '') vals.push(v);
      });
      if (n === 'COUNT') return vals.length;
      if (!vals.length) return n === 'SUM' ? 0 : null;
      if (n === 'SUM') return vals.reduce(function (s, v) { return s + toNum(v); }, 0);
      if (n === 'AVG') return vals.reduce(function (s, v) { return s + toNum(v); }, 0) / vals.length;
      var best = vals[0];
      vals.forEach(function (v) { var c = cmpVals(v, best); if ((n === 'MIN' && c < 0) || (n === 'MAX' && c > 0)) best = v; });
      return best;
    }
    var a = args.map(function (x) { return evaluate(x, ctx); });
    switch (n) {
      case 'NVL': return a[0] == null || a[0] === '' ? a[1] : a[0];
      case 'IIF': case 'IF': return truthy(a[0]) ? a[1] : (a.length > 2 ? a[2] : null);
      case 'DECODE': {   // DECODE(expr, search1, result1 [, search2, result2 ...] [, default]) - as in Oracle SQL
        for (var di = 1; di + 1 < a.length; di += 2) if (eq(a[0], a[di]) || (a[0] == null && a[di] == null)) return a[di + 1];
        return a.length % 2 === 0 ? a[a.length - 1] : null;
      }
      case 'UPPER': return str(a[0]).toUpperCase();
      case 'LOWER': return str(a[0]).toLowerCase();
      case 'INITCAP': return str(a[0]).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, function (m, p, c) { return p + c.toUpperCase(); });
      case 'TRIM': return str(a[0]).trim();
      case 'LENGTH': return str(a[0]).length;
      case 'SUBSTR': { var s = str(a[0]), st = toNum(a[1] || 1); st = st > 0 ? st - 1 : Math.max(0, s.length + st); return a.length > 2 ? s.substr(st, toNum(a[2])) : s.substr(st); }
      case 'CONCAT': return a.map(str).join('');
      case 'ROUND': { var d = Math.pow(10, toNum(a[1] || 0)); return Math.round(toNum(a[0]) * d) / d; }
      case 'TRUNC': { var d2 = Math.pow(10, toNum(a[1] || 0)); return Math.trunc(toNum(a[0]) * d2) / d2; }
      case 'ABS': return Math.abs(toNum(a[0]));
      case 'TO_CHAR': case 'FORMAT': return formatValue(a[0], a[1]);
      case 'WORDS': return amountInWords(a[0], a[1], a[2], false);
      case 'WORDS_IN': return amountInWords(a[0], a[1], a[2], true);
      case 'TODAY': return today();
    }
    throw new Error('Unknown function ' + n);
  }

  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function child(ctx, o) {
    var c = {};
    for (var k in ctx) c[k] = ctx[k];
    for (var k2 in o) c[k2] = o[k2];
    return c;
  }

  function getSource(ctx, name) { return name ? ctx.sources[String(name).toUpperCase()] : null; }

  // Rows of a source, filtered to the current batch document when a batch key is defined
  function rowsOf(ctx, name) {
    var s = getSource(ctx, name);
    if (!s) return [];
    if (ctx.batchRow && ctx.batchKey && s.name !== ctx.batchSource) {
      var cacheKey = s.name;
      ctx.batchCache = ctx.batchCache || {};
      if (!ctx.batchCache[cacheKey]) {
        var key = ctx.batchKey, kv = ctx.batchRow[key];
        ctx.batchCache[cacheKey] = s.rows.length && (key in s.rows[0])
          ? s.rows.filter(function (r) { return eq(r[key], kv); }) : s.rows;
      }
      return ctx.batchCache[cacheKey];
    }
    return s.rows;
  }
  function firstRow(ctx, s) {
    if (ctx.batchRow && s.name === ctx.batchSource) return ctx.batchRow;
    var rows = rowsOf(ctx, s.name);
    return rows[0];
  }
  function param(ctx, name) {
    var p = ctx.params, u = String(name).toUpperCase();
    if (u in p) return p[u];
    return undefined;
  }

  function resolveId(name, ctx) {
    if (name[0] === ':') { var b = param(ctx, name.slice(1)); return b === undefined ? null : b; }
    var u = name.toUpperCase();
    switch (u) {
      case 'PAGE': return ctx.page != null ? ctx.page : PAGE_MARK;
      case 'PAGES': return ctx.pages != null ? ctx.pages : PAGES_MARK;
      case 'TODAY': return today();
      case 'NOW': return new Date();
      case 'APP_USER': case 'USER': return ctx.user;
      case 'ROWNUM': return ctx.rowNum != null ? ctx.rowNum : null;
    }
    var dot = u.indexOf('.');
    if (dot > 0) {
      var sname = u.slice(0, dot), col = u.slice(dot + 1);
      var s = getSource(ctx, sname);
      if (!s) return null;
      var row = (ctx.row && ctx.rowSource && String(ctx.rowSource).toUpperCase() === s.name) ? ctx.row : firstRow(ctx, s);
      return row && col in row ? row[col] : null;
    }
    if (ctx.row && u in ctx.row) return ctx.row[u];
    for (var i = 0; i < ctx.lookup.length; i++) {
      var r = firstRow(ctx, ctx.lookup[i]);
      if (r && u in r) return r[u];
    }
    var pv = param(ctx, u);
    return pv === undefined ? null : pv;
  }

  /* -------------------------------------------------------------- formats */
  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  var DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

  function toDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'string') {
      var m = ISO_RE.exec(v);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
    return null;
  }
  function caseLike(token, word) {
    if (token === token.toUpperCase()) return word.toUpperCase();
    if (token[0] === token[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1).toLowerCase();
    return word.toLowerCase();
  }
  function pad(n, l) { n = String(n); while (n.length < l) n = '0' + n; return n; }
  function formatDate(d, fmt) {
    return String(fmt).replace(/"[^"]*"|YYYY|RRRR|YY|RR|MONTH|MON|MM|DDD|DD|DAY|DY|D|HH24|HH12|HH|MI|SS|AM|PM/gi, function (t) {
      if (t[0] === '"') return t.slice(1, -1);
      var u = t.toUpperCase(), h = d.getHours();
      switch (u) {
        case 'YYYY': case 'RRRR': return String(d.getFullYear());
        case 'YY': case 'RR': return pad(d.getFullYear() % 100, 2);
        case 'MONTH': return caseLike(t, MONTHS[d.getMonth()]);
        case 'MON': return caseLike(t, MONTHS[d.getMonth()].slice(0, 3));
        case 'MM': return pad(d.getMonth() + 1, 2);
        case 'DDD': { var s = new Date(d.getFullYear(), 0, 1); return pad(Math.floor((d - s) / 864e5) + 1, 3); }
        case 'DD': return pad(d.getDate(), 2);
        case 'D': return String(d.getDay() + 1);
        case 'DAY': return caseLike(t, DAYS[d.getDay()]);
        case 'DY': return caseLike(t, DAYS[d.getDay()].slice(0, 3));
        case 'HH24': return pad(h, 2);
        case 'HH': case 'HH12': return pad(h % 12 || 12, 2);
        case 'MI': return pad(d.getMinutes(), 2);
        case 'SS': return pad(d.getSeconds(), 2);
        case 'AM': case 'PM': return h < 12 ? caseLike(t, 'AM') : caseLike(t, 'PM');
      }
      return t;
    });
  }

  var NUM_CORE = /[#0-9](?:[#0-9,.]|G(?=[#09])|D(?=[#09]))*/;
  function formatNumber(v, fmt) {
    var m = NUM_CORE.exec(fmt);
    if (!m) return String(v);
    var core = m[0], prefix = fmt.slice(0, m.index), suffix = fmt.slice(m.index + core.length);
    var n = toNum(v);
    if (suffix.indexOf('%') >= 0) n = n * 100;
    var dec = core.search(/[.D]/);
    var decimals = dec >= 0 ? core.slice(dec + 1).replace(/[^#09]/g, '').length : 0;
    var group = /[,G]/.test(dec >= 0 ? core.slice(0, dec) : core);
    var neg = n < 0;
    var fixed = Math.abs(n).toFixed(decimals);
    var parts = fixed.split('.');
    var ip = parts[0];
    if (group) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var out = ip + (decimals ? '.' + parts[1] : '');
    return prefix + (neg ? '-' : '') + out + suffix;
  }

  function formatValue(v, fmt) {
    if (v == null) return '';
    if (v === PAGE_MARK || v === PAGES_MARK) return v;
    if (fmt != null && fmt !== '') {
      fmt = String(fmt);
      var lf = fmt.trim().toLowerCase();
      if (lf === 'upper') return str(v).toUpperCase();
      if (lf === 'lower') return str(v).toLowerCase();
      if (lf === 'trim') return str(v).trim();
      if (lf === 'words') return amountInWords(v);
      if (lf === 'words_in') return amountInWords(v, '', '', true);
      var d = toDate(v);
      if (d && /YY|RR|MON|MM|DD|HH|MI|DAY|DY/i.test(fmt)) return formatDate(d, fmt);
      if (isNumeric(v) && NUM_CORE.test(fmt)) return formatNumber(v, fmt);
      return str(v);
    }
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (v instanceof Date) return formatDate(v, 'DD-MON-YYYY');
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e8) / 1e8);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)) {
      var dd = toDate(v);
      return formatDate(dd, (dd.getHours() || dd.getMinutes() || dd.getSeconds()) ? 'DD-MON-YYYY HH24:MI' : 'DD-MON-YYYY');
    }
    return String(v);
  }

  /* ------------------------------------------------------- amount in words */
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function below100(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''); }
  function below1000(n) {
    var h = Math.floor(n / 100), r = n % 100;
    return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? below100(r) : '');
  }
  function intWords(n, indian) {
    if (n === 0) return 'Zero';
    var out = [];
    if (indian) {
      var crore = Math.floor(n / 1e7); n %= 1e7;
      var lakh = Math.floor(n / 1e5); n %= 1e5;
      var th = Math.floor(n / 1000); n %= 1000;
      if (crore) out.push(intWords(crore, true) + ' Crore');
      if (lakh) out.push(below100(lakh) + ' Lakh');
      if (th) out.push(below100(th) + ' Thousand');
      if (n) out.push(below1000(n));
    } else {
      var scales = ['', ' Thousand', ' Million', ' Billion', ' Trillion'], i = 0;
      while (n > 0) {
        var chunk = n % 1000;
        if (chunk) out.unshift(below1000(chunk) + scales[i]);
        n = Math.floor(n / 1000); i++;
      }
    }
    return out.join(' ');
  }
  function amountInWords(v, major, minor, indian) {
    var n = Math.abs(toNum(v));
    var whole = Math.floor(n + 1e-9), cents = Math.round((n - whole) * 100);
    if (cents === 100) { whole++; cents = 0; }
    var s = (toNum(v) < 0 ? 'Minus ' : '') + intWords(whole, indian) + (major ? ' ' + major : '');
    if (cents) s += ' and ' + intWords(cents, false) + ' ' + (minor || 'Cents');
    return s;
  }

  /* -------------------------------------------------------- interpolation */
  function splitFmt(inner) {
    var q = null;
    for (var i = 0; i < inner.length; i++) {
      var c = inner[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === '|' && inner[i + 1] !== '|' && inner[i - 1] !== '|') return { expr: inner.slice(0, i), fmt: inner.slice(i + 1).trim() };
    }
    return { expr: inner, fmt: null };
  }
  function interpolate(tpl, ctx) {
    if (tpl == null) return '';
    tpl = String(tpl);
    if (tpl.indexOf('{{') < 0) return tpl;
    return tpl.replace(/\{\{([\s\S]*?)\}\}/g, function (m, inner) {
      var sp = splitFmt(inner);
      try { return formatValue(evaluate(compile(sp.expr.trim()), ctx), sp.fmt); }
      catch (e) { ctx.errors.push(inner + ': ' + e.message); return '#ERR'; }
    });
  }
  function test(expr, ctx) {
    if (expr == null || String(expr).trim() === '') return true;
    try {
      var e = String(expr).trim().replace(/^\{\{([\s\S]*)\}\}$/, '$1');
      return truthy(evaluate(compile(e), ctx));
    } catch (err) { ctx.errors.push('Print when "' + expr + '": ' + err.message); return true; }
  }

  // A template that is exactly one token ({{EXPR|fmt}}) keeps its raw value for Excel
  var SINGLE_TOKEN = /^\s*\{\{((?:(?!\}\})[\s\S])*)\}\}\s*$/;   // exactly one token, nothing around it
  function rawOf(tpl, ctx) {
    var m = SINGLE_TOKEN.exec(tpl == null ? '' : String(tpl));
    if (!m) return null;
    var sp = splitFmt(m[1]);
    try { return { raw: evaluate(compile(sp.expr.trim()), ctx), fmt: sp.fmt }; } catch (e) { return null; }
  }
  function mergeStyle(st, defaults) {
    var o = {}, k;
    for (k in (defaults || {})) o[k] = defaults[k];
    for (k in (st || {})) if (st[k] !== '' && st[k] != null) o[k] = st[k];
    return o;
  }

  /* ------------------------------------------------------------------ CSS */
  function textCss(st, defaults, opt) {
    var s = {};
    var k;
    defaults = defaults || {};
    for (k in defaults) s[k] = defaults[k];
    for (k in (st || {})) if (st[k] !== '' && st[k] != null) s[k] = st[k];
    var css = 'font-family:' + fontStack(s.fontFamily) + ';font-size:' + num(s.fontSize, 10) + 'pt;color:' + (s.color || '#000') + ';';
    if (s.bold) css += 'font-weight:700;';
    if (s.italic) css += 'font-style:italic;';
    if (s.underline) css += 'text-decoration:underline;';
    css += 'text-align:' + (s.align || 'left') + ';line-height:' + num(s.lineHeight, 1.25) + ';';
    if (s.bg) css += 'background:' + s.bg + ';';
    css += borderCss(s);
    if (s.radius) css += 'border-radius:' + num(s.radius) + 'pt;';
    var pd = s.padding != null && s.padding !== '' ? num(s.padding) : (opt && opt.padding != null ? opt.padding : 1);
    css += 'padding:' + pd + 'pt;';
    return css;
  }
  function borderCss(s) {
    var bw = num(s.borderWidth);
    if (bw <= 0) return '';
    var b = bw + 'pt ' + (s.borderStyle || 'solid') + ' ' + (s.borderColor || '#000');
    var sides = s.borderSides;
    if (!sides || sides === 'TRBL') return 'border:' + b + ';';
    var css = '';
    if (sides.indexOf('T') >= 0) css += 'border-top:' + b + ';';
    if (sides.indexOf('R') >= 0) css += 'border-right:' + b + ';';
    if (sides.indexOf('B') >= 0) css += 'border-bottom:' + b + ';';
    if (sides.indexOf('L') >= 0) css += 'border-left:' + b + ';';
    return css;
  }
  function valignCss(v) {
    return 'display:flex;flex-direction:column;justify-content:' + (v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start') + ';';
  }

  function baseCss(layout) {
    var w = layout ? layout.page.width : 595.28, h = layout ? layout.page.height : 841.89;
    return '' +
      '@page{size:' + w + 'pt ' + h + 'pt;margin:0}' +
      '.rpt-page{position:relative;overflow:hidden;background:#fff;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.rpt-el{position:absolute;box-sizing:border-box;overflow:hidden;margin:0}' +
      '.rpt-tx{white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal}' +
      '.rpt-el svg{display:block}' +
      '@media print{html,body{margin:0;padding:0;background:#fff}.rpt-page{break-after:page;page-break-after:always;box-shadow:none!important;margin:0!important}.rpt-page:last-child{break-after:auto;page-break-after:auto}}';
  }

  /* --------------------------------------------------------- measurement */
  var measureHost = null, measureCache = {};
  function measureHeight(text, css, widthPt) {
    var key = css + '|' + widthPt + '|' + text;
    if (key in measureCache) return measureCache[key];
    var h;
    if (typeof document !== 'undefined' && document.body) {
      if (!measureHost || !measureHost.isConnected) {
        measureHost = document.createElement('div');
        measureHost.setAttribute('aria-hidden', 'true');
        measureHost.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
        document.body.appendChild(measureHost);
      }
      var d = document.createElement('div');
      d.style.cssText = css + 'position:absolute;box-sizing:border-box;width:' + widthPt + 'pt;height:auto;';
      var t = document.createElement('div');
      t.className = 'rpt-tx';
      t.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;';
      t.textContent = text;
      d.appendChild(t);
      measureHost.appendChild(d);
      h = d.getBoundingClientRect().height * PX_TO_PT;
      measureHost.removeChild(d);
    } else {
      // Fallback estimate when no DOM is present (unit tests)
      var fs = num((/font-size:([\d.]+)pt/.exec(css) || [])[1], 10);
      var perLine = Math.max(1, Math.floor(widthPt / (fs * 0.5)));
      var lines = String(text).split('\n').reduce(function (s, l) { return s + Math.max(1, Math.ceil(l.length / perLine)); }, 0);
      h = lines * fs * 1.25 + 4;
    }
    measureCache[key] = h;
    return h;
  }
  function measurableText(t) { return String(t).split(PAGE_MARK).join('99').split(PAGES_MARK).join('99'); }

  /* ---------------------------------------------------------- code 128 */
  var C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
  function code128Codes(text) {
    text = String(text == null ? '' : text);
    var codes = [];
    if (/^\d+$/.test(text) && text.length % 2 === 0 && text.length >= 2) {
      codes.push(105);
      for (var i = 0; i < text.length; i += 2) codes.push(parseInt(text.substr(i, 2), 10));
    } else {
      codes.push(104);
      for (var j = 0; j < text.length; j++) {
        var c = text.charCodeAt(j);
        if (c >= 32 && c <= 126) codes.push(c - 32);
      }
    }
    var sum = codes[0];
    for (var k = 1; k < codes.length; k++) sum += codes[k] * k;
    codes.push(sum % 103);
    codes.push(106);
    return codes;
  }
  function code128Svg(text, color) {
    var widths = code128Codes(text).map(function (c) { return C128[c]; }).join('');
    var x = 10, rects = '';
    for (var i = 0; i < widths.length; i++) {
      var w = +widths[i];
      if (i % 2 === 0) rects += '<rect x="' + x + '" y="0" width="' + w + '" height="100"/>';
      x += w;
    }
    x += 10;
    return '<svg viewBox="0 0 ' + x + ' 100" preserveAspectRatio="none" width="100%" height="100%" fill="' + (color || '#000') + '" shape-rendering="crispEdges">' + rects + '</svg>';
  }


  /* ------------------------------------------------------------ QR code
     ISO/IEC 18004 encoder, byte mode (UTF-8), versions 1-40, ECC L/M/Q/H,
     automatic mask. No dependencies, same output in designer, browser and server. */
  var QR_ECC = { L: [1, [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
                      [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25]],
                 M: [0, [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
                      [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]],
                 Q: [3, [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
                      [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68]],
                 H: [2, [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
                      [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]] };
  function qrUtf8(t) {
    var out = [];
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      if (c >= 0xD800 && c < 0xDC00 && i + 1 < t.length) { var d = t.charCodeAt(i + 1); if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; } }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }
  function qrMul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 255; }
  function qrRawModules(v) { var r = (16 * v + 128) * v + 64; if (v >= 2) { var n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; }
  function qrDataCodewords(v, ecl) { return Math.floor(qrRawModules(v) / 8) - QR_ECC[ecl][1][v] * QR_ECC[ecl][2][v]; }
  function qrAlignPos(v) {
    if (v === 1) return [];
    var n = Math.floor(v / 7) + 2, step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2, res = [6];
    for (var pos = v * 4 + 10; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }
  /* returns { size, dark: [[bool]] } (row-major, dark[y][x]) or null when the text is too long */
  function qrMatrix(text, ecl) {
    ecl = QR_ECC[String(ecl || 'M').toUpperCase()] ? String(ecl || 'M').toUpperCase() : 'M';
    var bytes = qrUtf8(String(text == null ? '' : text)), ver, cap = 0;
    for (ver = 1; ver <= 40; ver++) {
      cap = qrDataCodewords(ver, ecl) * 8;
      if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap) break;
    }
    if (ver > 40) return null;
    // bit stream
    var bits = [], put = function (val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (var b = 0; b < bits.length; b += 8) { var byte = 0; for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k]; data.push(byte); }
    // error correction + interleaving
    var nBlocks = QR_ECC[ecl][2][ver], eccLen = QR_ECC[ecl][1][ver], raw = Math.floor(qrRawModules(ver) / 8);
    var nShort = nBlocks - raw % nBlocks, shortLen = Math.floor(raw / nBlocks);
    var div = []; for (var i = 0; i < eccLen - 1; i++) div.push(0); div.push(1);
    for (var root = 1, r = 0; r < eccLen; r++) {
      for (var j = 0; j < div.length; j++) { div[j] = qrMul(div[j], root); if (j + 1 < div.length) div[j] ^= div[j + 1]; }
      root = qrMul(root, 2);
    }
    var blocks = [];
    for (var bi = 0, pos = 0; bi < nBlocks; bi++) {
      var dat = data.slice(pos, pos + shortLen - eccLen + (bi < nShort ? 0 : 1)); pos += dat.length;
      var rem = div.map(function () { return 0; });
      dat.forEach(function (x) { var f = x ^ rem.shift(); rem.push(0); for (var q = 0; q < rem.length; q++) rem[q] ^= qrMul(div[q], f); });
      if (bi < nShort) dat.push(0);
      blocks.push(dat.concat(rem));
    }
    var cw = [];
    for (var ci = 0; ci < blocks[0].length; ci++) for (var bj = 0; bj < blocks.length; bj++) if (ci !== shortLen - eccLen || bj >= nShort) cw.push(blocks[bj][ci]);
    // modules
    var size = ver * 4 + 17, m = [], fn = [];
    for (var y = 0; y < size; y++) { m.push([]); fn.push([]); for (var x = 0; x < size; x++) { m[y].push(false); fn[y].push(false); } }
    var setF = function (x, y, d) { m[y][x] = d; fn[y][x] = true; };
    for (var t = 0; t < size; t++) { setF(6, t, t % 2 === 0); setF(t, 6, t % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, dist !== 2 && dist !== 4);
      }
    });
    var ap = qrAlignPos(ver), na = ap.length;
    for (var ai = 0; ai < na; ai++) for (var aj = 0; aj < na; aj++) {
      if ((ai === 0 && aj === 0) || (ai === 0 && aj === na - 1) || (ai === na - 1 && aj === 0)) continue;
      for (var ey = -2; ey <= 2; ey++) for (var ex = -2; ex <= 2; ex++) setF(ap[ai] + ex, ap[aj] + ey, Math.max(Math.abs(ex), Math.abs(ey)) !== 1);
    }
    var drawFormat = function (mask) {
      var d = QR_ECC[ecl][0] << 3 | mask, rm = d;
      for (var i = 0; i < 10; i++) rm = (rm << 1) ^ ((rm >>> 9) * 0x537);
      var fb = (d << 10 | rm) ^ 0x5412, bit = function (i) { return ((fb >>> i) & 1) !== 0; };
      for (i = 0; i <= 5; i++) setF(8, i, bit(i));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
      for (i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
      for (i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
      setF(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      var vr = ver; for (var vi = 0; vi < 12; vi++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1F25);
      var vb = ver << 12 | vr;
      for (vi = 0; vi < 18; vi++) { var vd = ((vb >>> vi) & 1) !== 0, va = size - 11 + vi % 3, vbb = Math.floor(vi / 3); setF(va, vbb, vd); setF(vbb, va, vd); }
    }
    for (var idx = 0, right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var jj = 0; jj < 2; jj++) {
        var cx = right - jj, cy = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[cy][cx] && idx < cw.length * 8) { m[cy][cx] = ((cw[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0; idx++; }
      }
    }
    var maskFn = [function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; }, function (x) { return x % 3 === 0; },
      function (x, y) { return (x + y) % 3 === 0; }, function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
      function (x, y) { return x * y % 2 + x * y % 3 === 0; }, function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
      function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }];
    var applyMask = function (k) { for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && maskFn[k](x, y)) m[y][x] = !m[y][x]; };
    var penalty = function () {
      var p = 0, dark = 0, line = function (get) {
        for (var a = 0; a < size; a++) {
          var run = 1, s = '';
          for (var b = 0; b < size; b++) {
            var v = get(a, b); s += v ? '1' : '0';
            if (b > 0) { if (v === get(a, b - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
          }
          s = '0000' + s + '0000';
          for (var f = s.indexOf('1011101'); f >= 0; f = s.indexOf('1011101', f + 1)) if (s.substr(f - 4, 4) === '0000' || s.substr(f + 7, 4) === '0000') p += 40;
        }
      };
      line(function (a, b) { return m[a][b]; }); line(function (a, b) { return m[b][a]; });
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        if (m[y][x]) dark++;
        if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
      return p + (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
    };
    var best = 0, bestP = Infinity;
    for (var mk = 0; mk < 8; mk++) { applyMask(mk); drawFormat(mk); var pp = penalty(); if (pp < bestP) { bestP = pp; best = mk; } applyMask(mk); }
    applyMask(best); drawFormat(best);
    return { size: size, version: ver, ecl: ecl, dark: m };
  }
  function qrSvg(text, ecl, color, quiet) {
    var q = qrMatrix(text, ecl);
    if (!q) return '<svg viewBox="0 0 100 40" width="100%" height="100%"><text x="50" y="24" font-size="9" text-anchor="middle" fill="#c0392b" font-family="sans-serif">QR: text too long</text></svg>';
    var z = quiet === false ? 0 : 4, n = q.size + z * 2, d = '';
    for (var y = 0; y < q.size; y++) {
      for (var x = 0; x < q.size; x++) {
        if (!q.dark[y][x]) continue;
        var x0 = x; while (x + 1 < q.size && q.dark[y][x + 1]) x++;
        d += 'M' + (x0 + z) + ' ' + (y + z) + 'h' + (x - x0 + 1) + 'v1h-' + (x - x0 + 1) + 'z';
      }
    }
    return '<svg viewBox="0 0 ' + n + ' ' + n + '" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" shape-rendering="crispEdges"><path fill="' + (color || '#000') + '" d="' + d + '"/></svg>';
  }
  function qrItemSvg(it) { var e = it.el || {}; return it.value ? qrSvg(it.value, e.ecc, (e.style || {}).color, e.quiet) : ''; }


  /* ------------------------------------------------------------ watermark
     layout.watermark = { text, image, when, pages: all|first|last|notFirst, layer: front (default) | behind,
                          color, opacity (0-1), angle ('auto' = page diagonal, or degrees), fontSize (blank = fit),
                          bold, fontFamily, imageSize (% of page width) } */
  function watermarkOn(wm) { return !!(wm && wm.enabled !== false && (String(wm.text || '').trim() || wm.image)); }
  function watermarkItem(layout, ctx, pageNo, total) {
    var wm = layout.watermark;
    if (!watermarkOn(wm)) return null;
    var pg = wm.pages || 'all';
    if ((pg === 'first' && pageNo !== 1) || (pg === 'last' && pageNo !== total) || (pg === 'notFirst' && pageNo === 1)) return null;
    if (!test(wm.when, ctx)) return null;
    var W = layout.page.width, H = layout.page.height;
    var text = String(interpolate(wm.text || '', ctx) || '').trim();
    var src = '';
    if (wm.image) { var code = interpolate(wm.image, ctx); src = (ctx.assets[code] || ctx.assets[String(code).toUpperCase()]) || (/^(data:|https?:|\/)/.test(code) ? code : ''); }
    if (!text && !src) return null;
    var ang = wm.angle === '' || wm.angle == null || wm.angle === 'auto' ? -Math.atan2(H, W) * 180 / Math.PI : num(wm.angle, 0);
    var rad = Math.abs(ang * Math.PI / 180), c = Math.abs(Math.cos(rad)), sn = Math.abs(Math.sin(rad));
    var span = Math.min(c > 1e-6 ? W / c : Infinity, sn > 1e-6 ? H / sn : Infinity);
    var lines = text ? text.split(/\n/) : [], longest = 0;
    lines.forEach(function (l) { if (l.length > longest) longest = l.length; });
    var fs = num(wm.fontSize, 0);
    if (!fs && longest) fs = Math.max(12, Math.min(span * 0.72 / (longest * 0.6), Math.min(W, H) * 0.28 / lines.length, 220));
    var op = wm.opacity === '' || wm.opacity == null ? 0.15 : Math.max(0, Math.min(1, num(wm.opacity, 0.15)));
    return { kind: 'watermark', x: 0, y: 0, w: W, h: H, el: { style: {} }, text: text, lines: lines, src: src,
      fs: r2(fs), angle: r2(ang), opacity: op, color: wm.color || '#c0392b', bold: wm.bold !== false,
      fontFamily: wm.fontFamily || (layout.defaults || {}).fontFamily || 'Noto Sans',
      imgPct: num(wm.imageSize, 50), front: wm.layer !== 'behind' };
  }
  function watermarkHtml(it) {
    var h = '<div class="rpt-wm" style="position:absolute;left:0;top:0;width:' + r2(it.w) + 'pt;height:' + r2(it.h) + 'pt;display:flex;align-items:center;justify-content:center;pointer-events:none;' +
      'opacity:' + it.opacity + ';' + (it.front ? 'z-index:50;' : '') + '">';
    h += '<div style="transform:rotate(' + it.angle + 'deg);display:flex;flex-direction:column;align-items:center;gap:' + r2(it.fs * 0.15) + 'pt">';
    if (it.src) h += '<img src="' + esc(it.src) + '" alt="" style="width:' + r2(it.w * it.imgPct / 100) + 'pt;height:auto;display:block">';
    if (it.text) h += '<div style="font-family:' + fontStack(it.fontFamily) + ';font-size:' + it.fs + 'pt;line-height:1.1;font-weight:' + (it.bold ? 700 : 400) +
      ';color:' + esc(it.color) + ';white-space:pre;text-align:center;letter-spacing:.04em">' + esc(it.text) + '</div>';
    return h + '</div></div>';
  }

  /* -------------------------------------------------------- element HTML */
  function boxStyle(x, y, w, h) { return 'left:' + r2(x) + 'pt;top:' + r2(y) + 'pt;width:' + r2(w) + 'pt;height:' + r2(h) + 'pt;'; }

  function itemHtml(it, ox, oy, pageNo, pageCount) {
    var e = it.el, s = e.style || {};
    var pos = boxStyle(ox + it.x, oy + it.y, it.w, it.h);
    var fill = function (t) { return esc(String(t).split(PAGE_MARK).join(pageNo).split(PAGES_MARK).join(pageCount)); };
    if (it.kind === 'watermark') return watermarkHtml(it);
    switch (it.kind) {
      case 'text':
        return '<div class="rpt-el" style="' + pos + it.css + valignCss(s.valign) + '"><div class="rpt-tx">' + fill(it.text) + '</div></div>';
      case 'line': {
        var lw = num(s.lineWidth, 1), col = s.color || '#000', dash = s.dash === 'dashed' ? (lw * 4) + ',' + (lw * 3) : s.dash === 'dotted' ? lw + ',' + (lw * 2) : '';
        var w = Math.max(it.w, 0.01), h = Math.max(it.h, 0.01), x1 = 0, y1 = h / 2, x2 = w, y2 = h / 2;
        if (e.dir === 'v') { x1 = x2 = w / 2; y1 = 0; y2 = h; }
        else if (e.dir === 'd1') { x1 = 0; y1 = 0; x2 = w; y2 = h; }
        else if (e.dir === 'd2') { x1 = 0; y1 = h; x2 = w; y2 = 0; }
        return '<svg class="rpt-el" style="' + pos + 'overflow:visible" viewBox="0 0 ' + r2(w) + ' ' + r2(h) + '"><line x1="' + r2(x1) + '" y1="' + r2(y1) + '" x2="' + r2(x2) + '" y2="' + r2(y2) + '" stroke="' + esc(col) + '" stroke-width="' + lw + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + ' stroke-linecap="butt"/></svg>';
      }
      case 'rect': case 'ellipse': {
        var css = (s.bg ? 'background:' + s.bg + ';' : '') + borderCss(s) + (it.kind === 'ellipse' ? 'border-radius:50%;' : (s.radius ? 'border-radius:' + num(s.radius) + 'pt;' : ''));
        return '<div class="rpt-el" style="' + pos + css + '"></div>';
      }
      case 'image': {
        if (!it.src) return '<div class="rpt-el" style="' + pos + borderCss(s) + '"></div>';
        var fit = e.fit === 'cover' ? 'cover' : e.fit === 'stretch' ? 'fill' : 'contain';
        return '<div class="rpt-el" style="' + pos + borderCss(s) + '"><img src="' + esc(it.src) + '" style="width:100%;height:100%;object-fit:' + fit + ';display:block" alt=""></div>';
      }
      case 'barcode': case 'qr': {
        var showText = it.kind === 'qr' ? e.showText === true : e.showText !== false, th = showText ? Math.min(it.h * 0.3, num(s.fontSize, 8) * 1.4) : 0;
        var bars = it.kind === 'qr' ? qrItemSvg(it) : it.value ? code128Svg(it.value, s.color) : '';
        return '<div class="rpt-el" style="' + pos + (s.bg ? 'background:' + s.bg + ';' : '') + '"><div style="height:' + r2(it.h - th) + 'pt">' + bars + '</div>' +
          (showText ? '<div style="height:' + r2(th) + 'pt;font-family:' + fontStack(s.fontFamily) + ';font-size:' + num(s.fontSize, 8) + 'pt;text-align:center;line-height:' + r2(th) + 'pt;color:' + (s.color || '#000') + '">' + esc(it.value) + '</div>' : '') + '</div>';
      }
      case 'cell':
        return '<div class="rpt-el" style="' + pos + it.css + valignCss(it.valign || 'middle') + '"><div class="rpt-tx">' + fill(it.text) + '</div></div>';
    }
    return '';
  }

  /* --------------------------------------------------- element layout */
  function layoutElement(e, ctx, defaults) {
    var s = e.style || {};
    var it = { el: e, kind: e.type, x: num(e.x), y: num(e.y), w: num(e.w, 10), h: num(e.h, 10) };
    switch (e.type) {
      case 'text': {
        it.text = interpolate(e.text, ctx);
        it.css = textCss(s, defaults);
        it.st = mergeStyle(s, defaults);
        var rv = rawOf(e.text, ctx);
        if (rv) { it.raw = rv.raw; it.fmt = rv.fmt; }
        it.isStatic = String(e.text || '').indexOf('{{') < 0;
        if (e.canGrow) {
          var mh = measureHeight(measurableText(it.text), it.css, it.w);
          if (mh > it.h) it.h = mh;
        }
        break;
      }
      case 'image': {
        var src = interpolate(e.src, ctx);
        it.src = (ctx.assets[src] || ctx.assets[String(src).toUpperCase()]) || (/^(data:|https?:|\/)/.test(src) ? src : '');
        break;
      }
      case 'barcode': case 'qr': it.value = interpolate(e.value, ctx); break;
    }
    return it;
  }

  // Lay out a set of elements and push elements down below others that grew (can-grow)
  function staticBlock(els, top, bottom, ctx, defaults) {
    var items = els.map(function (e) {
      var it = layoutElement(e, ctx, defaults);
      it.origY = it.y - top; it.origH = num(e.h, 10); it.y = it.origY;
      return it;
    }).sort(function (a, b) { return a.origY - b.origY; });
    var maxExtra = 0, done = [];
    items.forEach(function (it) {
      var shift = 0;
      done.forEach(function (d) {
        if (d.origY + d.origH <= it.origY + 0.01) shift = Math.max(shift, d.shift + (d.h - d.origH));
      });
      it.shift = shift; it.y = it.origY + shift;
      maxExtra = Math.max(maxExtra, shift + (it.h - it.origH));
      done.push(it);
    });
    var height = Math.max(0, bottom - top) + maxExtra;
    items.forEach(function (it) { if (!it.el.stretch) height = Math.max(height, it.y + it.h); });
    // "stretch" elements (zebra backgrounds, vertical lines) follow the final band height
    var designH = Math.max(0, bottom - top);
    items.forEach(function (it) { if (it.el.stretch) it.h = Math.max(it.origH, it.origH + (height - designH) - it.shift); });
    return { height: height, items: items };
  }

  function tableBlocks(t, ctx, defaults, tableId) {
    var rows = t.source ? rowsOf(ctx, t.source) : (ctx.scopeRows || []);
    var srcName = t.source || ctx.detailSource;
    var cols = (t.columns || []).filter(function (c) { return c; });
    if (!cols.length) return [];
    var totalW = cols.reduce(function (s, c) { return s + num(c.width, 60); }, 0) || 1;
    var scale = num(t.w, totalW) / totalW;
    var x = num(t.x), xs = [], acc = x;
    cols.forEach(function (c) { var w = num(c.width, 60) * scale; xs.push({ x: acc, w: w }); acc += w; });
    var bw = t.borderWidth != null && t.borderWidth !== '' ? num(t.borderWidth) : 0.5;
    var bc = t.borderColor || '#999999';
    var grid = t.grid || 'all';
    var hs = t.headerStyle || {}, rs = t.rowStyle || {}, fs = t.totalStyle || {};
    var rowH = num(t.rowHeight, 16), headH = num(t.headerHeight, 18);
    var blocks = [];

    function cellStyle(style, base, extraBg) {
      var st = {}, k;
      for (k in base) st[k] = base[k];
      for (k in style) if (style[k] !== '' && style[k] != null) st[k] = style[k];
      if (extraBg && !style.bg) st.bg = extraBg;
      return st;
    }
    function cellBorders(colIdx, first) {
      if (!(bw > 0 && grid !== 'none')) return null;
      return { w: bw, c: bc, l: grid === 'all' && colIdx === 0, t: !!first, r: grid === 'all', b: true };
    }
    function cellCss(style, base, colIdx, first, extraBg) {
      var st = cellStyle(style, base, extraBg);
      var css = textCss(st, defaults, { padding: 3 });
      if (bw > 0 && grid !== 'none') {
        var b = bw + 'pt solid ' + bc;
        if (grid === 'all') {
          css += 'border-right:' + b + ';border-bottom:' + b + ';';
          if (colIdx === 0) css += 'border-left:' + b + ';';
          if (first) css += 'border-top:' + b + ';';
        } else if (grid === 'horizontal') {
          css += 'border-bottom:' + b + ';';
          if (first) css += 'border-top:' + b + ';';
        }
      }
      return css;
    }
    function rowBlock(texts, styleFor, minH, grow, first, bg, kind, raws) {
      var cells = texts.map(function (tx, i) {
        var c = cols[i];
        var base = { align: c.align || 'left' };
        var css = cellCss(styleFor(c), base, i, first, bg);
        var cell = { el: t, kind: 'cell', x: xs[i].x, y: 0, w: xs[i].w, h: minH, text: tx, css: css, valign: c.valign || 'middle',
          st: mergeStyle(cellStyle(styleFor(c), base, bg), defaults), borders: cellBorders(i, first), rowKind: kind };
        if (raws && raws[i]) { cell.raw = raws[i].raw; cell.fmt = raws[i].fmt; }
        return cell;
      });
      var h = minH;
      if (grow) cells.forEach(function (c) { if (c.text) h = Math.max(h, measureHeight(measurableText(c.text), c.css, c.w)); });
      cells.forEach(function (c) { c.h = h; });
      return { height: h, items: cells, tableId: tableId, kind: kind };
    }

    var header = null;
    if (t.showHeader !== false) {
      header = rowBlock(cols.map(function (c) { return interpolate(c.header, ctx); }),
        function () { return hs; }, headH, true, true, hs.bg || '#eeeeee', 'tableHeader');
      header.keepWithNext = true;
      blocks.push(header);
    }
    var zebra = t.zebra ? (t.zebraColor || '#f6f6f6') : null;
    rows.forEach(function (row, i) {
      var rc = child(ctx, { row: row, rowSource: srcName, rowNum: i + 1 });
      var b = rowBlock(cols.map(function (c) { return interpolate(c.value, rc); }),
        function () { return rs; }, rowH, t.canGrow !== false, !header && i === 0, zebra && i % 2 ? zebra : null, 'tableRow',
        cols.map(function (c) { return rawOf(c.value, rc); }));
      if (header && t.repeatHeader !== false) b.repeatHeader = header;
      blocks.push(b);
    });
    if (cols.some(function (c) { return c.total && c.total !== 'none'; })) {
      var tc = child(ctx, { scopeRows: rows });
      var labelDone = false, totRaw = [];
      var texts = cols.map(function (c, ci) {
        if (c.total && c.total !== 'none') {
          var m = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(c.value || '');
          if (!m) return '';
          var sp = splitFmt(m[1]);
          var fmt = c.totalFormat || sp.fmt;
          var f = c.total.toUpperCase();
          try {
            var v = evaluate({ k: 'fn', name: f, args: [compile(sp.expr.trim())] }, child(tc, { detailSource: srcName }));
            totRaw[ci] = { raw: v, fmt: f === 'COUNT' ? null : fmt };
            return formatValue(v, f === 'COUNT' ? null : fmt);
          } catch (err) { ctx.errors.push('Total ' + c.header + ': ' + err.message); return '#ERR'; }
        }
        if (!labelDone) { labelDone = true; return t.totalLabel != null ? interpolate(t.totalLabel, tc) : 'Total'; }
        return '';
      });
      var fb = rowBlock(texts, function () { var o = { bold: true }; for (var k in fs) o[k] = fs[k]; return o; },
        rowH, false, !header && !rows.length, fs.bg || null, 'tableTotal', totRaw);
      // the label spans every column before the first total column
      var firstTot = -1;
      cols.forEach(function (c, i) { if (firstTot < 0 && c.total && c.total !== 'none') firstTot = i; });
      if (firstTot > 1) {
        var lead = fb.items[0], lastLead = fb.items[firstTot - 1];
        lead.w = lastLead.x + lastLead.w - lead.x;
        lead.css = lead.css.replace(/text-align:[a-z]+;/, 'text-align:left;');
        fb.items.splice(1, firstTot - 1);
      }
      blocks.push(fb);
    }
    return blocks;
  }

  // Convert one band instance to a list of blocks; only tables split across pages
  function bandBlocks(band, ctx, defaults) {
    var els = band.elements.filter(function (e) { return !e.hidden && test(e.printWhen, ctx); });
    var tables = els.filter(function (e) { return e.type === 'table'; }).sort(function (a, b) { return a.y - b.y; });
    var others = els.filter(function (e) { return e.type !== 'table'; });
    if (!tables.length) return [staticBlock(others, 0, band.height, ctx, defaults)];
    var blocks = [], cursor = 0, used = {};
    tables.forEach(function (t, ti) {
      var pre = others.filter(function (e) { return !used[e.id] && num(e.y) < num(t.y) + num(t.h); });
      pre.forEach(function (e) { used[e.id] = 1; });
      if (num(t.y) - cursor > 0.5 || pre.length) blocks.push(staticBlock(pre, cursor, Math.max(cursor, num(t.y)), ctx, defaults));
      Array.prototype.push.apply(blocks, tableBlocks(t, ctx, defaults, band.id + ':' + t.id + ':' + (ctx.rowNum || 0) + ':' + ti + ':' + Math.random()));
      cursor = num(t.y) + num(t.h);
    });
    var post = others.filter(function (e) { return !used[e.id]; });
    if (band.height - cursor > 0.5 || post.length) blocks.push(staticBlock(post, cursor, Math.max(cursor, band.height), ctx, defaults));
    return blocks;
  }

  /* ------------------------------------------------------- document build */
  function bandsOf(layout, type, group) {
    return layout.bands.filter(function (b) { return b.type === type && (group == null || b.group === group); });
  }

  function buildBody(layout, ctx) {
    var d = layout.defaults, blocks = [];
    function emit(band, c, opts) {
      if (!test(band.printWhen, c)) return;
      var bs = bandBlocks(band, c, d);
      if (!bs.length) return;
      bs.forEach(function (bl) { bl.bandType = band.type; bl.group = band.group; });
      if (opts && opts.newPage) bs[0].pageBreakBefore = true;
      if (opts && opts.keep) bs[bs.length - 1].keepWithNext = true;
      Array.prototype.push.apply(blocks, bs);
    }
    var all = ctx.detailSource ? rowsOf(ctx, ctx.detailSource) : [];
    var top = child(ctx, { scopeRows: all });
    bandsOf(layout, 'reportHeader').forEach(function (b) {
      emit(b, top);
      if (b.newPageAfter) blocks.push({ height: 0, items: [], forceBreakAfter: true });
    });

    var groups = (layout.groups || []).filter(function (g) { return g && g.field; });
    var detail = bandsOf(layout, 'detail');
    if (!ctx.detailSource) {
      detail.forEach(function (b) { emit(b, top); });
    } else {
      var gf = groups.map(function (g) { return String(g.field).toUpperCase(); });
      var starts = [];
      var keyOf = function (row, lvl) { return gf.slice(0, lvl + 1).map(function (f) { return str(row[f]); }).join('\u0002'); };
      var closeGroups = function (fromLvl, endIdx) {
        for (var l = gf.length - 1; l >= fromLvl; l--) {
          var rows = all.slice(starts[l], endIdx);
          var gc = child(ctx, { row: all[endIdx - 1], rowSource: ctx.detailSource, scopeRows: rows, groupLevel: l });
          bandsOf(layout, 'groupFooter', l).forEach(function (b) { emit(b, gc); });
        }
      };
      var openGroups = function (fromLvl, i) {
        for (var l = fromLvl; l < gf.length; l++) {
          starts[l] = i;
          var k = keyOf(all[i], l), j = i;
          while (j < all.length && keyOf(all[j], l) === k) j++;
          var gc = child(ctx, { row: all[i], rowSource: ctx.detailSource, scopeRows: all.slice(i, j), groupLevel: l });
          var g = groups[l];
          bandsOf(layout, 'groupHeader', l).forEach(function (b) { emit(b, gc, { newPage: g.newPage && i > 0, keep: true }); });
        }
      };
      for (var i = 0; i < all.length; i++) {
        if (gf.length) {
          if (i === 0) openGroups(0, 0);
          else {
            var changed = -1;
            for (var l = 0; l < gf.length; l++) if (keyOf(all[i], l) !== keyOf(all[i - 1], l)) { changed = l; break; }
            if (changed >= 0) { closeGroups(changed, i); openGroups(changed, i); }
          }
        }
        var dc = child(ctx, { row: all[i], rowSource: ctx.detailSource, rowNum: i + 1, scopeRows: all });
        detail.forEach(function (b) { emit(b, dc); });
      }
      if (gf.length && all.length) closeGroups(0, all.length);
    }
    bandsOf(layout, 'summary').forEach(function (b) { emit(b, child(top, {}), { newPage: !!b.newPage }); });
    return blocks;
  }

  function fixedBand(layout, type, pageIdx) {
    var bs = bandsOf(layout, type);
    return bs.filter(function (b) {
      var on = b.printOn || 'all';
      return on === 'all' || (on === 'first' && pageIdx === 0) || (on === 'notFirst' && pageIdx > 0);
    });
  }
  function fixedHeight(layout, type, idx) { return fixedBand(layout, type, idx).reduce(function (s, b) { return s + b.height; }, 0); }

  function paginate(blocks, layout) {
    var P = layout.page, m = P.margin, pages = [], cur, y, bottom;
    function newPage() {
      var idx = pages.length;
      cur = { blocks: [] };
      pages.push(cur);
      y = m.top + fixedHeight(layout, 'pageHeader', idx);
      bottom = P.height - m.bottom - fixedHeight(layout, 'pageFooter', idx);
    }
    function place(b) { cur.blocks.push({ b: b, y: y }); y += b.height; }
    newPage();
    var forceNext = false;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.forceBreakAfter) { forceNext = true; continue; }
      if ((b.pageBreakBefore || forceNext) && cur.blocks.length) newPage();
      forceNext = false;
      var need = b.height;
      if (b.keepWithNext) {
        for (var j = i + 1; j < blocks.length; j++) { need += blocks[j].height; if (!blocks[j].keepWithNext) break; }
      }
      if (y + need > bottom + 0.01 && cur.blocks.length) {
        if (!(y + b.height <= bottom + 0.01 && need > bottom - (m.top + fixedHeight(layout, 'pageHeader', pages.length)))) newPage();
      }
      if (b.repeatHeader && cur.blocks.length === 0 && i > 0 && blocks[i - 1].tableId === b.tableId) place(b.repeatHeader);
      place(b);
    }
    return pages;
  }

  function prepareData(data, layout) {
    data = data || {};
    var sources = {}, order = [];
    var src = data.sources || {};
    Object.keys(src).forEach(function (name) {
      var s = src[name] || {};
      var rows = (s.rows || []).map(function (r) {
        var o = {};
        for (var k in r) o[k.toUpperCase()] = r[k];
        return o;
      });
      var U = name.toUpperCase();
      sources[U] = { name: U, columns: s.columns || [], rows: rows };
      order.push(U);
    });
    var params = {};
    var p = data.params || {};
    Object.keys(p).forEach(function (k) { params[k.replace(/^:/, '').toUpperCase()] = p[k]; });
    var assets = {};
    var a = data.assets || {};
    Object.keys(a).forEach(function (k) { assets[k] = a[k]; assets[k.toUpperCase()] = a[k]; });
    var det = (layout.detailSource || '').toUpperCase();
    var batchSrc = (layout.batch && layout.batch.source || '').toUpperCase();
    var lookup = [];
    if (batchSrc && sources[batchSrc]) lookup.push(sources[batchSrc]);
    order.forEach(function (n) { if (n !== det && n !== batchSrc) lookup.push(sources[n]); });
    if (det && sources[det]) lookup.push(sources[det]);
    return { sources: sources, params: params, assets: assets, lookup: lookup, user: data.user || '',
      detailSource: det && sources[det] ? det : '', batchSource: batchSrc && sources[batchSrc] ? batchSrc : '',
      batchKey: (layout.batch && layout.batch.key || '').toUpperCase() };
  }

  /**
   * Render a report.
   * @param layout  layout JSON (see docs)
   * @param data    { sources:{name:{columns,rows}}, params:{}, assets:{CODE:dataUri}, user }
   * @returns { pages:[html...], html, css, pageCount, errors }
   */
  function render(layout, data, opts) {
    opts = opts || {};
    layout = normalizeLayout(clone(layout));
    var base = prepareData(data, layout);
    base.errors = [];
    var docs = [];
    if (base.batchSource) {
      var masters = base.sources[base.batchSource].rows;
      masters.forEach(function (row) { docs.push(child(base, { batchRow: row, batchCache: null })); });
      if (!masters.length) docs.push(base);
    } else docs.push(base);

    var P = layout.page, m = P.margin, cw = contentWidth(layout);
    var pagesHtml = [];
    var pageStyle = 'width:' + P.width + 'pt;height:' + P.height + 'pt;';
    var maxPages = opts.maxPages || 2000;
    var collect = !!opts.collect, outPages = [], outBody = [], wmWord = '';
    docs.forEach(function (ctx) {
      if (pagesHtml.length >= maxPages) return;
      var blocks = buildBody(layout, ctx);
      var pages = paginate(blocks, layout);
      var total = pages.length;
      if (collect) {
        var pc0 = child(ctx, { page: 1, pages: total, scopeRows: ctx.detailSource ? rowsOf(ctx, ctx.detailSource) : [] });
        var heads = [];
        fixedBand(layout, 'pageHeader', 0).forEach(function (band) {
          if (!test(band.printWhen, pc0)) return;
          bandBlocks(band, pc0, layout.defaults).forEach(function (bl) { bl.bandType = 'pageHeader'; heads.push(bl); });
        });
        outBody.push({ blocks: heads.concat(blocks).map(serialBlock) });
      }
      pages.forEach(function (pg, idx) {
        if (pagesHtml.length >= maxPages) return;
        var pageNo = idx + 1, parts = [], items = [];
        var put = function (it, ox, oy) {
          parts.push(itemHtml(it, ox, oy, pageNo, total));
          if (collect) items.push(serialItem(it, ox, oy, pageNo, total));
        };
        var pc = child(ctx, { page: pageNo, pages: total, scopeRows: ctx.detailSource ? rowsOf(ctx, ctx.detailSource) : [] });
        var wmi = watermarkItem(layout, pc, pageNo, total);
        if (wmi && !wmi.front) put(wmi, 0, 0);
        if (wmi && !wmWord) wmWord = wmi.text;
        // page header
        var hy = m.top;
        fixedBand(layout, 'pageHeader', idx).forEach(function (band) {
          if (!test(band.printWhen, pc)) { hy += band.height; return; }
          var by = hy;
          bandBlocks(band, pc, layout.defaults).forEach(function (bl) {
            bl.items.forEach(function (it) { put(it, m.left, by); });
            by += bl.height;
          });
          hy += band.height;
        });
        pg.blocks.forEach(function (pb) {
          pb.b.items.forEach(function (it) { put(it, m.left, pb.y); });
        });
        var fy = P.height - m.bottom - fixedHeight(layout, 'pageFooter', idx);
        fixedBand(layout, 'pageFooter', idx).forEach(function (band) {
          if (!test(band.printWhen, pc)) { fy += band.height; return; }
          var by = fy;
          bandBlocks(band, pc, layout.defaults).forEach(function (bl) {
            bl.items.forEach(function (it) { put(it, m.left, by); });
            by += bl.height;
          });
          fy += band.height;
        });
        if (wmi && wmi.front) put(wmi, 0, 0);
        pagesHtml.push('<div class="rpt-page" style="' + pageStyle + '">' + parts.join('') + '</div>');
        if (collect) outPages.push({ items: items });
      });
    });
    var errs = [];
    base.errors.forEach(function (e) { if (errs.indexOf(e) < 0) errs.push(e); });
    docs.forEach(function (d) { d.errors.forEach(function (e) { if (errs.indexOf(e) < 0) errs.push(e); }); });
    var res = { pages: pagesHtml, html: pagesHtml.join(''), css: baseCss(layout), pageCount: pagesHtml.length,
      errors: errs, width: P.width, height: P.height, contentWidth: cw };
    if (collect) {
      res.doc = { width: P.width, height: P.height, margin: m, title: layout.name || layout.code || '',
        defaults: layout.defaults, pages: outPages, body: outBody, watermark: wmWord };
    }
    return res;
  }

  /* ------------------------------------------- structured output (Word / Excel) */
  function rawJson(v) {
    if (v instanceof Date) return { d: v.getFullYear() + '-' + pad(v.getMonth() + 1, 2) + '-' + pad(v.getDate(), 2) + 'T' + pad(v.getHours(), 2) + ':' + pad(v.getMinutes(), 2) + ':' + pad(v.getSeconds(), 2) };
    return v;
  }
  function serialItem(it, ox, oy, pageNo, pageCount) {
    if (it.kind === 'watermark') return { kind: 'watermark', x: 0, y: 0, w: r2(it.w), h: r2(it.h), text: it.text, src: it.src, fs: it.fs, angle: it.angle,
      opacity: it.opacity, color: it.color, bold: it.bold, fontFamily: it.fontFamily, imgPct: it.imgPct, front: it.front, st: {}, raster: true };
    var e = it.el || {}, o = { kind: it.kind, x: r2(ox + it.x), y: r2(oy + it.y), w: r2(it.w), h: r2(it.h) };
    if (it.text != null) o.text = String(it.text).split(PAGE_MARK).join(pageNo).split(PAGES_MARK).join(pageCount);
    o.st = it.st || mergeStyle(e.style || {}, {});
    if (it.borders) o.borders = it.borders;
    if (it.valign) o.valign = it.valign; else if (o.st.valign) o.valign = o.st.valign;
    if (it.kind === 'line') o.dir = e.dir || 'h';
    if (it.kind === 'image') { o.src = it.src || ''; o.fit = e.fit || 'contain'; }
    if (it.kind === 'barcode') { o.value = it.value; o.showText = e.showText !== false; o.svg = it.value ? code128Svg(it.value, (e.style || {}).color) : ''; }
    if (it.kind === 'qr') { o.value = it.value; o.showText = e.showText === true; o.svg = qrItemSvg(it); }
    if (it.rowKind) { o.rowKind = it.rowKind; o.tid = e.id; }
    if (it.kind === 'ellipse' || (it.kind === 'line' && (e.dir === 'd1' || e.dir === 'd2' || ((e.style || {}).dash && (e.style || {}).dash !== 'solid'))) || (it.kind === 'rect' && num((e.style || {}).radius) > 0)) o.raster = true;
    return o;
  }
  function serialBlock(b) {
    return { band: b.bandType || '', group: b.group, kind: b.kind || 'band', table: b.tableId ? String(b.tableId).split(':').slice(0, 2).join(':') : null,
      items: b.items.filter(function (it) { return it.kind === 'text' || it.kind === 'cell'; }).map(function (it) {
        var o = { kind: it.kind, x: r2(it.x), y: r2(it.y || 0), w: r2(it.w), text: String(it.text == null ? '' : it.text).split(PAGE_MARK).join('').split(PAGES_MARK).join('') };
        var tm = it.kind === 'text' && it.el ? SINGLE_TOKEN.exec(String(it.el.text || '')) : null;
        if (tm) o.name = splitFmt(tm[1]).expr.trim();
        if (it.raw !== undefined) { o.raw = rawJson(it.raw); o.fmt = it.fmt || null; }
        if (it.isStatic) o.isStatic = true;
        var st = it.st || {};
        if (st.bold) o.bold = true;
        if (st.align) o.align = st.align;
        if (it.rowKind) o.rowKind = it.rowKind;
        return o;
      }) };
  }

  // Collect font families used, so callers can preload them before measuring
  function fontsUsed(layout) {
    var set = {};
    set[(layout.defaults && layout.defaults.fontFamily) || 'Noto Sans'] = 1;
    (layout.bands || []).forEach(function (b) {
      (b.elements || []).forEach(function (e) {
        if (e.style && e.style.fontFamily) set[e.style.fontFamily] = 1;
        ['headerStyle', 'rowStyle', 'totalStyle'].forEach(function (k) { if (e[k] && e[k].fontFamily) set[e[k].fontFamily] = 1; });
      });
    });
    set['Noto Sans Tamil'] = 1; set['Noto Sans Sinhala'] = 1;
    return Object.keys(set);
  }

  function preloadFonts(layout) {
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return Promise.resolve();
    var loads = [];
    fontsUsed(layout).forEach(function (f) {
      ['', 'bold ', 'italic '].forEach(function (w) {
        loads.push(document.fonts.load(w + '10pt "' + f + '"', 'Aa அ අ').catch(function () {}));
      });
    });
    return Promise.all(loads).then(function () { return document.fonts.ready; }).then(function () { measureCache = {}; });
  }

  function renderAsync(layout, data, opts) {
    return preloadFonts(layout).then(function () { return render(layout, data, opts); });
  }

  /* -------------------------------------------- designer representation */
  // HTML for an element as shown on the designer canvas (tokens visible, no data)
  function designHtml(e, defaults, assets) {
    var s = e.style || {}, w = num(e.w, 10), h = num(e.h, 10);
    var fake = { el: e, kind: e.type, x: 0, y: 0, w: w, h: h };
    switch (e.type) {
      case 'text': fake.text = e.text || ''; fake.css = textCss(s, defaults); break;
      case 'image': {
        var a = assets && (assets[e.src] || assets[String(e.src || '').toUpperCase()]);
        fake.src = a || (/^(data:|https?:|\/)/.test(e.src || '') ? e.src : '');
        if (!fake.src) return '<div class="rpt-el" style="' + boxStyle(0, 0, w, h) + 'border:1px dashed #9aa;display:flex;align-items:center;justify-content:center;color:#789;font:11px sans-serif">' + esc(e.src ? 'Image: ' + e.src : 'Image') + '</div>';
        break;
      }
      case 'barcode': fake.value = /\{\{/.test(e.value || '') ? '12345678' : (e.value || '12345678'); break;
      case 'qr': fake.value = /\{\{/.test(e.value || '') ? 'https://example.com/' + String(e.value).replace(/[{}\s]/g, '') : (e.value || 'https://example.com'); break;
      case 'table': {
        var cols = e.columns || [], tw = cols.reduce(function (sum, c) { return sum + num(c.width, 60); }, 0) || 1, sc = w / tw;
        var hs = e.headerStyle || {}, rs = e.rowStyle || {}, out = '', x = 0;
        var headH = e.showHeader === false ? 0 : num(e.headerHeight, 18), rowH = num(e.rowHeight, 16);
        var hasTot = cols.some(function (c) { return c.total && c.total !== 'none'; });
        var firstTot = -1;
        cols.forEach(function (c, ci) { if (firstTot < 0 && c.total && c.total !== 'none') firstTot = ci; });
        var bw = e.borderWidth != null && e.borderWidth !== '' ? num(e.borderWidth) : 0.5, bc = e.borderColor || '#999';
        var b = bw > 0 && e.grid !== 'none' ? bw + 'pt solid ' + bc : '0';
        cols.forEach(function (c, i) {
          var cw = num(c.width, 60) * sc;
          var hcss = textCss({ bold: true, bg: '#eeeeee', align: c.align }, defaults, { padding: 3 });
          var tmp = {}; var k;
          for (k in hs) if (hs[k] !== '' && hs[k] != null) tmp[k] = hs[k];
          if (!tmp.align) tmp.align = c.align;
          hcss = textCss(Object.assign({ bold: true, bg: '#eeeeee' }, tmp), defaults, { padding: 3 });
          var rcss = textCss(Object.assign({}, rs, { align: c.align || rs.align }), defaults, { padding: 3 });
          var bord = 'border-right:' + b + ';border-bottom:' + b + ';' + (i === 0 ? 'border-left:' + b + ';' : '');
          if (headH) out += '<div class="rpt-el" style="' + boxStyle(x, 0, cw, headH) + hcss + bord + 'border-top:' + b + ';' + valignCss('middle') + '"><div class="rpt-tx">' + esc(c.header || '') + '</div></div>';
          out += '<div class="rpt-el" style="' + boxStyle(x, headH, cw, rowH) + rcss + bord + (headH ? '' : 'border-top:' + b + ';') + valignCss('middle') + 'color:#2a5db0"><div class="rpt-tx">' + esc(c.value || '') + '</div></div>';
          var spanW = cw;
          if (hasTot && firstTot > 1 && i === 0) { spanW = 0; for (var q = 0; q < firstTot; q++) spanW += num(cols[q].width, 60) * sc; }
          if (hasTot && !(firstTot > 1 && i > 0 && i < firstTot)) out += '<div class="rpt-el" style="' + boxStyle(x, headH + rowH, spanW, rowH) + textCss({ bold: true, align: (firstTot > 1 && i === 0) ? 'left' : c.align }, defaults, { padding: 3 }) + bord + valignCss('middle') + '"><div class="rpt-tx">' + esc(c.total && c.total !== 'none' ? c.total.toUpperCase() + '()' : (i === 0 ? (e.totalLabel || 'Total') : '')) + '</div></div>';
          x += cw;
        });
        if (!cols.length) out = '<div class="rpt-el" style="' + boxStyle(0, 0, w, h) + 'border:1px dashed #9aa;font:11px sans-serif;color:#789;padding:4px">Table – add columns in properties</div>';
        return out;
      }
    }
    return itemHtml(fake, 0, 0, 1, 1);
  }

  function tableDesignHeight(e) {
    var cols = e.columns || [];
    var hasTot = cols.some(function (c) { return c.total && c.total !== 'none'; });
    return (e.showHeader === false ? 0 : num(e.headerHeight, 18)) + num(e.rowHeight, 16) * (hasTot ? 2 : 1);
  }

  return {
    VERSION: VERSION, FONTS: FONTS, PAPER: PAPER, UNITS: UNITS, BAND_ORDER: BAND_ORDER, BAND_LABELS: BAND_LABELS,
    uid: uid, clone: clone, esc: esc, newLayout: newLayout, normalizeLayout: normalizeLayout, sortBands: sortBands,
    pageSize: pageSize, contentWidth: contentWidth, unitToPt: unitToPt, ptToUnit: ptToUnit,
    render: render, renderAsync: renderAsync, preloadFonts: preloadFonts, fontsUsed: fontsUsed, baseCss: baseCss,
    designHtml: designHtml, tableDesignHeight: tableDesignHeight, textCss: textCss,
    parse: parse, evaluate: evaluate, interpolate: interpolate, formatValue: formatValue, amountInWords: amountInWords,
    code128Codes: code128Codes, code128Svg: code128Svg, C128: C128, qrMatrix: qrMatrix, qrSvg: qrSvg, watermarkItem: watermarkItem, watermarkHtml: watermarkHtml
  };
});
