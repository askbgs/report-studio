/*!
 * Report Studio for Oracle APEX - runtime printing helper (use in any APEX page)
 * Requires rpt-engine.js for browser printing; server PDFs need only this file.
 *
 *   RptPrint.pdf('INVOICE', { items: ['P10_INVOICE_NO'] });            // server PDF, new tab
 *   RptPrint.pdf('INVOICE', { params: { INVOICE_NO: 'INV-1' }, download: true });
 *   RptPrint.print('INVOICE', { items: ['P10_INVOICE_NO'] });          // browser print dialog
 *   RptPrint.preview('INVOICE', { items: ['P10_INVOICE_NO'] });        // HTML preview in a new tab
 *
 * Application process (Ajax Callback) "RPT_RUN":  rpt_api.ajax;
 */
(function (global) {
  'use strict';
  var PROCESS = 'RPT_RUN';

  function call(action, code, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var items = opts.items;
      if (Array.isArray(items)) items = items.map(function (i) { return i.charAt(0) === '#' ? i : '#' + i; }).join(',');
      global.apex.server.process(opts.process || PROCESS, {
        x01: action, x02: code, x03: opts.test ? 'Y' : 'N',
        p_clob_01: JSON.stringify(opts.params || {}),
        pageItems: items || undefined
      }, { dataType: 'text', loadingIndicator: opts.spinner === false ? undefined : 'body' })
        .done(function (txt) {
          var r;
          try { r = parseReply(txt, opts.process || PROCESS); } catch (e) { reject(e); return; }
          if (r && r.error) reject(new Error(r.error)); else resolve(r);
        })
        .fail(function (jq, st, err) { reject(new Error((opts.process || PROCESS) + ': ' + (err || st || 'request failed') + (jq && jq.responseText ? ' – ' + snippet(jq.responseText) : ''))); });
    });
  }

  function snippet(t) { return String(t).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300); }
  // Turn an empty or non-JSON reply into a message that says what to check
  function parseReply(txt, proc) {
    if (txt == null || String(txt).trim() === '') {
      throw new Error(proc + ' returned an empty response. Check that the application process "' + proc +
        '" exists (Point: Ajax Callback), that its name matches exactly, and that its authorization scheme passes for this user.');
    }
    try { return JSON.parse(txt); }
    catch (e) { throw new Error(proc + ' did not return JSON: ' + snippet(txt)); }
  }

  function b64ToBlob(b64, type) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type });
  }

  function notify(msg) {
    if (global.apex && global.apex.message) {
      global.apex.message.clearErrors();
      global.apex.message.showErrors([{ type: 'error', location: 'page', message: msg, unsafe: false }]);
    } else global.alert(msg);
  }

  function holdingWindow() {
    var w = null;
    try { w = global.open('', '_blank'); } catch (e) { w = null; }
    if (w) w.document.write('<!DOCTYPE html><title>Generating…</title><body style="font:14px system-ui;padding:40px;color:#555">Generating report…</body>');
    return w;
  }

  var RptPrint = {
    /** Fetch layout + data JSON */
    payload: function (code, opts) { return call('PAYLOAD', code, opts); },

    /** Server-side PDF (render server). Opens a new tab or downloads. */
    pdf: function (code, opts) {
      opts = opts || {};
      var w = opts.download ? null : holdingWindow();       // open now: keeps the click's user gesture
      return call('PDF', code, opts).then(function (r) {
        var blob = b64ToBlob(r.base64, 'application/pdf');
        var url = URL.createObjectURL(blob);
        var name = opts.fileName || r.fileName || (code.toLowerCase() + '.pdf');
        if (w && !w.closed) { w.location.href = url; }
        else {
          var a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
        }
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
        return blob;
      }).catch(function (err) { if (w) w.close(); if (opts.silent !== true) notify(err.message); throw err; });
    },

    /** Browser-side rendering (no render server). Opens the print dialog. */
    print: function (code, opts) {
      opts = opts || {};
      return call('PAYLOAD', code, opts).then(function (p) {
        return global.RptEngine.renderAsync(p.layout, p.data).then(function (res) {
          if (global.RptDesigner && global.RptDesigner.printHtml) return global.RptDesigner.printHtml(res, opts.fontCss);
          var f = document.createElement('iframe');
          f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
          document.body.appendChild(f);
          var d = f.contentWindow.document;
          d.open();
          d.write('<!DOCTYPE html><html><head><meta charset="utf-8">' + (opts.fontCss ? '<link rel="stylesheet" href="' + opts.fontCss + '">' : '') +
            '<style>' + res.css + 'html,body{margin:0}</style></head><body>' + res.html + '</body></html>');
          d.close();
          Promise.resolve(d.fonts ? d.fonts.ready : null).then(function () {
            setTimeout(function () { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(function () { f.remove(); }, 60000); }, 200);
          });
        });
      }).catch(function (err) { notify(err.message); throw err; });
    },

    /** Browser-side rendering into a new tab (with a Print button) */
    preview: function (code, opts) {
      opts = opts || {};
      var w = holdingWindow();
      return call('PAYLOAD', code, opts).then(function (p) {
        return global.RptEngine.renderAsync(p.layout, p.data).then(function (res) {
          if (!w) return res;
          var fonts = opts.fontCss || 'https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,400;0,700;1,400;1,700&family=Noto+Sans+Tamil:wght@400;700&family=Noto+Sans+Sinhala:wght@400;700&family=Noto+Serif:wght@400;700&display=swap';
          w.document.open();
          w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + (p.name || code) + '</title><link rel="stylesheet" href="' + fonts + '">' +
            '<style>' + res.css + 'body{margin:0;background:#e5e8ed}.bar{position:sticky;top:0;background:#1f2a37;color:#fff;padding:8px 14px;font:13px system-ui;display:flex;gap:12px;align-items:center}' +
            '.bar button{font:inherit;padding:5px 12px;border:0;border-radius:5px;cursor:pointer}.pages{display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px}' +
            '.rpt-page{box-shadow:0 2px 10px rgba(0,0,0,.2)}@media print{.bar{display:none}.pages{display:block;padding:0}body{background:#fff}}</style></head><body>' +
            '<div class="bar"><b>' + (p.name || code) + '</b><span>' + res.pageCount + ' page(s)</span><span style="flex:1"></span><button type="button" onclick="print()">Print / Save as PDF</button></div>' +
            '<div class="pages">' + res.html + '</div></body></html>');
          w.document.close();
          return res;
        });
      }).catch(function (err) { if (w) w.close(); notify(err.message); throw err; });
    }
  };

  global.RptPrint = RptPrint;
})(window);
