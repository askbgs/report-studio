/* Report Studio sample reports (used by the offline demo and by db/05_samples.sql generator) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RptSamples = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CW = 538.58; // A4 width minus 2 x 10 mm margins
  var navy = '#1f3a5f', muted = '#6b7686', soft = '#f6f8fb', rule = '#d0d6de';
  function t(x, y, w, h, text, style, extra) {
    var e = { type: 'text', x: x, y: y, w: w, h: h, text: text, style: style || {} };
    for (var k in (extra || {})) e[k] = extra[k];
    return e;
  }
  function line(x, y, w, style) { return { type: 'line', x: x, y: y, w: w, h: 4, dir: 'h', style: style || { lineWidth: 0.75, color: rule } }; }

  var LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="26" fill="#1f3a5f"/>' +
    '<path d="M30 84V36h26c11 0 19 7 19 17 0 7-4 12-10 15l13 16H63L52 70h-9v14zm13-25h12c4 0 7-3 7-6s-3-6-7-6H43z" fill="#fff"/>' +
    '<circle cx="88" cy="80" r="9" fill="#f5b942"/></svg>';

  var invoice = {
    report: { code: 'INVOICE', name: 'Sales Invoice', description: 'Sample invoice: bands, groups, sub-totals, amount in words, Tamil/Sinhala text, barcode, QR code', status: 'PUBLISHED' },
    sources: [
      { name: 'HEADER', params: { INVOICE_NO: 'INV-2026-0042' }, sql:
        "select nvl(:INVOICE_NO, 'INV-2026-0042')        as inv_no,\n" +
        "       trunc(sysdate)                            as inv_date,\n" +
        "       trunc(sysdate) + 30                       as due_date,\n" +
        "       'Net 30 days'                             as terms,\n" +
        "       'Ceylon Hardware Stores'                  as customer,\n" +
        "       'No. 25, Inner Harbour Road' || chr(10) ||\n" +
        "       'Trincomalee 31000, Sri Lanka'            as address,\n" +
        "       '+94 26 222 1234'                         as phone\n" +
        "  from dual" },
      { name: 'LINES', params: {}, sql:
        "select line_no, category, description, qty, price, qty * price as amount\n" +
        "  from (select level as line_no,\n" +
        "               case when level <= 14 then 'Electrical'\n" +
        "                    when level <= 30 then 'Hardware'\n" +
        "                    else 'Paints' end as category,\n" +
        "               'Product P-' || lpad(level, 4, '0') ||\n" +
        "               case when mod(level, 6) = 0\n" +
        "                    then ' - heavy duty model with extended warranty, delivered and installed on site by our technicians'\n" +
        "               end as description,\n" +
        "               mod(level * 7, 9) + 1 as qty,\n" +
        "               round(250 + mod(level * 37, 50) * 95.5, 2) as price\n" +
        "          from dual connect by level <= 44)\n" +
        " order by category, line_no" }
    ],
    layout: {
      version: 1,
      page: { size: 'A4', orientation: 'portrait', unit: 'mm', margin: { top: 28.35, right: 28.35, bottom: 28.35, left: 28.35 } },
      defaults: { fontFamily: 'Noto Sans', fontSize: 9, color: '#1f2a37' },
      detailSource: 'LINES',
      groups: [{ field: 'CATEGORY', newPage: false }],
      batch: { source: '', key: '' },
      bands: [
        { type: 'pageHeader', height: 74, elements: [
          { type: 'image', x: 0, y: 0, w: 54, h: 54, src: 'LOGO', fit: 'contain', style: {} },
          t(64, 3, 280, 20, 'Lanka Traders (Pvt) Ltd', { fontSize: 15, bold: true, color: navy }),
          t(64, 24, 290, 28, 'No. 12, Main Street, Trincomalee · +94 26 222 0000\ninfo@lankatraders.lk · VAT 114567890-7000', { fontSize: 7.5, color: muted }),
          t(338.58, 0, 200, 30, 'INVOICE', { fontSize: 22, bold: true, color: navy, align: 'right' }),
          t(338.58, 30, 200, 14, '{{INV_NO}}', { fontSize: 9, color: muted, align: 'right' }),
          line(0, 62, CW, { lineWidth: 1.5, color: navy })
        ] },
        { type: 'reportHeader', height: 96, elements: [
          { type: 'rect', x: 0, y: 4, w: 300, h: 82, style: { bg: soft, radius: 4 } },
          t(10, 11, 280, 12, 'BILL TO  ·  வாடிக்கையாளர்  ·  පාරිභෝගිකයා', { fontSize: 7, bold: true, color: muted }),
          t(10, 25, 280, 16, '{{CUSTOMER}}', { fontSize: 11, bold: true }),
          t(10, 42, 280, 36, '{{ADDRESS}}\n{{PHONE}}', { fontSize: 8.5 }, { canGrow: true }),
          t(318, 8, 100, 14, 'Invoice date', { fontSize: 8, color: muted }),
          t(418, 8, 120.58, 14, '{{INV_DATE|DD-Mon-YYYY}}', { align: 'right', bold: true }),
          t(318, 23, 100, 14, 'Due date', { fontSize: 8, color: muted }),
          t(418, 23, 120.58, 14, '{{DUE_DATE|DD-Mon-YYYY}}', { align: 'right' }),
          t(318, 38, 100, 14, 'Terms', { fontSize: 8, color: muted }),
          t(418, 38, 120.58, 14, '{{TERMS}}', { align: 'right' }),
          { type: 'barcode', x: 388.58, y: 56, w: 150, h: 30, value: '{{INV_NO}}', showText: true, style: { fontSize: 7 } }
        ] },
        { type: 'groupHeader', group: 0, height: 36, elements: [
          t(0, 6, 300, 14, '{{CATEGORY}}  ({{COUNT()}} items)', { fontSize: 9.5, bold: true, color: navy }),
          t(0, 21, 24, 13, '#', { fontSize: 7.5, bold: true, color: muted }),
          t(26, 21, 280, 13, 'DESCRIPTION', { fontSize: 7.5, bold: true, color: muted }),
          t(306, 21, 50, 13, 'QTY', { fontSize: 7.5, bold: true, color: muted, align: 'right' }),
          t(356, 21, 86, 13, 'UNIT PRICE', { fontSize: 7.5, bold: true, color: muted, align: 'right' }),
          t(442, 21, 96.58, 13, 'AMOUNT', { fontSize: 7.5, bold: true, color: muted, align: 'right' }),
          line(0, 32, CW)
        ] },
        { type: 'detail', height: 16, elements: [
          { type: 'rect', x: 0, y: 0, w: CW, h: 16, stretch: true, printWhen: 'ROWNUM % 2 == 0', style: { bg: '#f7f9fc' } },
          t(0, 0, 24, 16, '{{LINE_NO}}', { color: muted, valign: 'middle' }),
          t(26, 0, 280, 16, '{{DESCRIPTION}}', { valign: 'middle' }, { canGrow: true }),
          t(306, 0, 50, 16, '{{QTY}}', { align: 'right', valign: 'middle' }),
          t(356, 0, 86, 16, '{{PRICE|#,##0.00}}', { align: 'right', valign: 'middle' }),
          t(442, 0, 96.58, 16, '{{AMOUNT|#,##0.00}}', { align: 'right', valign: 'middle' })
        ] },
        { type: 'groupFooter', group: 0, height: 24, elements: [
          line(306, 1, 232.58),
          t(306, 6, 136, 14, 'Subtotal · {{CATEGORY}}', { fontSize: 8, color: muted, align: 'right' }),
          t(442, 6, 96.58, 14, '{{SUM(AMOUNT)|#,##0.00}}', { align: 'right', bold: true })
        ] },
        { type: 'summary', height: 190, elements: [
          { type: 'rect', x: 318, y: 8, w: 220.58, h: 72, style: { bg: soft, radius: 4 } },
          t(328, 14, 100, 14, 'Subtotal', { color: muted }),
          t(428, 14, 100, 14, '{{SUM(AMOUNT)|#,##0.00}}', { align: 'right' }),
          t(328, 30, 100, 14, 'VAT 18%', { color: muted }),
          t(428, 30, 100, 14, '{{ROUND(SUM(AMOUNT)*0.18,2)|#,##0.00}}', { align: 'right' }),
          line(328, 46, 200.58, { lineWidth: 0.75, color: '#9aa5b5' }),
          t(328, 54, 100, 18, 'Total (LKR)', { fontSize: 11, bold: true, color: navy }),
          t(408, 54, 120, 18, '{{ROUND(SUM(AMOUNT)*1.18,2)|#,##0.00}}', { fontSize: 11, bold: true, color: navy, align: 'right' }),
          t(0, 10, 300, 12, 'AMOUNT IN WORDS', { fontSize: 7, bold: true, color: muted }),
          t(0, 23, 300, 28, '{{WORDS(ROUND(SUM(AMOUNT)*1.18,2),\'Rupees\',\'Cents\')}} Only', { italic: true }, { canGrow: true }),
          t(0, 92, 320, 16, 'நன்றி! மீண்டும் வருக  ·  ස්තුතියි, නැවත එන්න  ·  Thank you!', { fontSize: 10, color: navy }),
          line(358.58, 118, 180, { lineWidth: 0.75, color: '#555555', dash: 'dashed' }),
          t(358.58, 124, 180, 12, 'Authorised signature', { fontSize: 7.5, color: muted, align: 'center' }),
          { type: 'qr', x: 0, y: 116, w: 66, h: 66, value: 'https://pay.example.lk/invoice/{{INV_NO}}?amount={{ROUND(SUM(AMOUNT)*1.18,2)}}', ecc: 'M', quiet: true, style: { color: navy } },
          t(72, 132, 220, 12, 'SCAN TO PAY OR VERIFY', { fontSize: 7, bold: true, color: muted }),
          t(72, 145, 220, 24, 'pay.example.lk/invoice/{{INV_NO}}', { fontSize: 8, color: navy })
        ] },
        { type: 'pageFooter', height: 22, elements: [
          line(0, 0, CW, { lineWidth: 0.5, color: rule }),
          t(0, 7, 300, 12, 'Printed by {{APP_USER}} on {{NOW|DD-Mon-YYYY HH24:MI}}', { fontSize: 7, color: '#8a94a6' }),
          t(338.58, 7, 200, 12, 'Page {{PAGE}} of {{PAGES}}', { fontSize: 7, color: '#8a94a6', align: 'right' })
        ] }
      ]
    },
    mock: function (name, params) {
      if (name === 'HEADER') {
        var d = new Date(); d.setHours(0, 0, 0, 0);
        var due = new Date(d.getTime() + 30 * 864e5);
        var iso = function (x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') + 'T00:00:00'; };
        return { columns: [{ name: 'INV_NO', type: 'VARCHAR2' }, { name: 'INV_DATE', type: 'DATE' }, { name: 'DUE_DATE', type: 'DATE' }, { name: 'TERMS', type: 'VARCHAR2' }, { name: 'CUSTOMER', type: 'VARCHAR2' }, { name: 'ADDRESS', type: 'VARCHAR2' }, { name: 'PHONE', type: 'VARCHAR2' }],
          rows: [{ INV_NO: (params && params.INVOICE_NO) || 'INV-2026-0042', INV_DATE: iso(d), DUE_DATE: iso(due), TERMS: 'Net 30 days', CUSTOMER: 'Ceylon Hardware Stores', ADDRESS: 'No. 25, Inner Harbour Road\nTrincomalee 31000, Sri Lanka', PHONE: '+94 26 222 1234' }] };
      }
      if (name === 'LINES') {
        var rows = [];
        for (var i = 1; i <= 44; i++) {
          var qty = (i * 7) % 9 + 1, price = Math.round((250 + ((i * 37) % 50) * 95.5) * 100) / 100;
          rows.push({ LINE_NO: i, CATEGORY: i <= 14 ? 'Electrical' : i <= 30 ? 'Hardware' : 'Paints',
            DESCRIPTION: 'Product P-' + String(i).padStart(4, '0') + (i % 6 === 0 ? ' - heavy duty model with extended warranty, delivered and installed on site by our technicians' : ''),
            QTY: qty, PRICE: price, AMOUNT: Math.round(qty * price * 100) / 100 });
        }
        rows.sort(function (a, b) { return a.CATEGORY < b.CATEGORY ? -1 : a.CATEGORY > b.CATEGORY ? 1 : a.LINE_NO - b.LINE_NO; });
        return { columns: [{ name: 'LINE_NO', type: 'NUMBER' }, { name: 'CATEGORY', type: 'VARCHAR2' }, { name: 'DESCRIPTION', type: 'VARCHAR2' }, { name: 'QTY', type: 'NUMBER' }, { name: 'PRICE', type: 'NUMBER' }, { name: 'AMOUNT', type: 'NUMBER' }], rows: rows };
      }
    }
  };

  var stock = {
    report: { code: 'STOCK_LIST', name: 'Stock List', description: 'Sample list report: flowing table with repeated header, zebra rows and totals', status: 'PUBLISHED' },
    sources: [
      { name: 'STOCK', params: { MIN_QTY: '0' }, sql:
        "select level as item_no,\n" +
        "       'SKU-' || lpad(level * 13, 5, '0') as sku,\n" +
        "       initcap(decode(mod(level, 5), 0, 'cable roll', 1, 'paint tin', 2, 'hinge set', 3, 'led bulb', 'wall plug')) || ' ' || level as item_name,\n" +
        "       decode(mod(level, 3), 0, 'Colombo', 1, 'Trincomalee', 'Kandy') as store,\n" +
        "       mod(level * 17, 120) as on_hand,\n" +
        "       round(120 + mod(level * 29, 40) * 22.75, 2) as unit_cost,\n" +
        "       mod(level * 17, 120) * round(120 + mod(level * 29, 40) * 22.75, 2) as stock_value\n" +
        "  from dual\n" +
        " where mod(level * 17, 120) >= to_number(nvl(:MIN_QTY, '0'))\n" +
        "connect by level <= 75" }
    ],
    layout: {
      version: 1,
      page: { size: 'A4', orientation: 'portrait', unit: 'mm', margin: { top: 28.35, right: 28.35, bottom: 28.35, left: 28.35 } },
      defaults: { fontFamily: 'Noto Sans', fontSize: 8.5, color: '#1f2a37' },
      detailSource: '', groups: [], batch: { source: '', key: '' },
      bands: [
        { type: 'pageHeader', height: 40, elements: [
          t(0, 0, 360, 20, 'Stock on hand', { fontSize: 15, bold: true, color: navy }),
          t(0, 20, 360, 12, 'Lanka Traders (Pvt) Ltd · items with at least {{:MIN_QTY}} units', { fontSize: 8, color: muted }),
          t(338.58, 4, 200, 12, '{{TODAY|DD-Mon-YYYY}}', { fontSize: 8, color: muted, align: 'right' }),
          line(0, 34, CW, { lineWidth: 1, color: navy })
        ] },
        { type: 'reportHeader', height: 48, elements: [
          { type: 'table', x: 0, y: 4, w: CW, h: 34, source: 'STOCK', headerHeight: 18, rowHeight: 15, zebra: true, zebraColor: '#f4f7fb',
            grid: 'horizontal', borderWidth: 0.5, borderColor: '#d5dbe3', repeatHeader: true, canGrow: true, totalLabel: 'Total ({{COUNT()}} items)',
            headerStyle: { bg: navy, color: '#ffffff', bold: true, fontSize: 8 }, rowStyle: {}, totalStyle: { bg: '#e8edf3' },
            columns: [
              { header: '#', value: '{{ITEM_NO}}', width: 30, align: 'right', total: 'none' },
              { header: 'SKU', value: '{{SKU}}', width: 70, align: 'left', total: 'none' },
              { header: 'Item', value: '{{ITEM_NAME}}', width: 150, align: 'left', total: 'none' },
              { header: 'Store', value: '{{STORE}}', width: 80, align: 'left', total: 'none' },
              { header: 'On hand', value: '{{ON_HAND}}', width: 60, align: 'right', total: 'sum' },
              { header: 'Unit cost', value: '{{UNIT_COST|#,##0.00}}', width: 70, align: 'right', total: 'none' },
              { header: 'Value (LKR)', value: '{{STOCK_VALUE|#,##0.00}}', width: 78.58, align: 'right', total: 'sum' }
            ] }
        ] },
        { type: 'detail', height: 0, elements: [] },
        { type: 'pageFooter', height: 18, elements: [
          t(0, 4, 300, 12, 'STOCK_LIST · {{APP_USER}}', { fontSize: 7, color: '#8a94a6' }),
          t(338.58, 4, 200, 12, 'Page {{PAGE}} / {{PAGES}}', { fontSize: 7, color: '#8a94a6', align: 'right' })
        ] }
      ]
    },
    mock: function (name, params) {
      var min = Number((params && params.MIN_QTY) || 0), rows = [];
      var names = ['cable roll', 'paint tin', 'hinge set', 'led bulb', 'wall plug'];
      for (var i = 1; i <= 75; i++) {
        var oh = (i * 17) % 120;
        if (oh < min) continue;
        var cost = Math.round((120 + ((i * 29) % 40) * 22.75) * 100) / 100;
        var nm = names[i % 5].replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); });
        rows.push({ ITEM_NO: i, SKU: 'SKU-' + String(i * 13).padStart(5, '0'), ITEM_NAME: nm + ' ' + i,
          STORE: ['Colombo', 'Trincomalee', 'Kandy'][i % 3], ON_HAND: oh, UNIT_COST: cost, STOCK_VALUE: Math.round(oh * cost * 100) / 100 });
      }
      return { columns: [{ name: 'ITEM_NO', type: 'NUMBER' }, { name: 'SKU', type: 'VARCHAR2' }, { name: 'ITEM_NAME', type: 'VARCHAR2' }, { name: 'STORE', type: 'VARCHAR2' }, { name: 'ON_HAND', type: 'NUMBER' }, { name: 'UNIT_COST', type: 'NUMBER' }, { name: 'STOCK_VALUE', type: 'NUMBER' }], rows: rows };
    }
  };

  return { reports: [invoice, stock], logoSvg: LOGO_SVG,
    logoDataUri: 'data:image/svg+xml;base64,' + (typeof btoa !== 'undefined' ? btoa(LOGO_SVG) : Buffer.from(LOGO_SVG).toString('base64')) };
});
