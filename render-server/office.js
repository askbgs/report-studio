/*
 * Docsmith - Word (.docx) and Excel (.xlsx) output
 *
 * Both builders work from the structured result of RptEngine.render(..., { collect: true }):
 *   doc.pages[] : every item placed on every page (absolute pt positions, merged styles)
 *   doc.body[]  : per document, the body blocks in order (bands, table rows) with raw values
 *
 * Word  = the same layout as the PDF, editable: text in positioned frames, tables as real
 *         Word tables, images as floating pictures, one Word page per report page.
 * Excel = the report as data: label rows, detail rows with real numbers and dates,
 *         group lines and totals on sheet "Report"; every data source on its own sheet.
 */
'use strict';
const docx = require('docx');
const ExcelJS = require('exceljs');

const TW = (v) => Math.round(v * 20);            // points -> twips
const EMU = (v) => Math.round(v * 12700);        // points -> EMU
const PX = (v) => Math.max(1, Math.round(v * 96 / 72));
const hex = (c, d) => {
  if (!c) return d;
  let s = String(c).trim();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  s = s.replace('#', '');
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : d;
};

/* ============================================================== WORD */
// Every report item becomes a VML text box (text, tables, boxes, lines) or a floating picture,
// positioned against the page. All of them hang on ONE empty paragraph per page, so nothing
// flows from one page to the next. The text inside stays editable.
const JSZip = require('jszip');

function runsFor(text, st) {
  const lines = String(text == null ? '' : text).split('\n');
  const font = st.fontFamily || 'Noto Sans';
  const base = {
    font: { ascii: font, hAnsi: font, cs: 'Nirmala UI', eastAsia: font },
    size: Math.round((Number(st.fontSize) || 10) * 2),
    bold: !!st.bold, italics: !!st.italic,
    underline: st.underline ? {} : undefined,
    color: hex(st.color, '000000')
  };
  return lines.map((ln, i) => new docx.TextRun(Object.assign({ text: ln, break: i > 0 ? 1 : undefined }, base)));
}
function alignOf(a) {
  return a === 'center' ? docx.AlignmentType.CENTER : a === 'right' ? docx.AlignmentType.RIGHT
    : a === 'justify' ? docx.AlignmentType.JUSTIFIED : docx.AlignmentType.LEFT;
}
function borderDef(width, color, style) {
  return { style: style === 'dashed' ? docx.BorderStyle.DASHED : style === 'dotted' ? docx.BorderStyle.DOTTED : docx.BorderStyle.SINGLE,
    size: Math.max(2, Math.round(width * 8)), color: hex(color, '000000'), space: 1 };
}
function paraBorders(st) {
  const bw = Number(st.borderWidth) || 0;
  if (bw <= 0) return undefined;
  const sides = st.borderSides || 'TRBL', b = borderDef(bw, st.borderColor, st.borderStyle), o = {};
  if (sides.includes('T')) o.top = b;
  if (sides.includes('R')) o.right = b;
  if (sides.includes('B')) o.bottom = b;
  if (sides.includes('L')) o.left = b;
  return o;
}
const pt = (v) => (Math.round(v * 100) / 100) + 'pt';

// 1x1 PNG of one colour, stretched to any size: how boxes, lines and backgrounds are drawn.
// (Pictures display the same in every Word version and in LibreOffice; VML fills do not.)
const zlib = require('zlib');
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const solidCache = {};
function solidPng(color) {
  const h = hex(color, '000000');
  if (solidCache[h]) return solidCache[h];
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
  return (solidCache[h] = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function solidRun(x, y, w, h, color, behind) {
  return new docx.ImageRun({
    type: 'png', data: solidPng(color), transformation: { width: PX(Math.max(w, 0.75)), height: PX(Math.max(h, 0.75)) },
    floating: {
      horizontalPosition: { relative: docx.HorizontalPositionRelativeFrom.PAGE, offset: EMU(x) },
      verticalPosition: { relative: docx.VerticalPositionRelativeFrom.PAGE, offset: EMU(y) },
      wrap: { type: docx.TextWrappingType.NONE }, allowOverlap: true, behindDocument: behind !== false, lockAnchor: true
    }
  });
}

// The text boxes of one document, in creation order = their order in document.xml
function shapeList() {
  const list = [];
  return {
    list,
    // a plain rectangle: solid fill and/or outline, drawn with stretched one-colour pictures
    rect(x, y, w, h, attrs) {
      const out = [];
      if (attrs.fill) out.push(solidRun(x, y, w, h, attrs.fill));
      if (attrs.stroke) {
        const c = attrs.stroke.color, b = attrs.stroke.weight;
        out.push(solidRun(x, y, w, b, c), solidRun(x, y + h - b, w, b, c), solidRun(x, y, b, h, c), solidRun(x + w - b, y, b, h, c));
      }
      return out;
    },
    box(x, y, w, h, children, attrs) {
      list.push(attrs || {});
      return new docx.Textbox({
        style: { position: 'absolute', left: pt(x), top: pt(y), width: pt(Math.max(w, 0.5)), height: pt(Math.max(h, 0.5)),
          positionHorizontalRelative: 'page', positionVerticalRelative: 'page' },
        children: children && children.length ? children : [new docx.Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: docx.LineRuleType.EXACT }, children: [new docx.TextRun({ text: '', size: 2 })] })]
      });
    }
  };
}

function textBox(shapes, it) {
  const st = it.st || {};
  const fs = Number(st.fontSize) || 10, lh = Number(st.lineHeight) || 1.25;
  const pad = st.padding != null && st.padding !== '' ? Number(st.padding) : 1;
  const para = new docx.Paragraph({
    alignment: alignOf(st.align),
    spacing: { before: 0, after: 0, line: Math.round(240 * lh), lineRule: docx.LineRuleType.AUTO },
    border: paraBorders(st),
    children: runsFor(it.text, st)
  });
  // Word's font metrics differ a little from the browser's: give the text some room, away from its alignment
  const slack = Math.max(2, it.w * 0.04);
  const bx = st.align === 'right' ? it.x - slack : st.align === 'center' ? it.x - slack / 2 : it.x;
  const box = shapes.box(bx, it.y, it.w + slack, it.h, [para], {
    inset: pad, anchor: it.valign === 'middle' ? 'middle' : it.valign === 'bottom' ? 'bottom' : 'top', grow: true
  });
  // a background goes on a separate rectangle behind the text
  return st.bg ? shapes.rect(it.x, it.y, it.w, it.h, { fill: '#' + hex(st.bg, 'FFFFFF') }).concat([box]) : [box];
}
function shapeBox(shapes, it) {
  const st = it.st || {};
  if (it.kind === 'line') {                     // straight lines = thin filled boxes in the line colour
    const lw = Math.max(Number(st.lineWidth) || 1, 0.25);
    const col = '#' + hex(st.color, '000000');
    return it.dir === 'v'
      ? shapes.rect(it.x + it.w / 2 - lw / 2, it.y, lw, it.h, { fill: col })
      : shapes.rect(it.x, it.y + it.h / 2 - lw / 2, it.w, lw, { fill: col });
  }
  const bw = Number(st.borderWidth) || 0, sides = st.borderSides || 'TRBL';
  const out = [];
  if (st.bg || (bw > 0 && sides === 'TRBL')) out.push(...shapes.rect(it.x, it.y, it.w, it.h, {
    fill: st.bg ? '#' + hex(st.bg, 'FFFFFF') : null,
    stroke: bw > 0 && sides === 'TRBL' ? { color: '#' + hex(st.borderColor, '000000'), weight: bw } : null }));
  if (bw > 0 && sides !== 'TRBL') {             // single sides = thin bars
    const c = '#' + hex(st.borderColor, '000000');
    if (sides.includes('T')) out.push(...shapes.rect(it.x, it.y, it.w, bw, { fill: c }));
    if (sides.includes('B')) out.push(...shapes.rect(it.x, it.y + it.h - bw, it.w, bw, { fill: c }));
    if (sides.includes('L')) out.push(...shapes.rect(it.x, it.y, bw, it.h, { fill: c }));
    if (sides.includes('R')) out.push(...shapes.rect(it.x + it.w - bw, it.y, bw, it.h, { fill: c }));
  }
  return out;
}
function dataUriBytes(src) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src || '');
  if (!m) return null;
  const type = /png/.test(m[1]) ? 'png' : /jpe?g/.test(m[1]) ? 'jpg' : /gif/.test(m[1]) ? 'gif' : /bmp/.test(m[1]) ? 'bmp' : null;
  if (!type) return null;
  return { type, data: m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])) };
}
function floatingImage(it) {
  const img = dataUriBytes(it.png || it.src);
  if (!img) return null;
  let w = it.w, h = it.h, x = it.x, y = it.y;
  if (it.nw && it.nh && it.fit !== 'stretch') {        // contain: keep the aspect ratio inside the box
    const r = Math.min(it.w / it.nw, it.h / it.nh);
    w = it.nw * r; h = it.nh * r; x = it.x + (it.w - w) / 2; y = it.y + (it.h - h) / 2;
  }
  return new docx.ImageRun({
    type: img.type, data: img.data, transformation: { width: PX(w), height: PX(h) },
    floating: {
      horizontalPosition: { relative: docx.HorizontalPositionRelativeFrom.PAGE, offset: EMU(x) },
      verticalPosition: { relative: docx.VerticalPositionRelativeFrom.PAGE, offset: EMU(y) },
      wrap: { type: docx.TextWrappingType.NONE }, allowOverlap: true, behindDocument: !!it.raster, lockAnchor: true
    }
  });
}

// Cells of one table element on one page -> runs of rows that touch each other -> one Word table each
function tableGroups(cells) {
  const byTable = {};
  cells.forEach((c) => { (byTable[c.tid || 't'] = byTable[c.tid || 't'] || []).push(c); });
  const groups = [];
  Object.keys(byTable).forEach((k) => {
    const rowsMap = {};
    byTable[k].forEach((c) => { const key = c.y.toFixed(1); (rowsMap[key] = rowsMap[key] || []).push(c); });
    const rows = Object.keys(rowsMap).map((key) => rowsMap[key].sort((a, b) => a.x - b.x)).sort((a, b) => a[0].y - b[0].y);
    let cur = null;
    rows.forEach((r) => {
      const y = r[0].y, h = Math.max(...r.map((c) => c.h));
      if (cur && Math.abs(cur.bottom - y) < 1) { cur.rows.push(r); cur.bottom = y + h; }
      else { cur = { rows: [r], top: y, bottom: y + h }; groups.push(cur); }
    });
  });
  return groups;
}
function wordTable(g) {
  const edges = new Set();
  g.rows.forEach((r) => r.forEach((c) => { edges.add(Math.round(c.x * 10) / 10); edges.add(Math.round((c.x + c.w) * 10) / 10); }));
  const xs = Array.from(edges).sort((a, b) => a - b);
  const colW = xs.slice(1).map((x, i) => TW(x - xs[i]));
  const idx = (x) => { let best = 0; xs.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i; }); return best; };
  const none = { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const rows = g.rows.map((r) => {
    const h = Math.max(...r.map((c) => c.h));
    return new docx.TableRow({
      height: { value: TW(h), rule: docx.HeightRule.ATLEAST },
      cantSplit: true,
      children: r.map((c) => {
        const st = c.st || {}, b = c.borders;
        const bd = b ? borderDef(b.w, b.c) : null;
        const span = Math.max(1, idx(c.x + c.w) - idx(c.x));
        return new docx.TableCell({
          columnSpan: span > 1 ? span : undefined,
          verticalAlign: c.valign === 'top' ? docx.VerticalAlign.TOP : c.valign === 'bottom' ? docx.VerticalAlign.BOTTOM : docx.VerticalAlign.CENTER,
          shading: st.bg ? { type: docx.ShadingType.CLEAR, fill: hex(st.bg, 'FFFFFF'), color: 'auto' } : undefined,
          margins: { top: 20, bottom: 20, left: 60, right: 60 },
          borders: {
            top: bd && b.t ? bd : none, bottom: bd && b.b ? bd : none,
            left: bd && b.l ? bd : none, right: bd && b.r ? bd : none
          },
          children: [new docx.Paragraph({ alignment: alignOf(st.align), spacing: { before: 0, after: 0 }, children: runsFor(c.text, st) })]
        });
      })
    });
  });
  const table = new docx.Table({
    rows, columnWidths: colW, layout: docx.TableLayoutType.FIXED,
    width: { size: colW.reduce((a, b) => a + b, 0), type: docx.WidthType.DXA },
    margins: { left: 0, right: 0 }
  });
  return { table, x: xs[0], y: g.top, w: xs[xs.length - 1] - xs[0], h: g.bottom - g.top };
}

// Second pass over document.xml: give each text box its fill, outline, inner margin and anchor
function vmlAttrs(a) {
  let s = a.fill ? ' filled="t" fillcolor="' + a.fill + '"' : ' filled="f"';
  s += a.stroke ? ' stroked="t" strokecolor="' + a.stroke.color + '" strokeweight="' + a.stroke.weight + 'pt"' : ' stroked="f"';
  return s;
}
async function finishVml(buf, shapes) {
  const zip = await JSZip.loadAsync(buf);
  let xml = await zip.file('word/document.xml').async('string');
  let i = 0;
  // every Textbox is one <w:pict> block, in the order the shapes were created
  xml = xml.replace(/<w:pict>([\s\S]*?)<\/w:pict>/g, (block, inner) => {
    const a = shapes.list[i++] || {};
    const sm = /<v:shape ([^>]*?)style="([^"]*)"/.exec(inner);
    if (!sm) return block;
    const style = sm[2].replace(/;?mso-wrap-style:none/, '');
    const ins = (a.inset || 0) + 'pt';
    inner = inner
      .replace(/(<v:shape [^>]*?)style="[^"]*"/, '$1style="' + style + ';mso-wrap-style:square;v-text-anchor:' + (a.anchor || 'top') + '"' + vmlAttrs(a))
      .replace(/<v:textbox style="[^"]*">/, '<v:textbox inset="' + [ins, ins, ins, ins].join(',') + '"' + (a.grow ? ' style="mso-fit-shape-to-text:t"' : '') + '>');
    return '<w:pict>' + inner.replace('</v:textbox>', '</v:textbox><w10:wrap type="none"/>') + '</w:pict>';
  });
  if (!/xmlns:w10=/.test(xml)) xml = xml.replace('<w:document ', '<w:document xmlns:w10="urn:schemas-microsoft-com:office:word" ');
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function buildDocx(doc, opts) {
  opts = opts || {};
  const shapes = shapeList();
  const anchorPara = (runs) => new docx.Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: docx.LineRuleType.EXACT },
    children: runs.length ? runs : [new docx.TextRun({ text: '', size: 2 })] });
  const sections = doc.pages.map((pg) => {
    const runs = [], cells = [];
    // keep the paint order of the report: earlier items are drawn first (behind later ones)
    pg.items.forEach((it) => {
      if (it.kind === 'cell') { cells.push(it); return; }
      if (it.png || it.kind === 'image' || it.kind === 'barcode' || it.kind === 'qr') { const im = floatingImage(it); if (im) runs.push(im); return; }
      if (it.kind === 'text') runs.push(...textBox(shapes, it));
      else if (it.kind === 'rect' || it.kind === 'line') runs.push(...shapeBox(shapes, it));
    });
    tableGroups(cells).forEach((g) => {
      const t = wordTable(g);
      runs.push(shapes.box(t.x, t.y, t.w + 1, t.h, [t.table, new docx.Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: docx.LineRuleType.EXACT }, children: [] })], { inset: 0, grow: true }));
    });
    return {
      properties: {
        type: docx.SectionType.NEXT_PAGE,
        page: {
          // the library swaps width and height itself for landscape pages: give them in portrait order
          size: doc.width > doc.height
            ? { width: TW(doc.height), height: TW(doc.width), orientation: docx.PageOrientation.LANDSCAPE }
            : { width: TW(doc.width), height: TW(doc.height), orientation: docx.PageOrientation.PORTRAIT },
          margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 }
        }
      },
      children: [anchorPara(runs)]
    };
  });
  if (!sections.length) sections.push({ children: [new docx.Paragraph('')] });
  const d = new docx.Document({ creator: 'Docsmith', title: opts.title || doc.title || 'Report', description: 'Generated by Docsmith', sections });
  return finishVml(await docx.Packer.toBuffer(d), shapes);
}

/* ============================================================== EXCEL */
// Docsmith / Oracle-style format -> Excel number format
function excelNumFmt(fmt) {
  if (!fmt) return null;
  let f = String(fmt).trim();
  if (/^(upper|lower|trim|words)$/i.test(f)) return null;
  if (/[GD9]/.test(f) && !/[#0]/.test(f)) {          // Oracle style 999G999D99
    const dec = (f.split('D')[1] || '').replace(/[^9]/g, '').length;
    f = '#,##0' + (dec ? '.' + '0'.repeat(dec) : '');
  }
  const m = /^([^#0,.%]*)([#0,.]+%?)(.*)$/.exec(f);
  if (!m) return null;
  const pre = m[1] ? '"' + m[1].replace(/"/g, '') + '"' : '', post = m[3] ? '"' + m[3].replace(/"/g, '') + '"' : '';
  return pre + m[2] + post;
}
function excelDateFmt(fmt) {
  const f = String(fmt || 'DD-Mon-YYYY');
  return f.replace(/YYYY/gi, 'yyyy').replace(/\bYY\b/gi, 'yy').replace(/MONTH/gi, 'mmmm').replace(/MON/gi, 'mmm')
    .replace(/HH24/gi, 'hh').replace(/HH/gi, 'hh').replace(/MI/gi, '§').replace(/MM/g, 'mm').replace(/\bDAY\b/gi, 'dddd').replace(/\bDY\b/gi, 'ddd')
    .replace(/DD/gi, 'dd').replace(/SS/gi, 'ss').replace(/\bAM\b|\bPM\b/gi, 'AM/PM').replace(/§/g, 'mm');
}
function cellValue(item) {
  const r = item.raw;
  if (r && typeof r === 'object' && r.d) {
    const p = r.d.split(/[-T:]/).map(Number);
    return { v: new Date(Date.UTC(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0, p[5] || 0)), numFmt: excelDateFmt(item.fmt) };
  }
  if (typeof r === 'number' && isFinite(r) && !/^(words)$/i.test(item.fmt || '')) return { v: r, numFmt: excelNumFmt(item.fmt) || (Number.isInteger(r) ? '0' : '#,##0.00') };
  return { v: item.text };
}
const prettify = (name) => String(name || '').replace(/^.*\./, '').replace(/[_]+/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function overlap(a, b) { return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)); }
function colFor(cols, it) {
  let best = -1, bestO = 0;
  cols.forEach((c, i) => { const o = overlap(c, it); if (o > bestO) { bestO = o; best = i; } });
  if (best >= 0) return best;
  let near = 0;
  cols.forEach((c, i) => { if (Math.abs(c.x - it.x) < Math.abs(cols[near].x - it.x)) near = i; });
  return near;
}
function linesOf(items) {           // group a band's items into visual lines (same y)
  const lines = [];
  items.slice().sort((a, b) => a.y - b.y || a.x - b.x).forEach((it) => {
    const ln = lines.find((l) => Math.abs(l.y - it.y) < 4);
    if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
  });
  lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
  return lines;
}

async function buildXlsx(doc, data, opts) {
  opts = opts || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Docsmith'; wb.created = new Date();
  const ws = wb.addWorksheet('Report', { properties: { defaultColWidth: 14 }, views: [{ showGridLines: true }] });
  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
  const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F8' } };
  const thin = { style: 'thin', color: { argb: 'FFBFC3D1' } };
  let rowNo = 1, maxCols = 1, freezeAt = 0;
  const widths = [];
  const noteWidth = (i, text, pt) => {
    const w = Math.min(60, Math.max(widths[i] || 8, pt ? pt / 5.5 : 0, String(text || '').split('\n').reduce((m, l) => Math.max(m, l.length), 0) * 1.1));
    widths[i] = w;
  };

  ws.getCell(1, 1).value = opts.title || doc.title || 'Report';
  let dataRows = 0;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  rowNo = 3;

  (doc.body || []).forEach((d, di) => {
    if (di > 0) rowNo += 1;
    const blocks = d.blocks || [];
    // Main column grid: the first detail band with 2+ fields, else the first table header
    const firstDetail = blocks.find((b) => b.band === 'detail' && b.kind === 'band' && b.items.length >= 2);
    const firstHeader = blocks.find((b) => b.kind === 'tableHeader');
    const grid = (firstDetail || firstHeader || { items: [] }).items.slice().sort((a, b) => a.x - b.x).map((it) => ({ x: it.x, w: it.w, name: it.name }));
    const tableGrids = {};
    let pending = null, headerDone = false, lastTable = null;

    const writeRow = (cells, kind) => {
      const row = ws.getRow(rowNo);
      cells.forEach((c, i) => {
        if (c == null) return;
        const cell = row.getCell(i + 1);
        const cv = cellValue(c);
        cell.value = cv.v === '' ? null : cv.v;
        if (cv.numFmt) cell.numFmt = cv.numFmt;
        cell.alignment = { vertical: 'top', wrapText: true, horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : undefined };
        if (kind === 'header') { cell.font = { bold: true }; cell.fill = HEADER_FILL; cell.border = { bottom: thin, top: thin }; }
        else if (kind === 'total') { cell.font = { bold: true }; cell.fill = TOTAL_FILL; cell.border = { top: thin }; }
        else if (kind === 'group') cell.font = { bold: true };
        else if (c.bold) cell.font = { bold: true };
        noteWidth(i, c.text, kind === 'header' || kind === 'data' ? c.w : 0);
      });
      maxCols = Math.max(maxCols, cells.length);
      rowNo++;
    };
    const flushPending = () => { if (pending) { pending.forEach((ln) => writeRow(ln.cells, ln.kind)); pending = null; } };

    blocks.forEach((b) => {
      if (b.kind === 'tableHeader' || b.kind === 'tableRow' || b.kind === 'tableTotal') {
        flushPending();
        const g = tableGrids[b.table] = tableGrids[b.table] || b.items.map((it) => ({ x: it.x, w: it.w }));
        if (b.kind === 'tableHeader') {
          if (lastTable === b.table) return;            // repeated header (page break) - write once
          lastTable = b.table;
        }
        const cells = new Array(g.length).fill(null);
        b.items.forEach((it) => { cells[colFor(g, it)] = it; });
        if (b.kind === 'tableHeader') { writeRow(cells, 'header'); if (!freezeAt) freezeAt = rowNo - 1; }
        else { writeRow(cells, b.kind === 'tableTotal' ? 'total' : 'data'); if (b.kind === 'tableRow') dataRows++; }
        return;
      }
      if (!b.items.length) return;
      if (b.band === 'detail' && grid.length) {
        if (!headerDone) {
          // the label row is the last pending line whose texts are all static and sit over the fields
          let labels = null;
          if (pending && pending.length) {
            const last = pending[pending.length - 1];
            if (last.src.every((it) => it.isStatic) && last.src.length >= Math.min(2, grid.length)) labels = pending.pop();
          }
          flushPending();
          const hdr = grid.map((g) => ({ text: prettify(g.name) || '', w: g.w }));
          if (labels) labels.src.forEach((it) => { hdr[colFor(grid, it)] = { text: it.text, w: grid[colFor(grid, it)].w }; });
          writeRow(hdr, 'header');
          freezeAt = freezeAt || rowNo - 1;
          headerDone = true;
        }
        flushPending();
        const cells = new Array(grid.length).fill(null);
        b.items.forEach((it) => { const i = colFor(grid, it); cells[i] = cells[i] ? Object.assign({}, cells[i], { text: cells[i].text + ' ' + it.text, raw: undefined }) : it; });
        writeRow(cells, 'data');
        dataRows++;
        return;
      }
      // any other band: one Excel row per visual line, placed under the matching columns
      linesOf(b.items).forEach((ln) => {
        const kind = b.band === 'groupHeader' ? 'group' : (b.band === 'groupFooter' || b.band === 'summary') && headerDone ? 'total' : 'text';
        let cells;
        if (grid.length && (headerDone || b.band !== 'reportHeader')) {
          cells = new Array(grid.length).fill(null);
          ln.items.forEach((it) => { const i = colFor(grid, it); cells[i] = cells[i] ? Object.assign({}, cells[i], { text: cells[i].text + ' ' + it.text, raw: undefined }) : it; });
        } else {
          cells = ln.items;
        }
        if (cells.every((c) => !c || String(c.text).trim() === '')) return;
        (pending = pending || []).push({ cells, kind, src: ln.items });
      });
      if (headerDone) flushPending();
    });
    flushPending();
  });

  for (let i = 0; i < maxCols; i++) ws.getColumn(i + 1).width = Math.max(8, Math.round(widths[i] || 12));
  // freeze the column labels on real listings only (not on letters with a small table)
  if (freezeAt && dataRows >= 15 && (doc.body || []).length === 1) ws.views = [{ state: 'frozen', ySplit: freezeAt }];

  // Raw data: one sheet per data source
  const used = new Set(['REPORT']);
  Object.keys((data && data.sources) || {}).forEach((name) => {
    const src = data.sources[name] || {}, rows = src.rows || [];
    let sheet = String(name).replace(/[\\/*?:[\]]/g, '_').slice(0, 31) || 'Data';
    while (used.has(sheet.toUpperCase())) sheet = sheet.slice(0, 28) + '_' + used.size;
    used.add(sheet.toUpperCase());
    const s = wb.addWorksheet(sheet);
    const cols = (src.columns && src.columns.length ? src.columns.map((c) => c.name || c) : Object.keys(rows[0] || {}));
    s.addRow(cols).font = { bold: true };
    s.getRow(1).fill = HEADER_FILL;
    rows.forEach((r) => {
      const keys = Object.keys(r), find = (c) => keys.find((k) => k.toUpperCase() === String(c).toUpperCase());
      s.addRow(cols.map((c) => {
        const v = r[find(c)];
        if (typeof v === 'string' && /^\d{4}-\d\d-\d\d(T\d\d:\d\d(:\d\d)?)?/.test(v)) { const d = new Date(v.length === 10 ? v + 'T00:00:00Z' : v); if (!isNaN(d)) return d; }
        return v == null ? null : v;
      }));
    });
    cols.forEach((c, i) => { s.getColumn(i + 1).width = Math.min(50, Math.max(10, String(c).length + 2)); });
    s.views = [{ state: 'frozen', ySplit: 1 }];
    if (rows.length) s.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  });
  return wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
}

module.exports = { buildDocx, buildXlsx };
