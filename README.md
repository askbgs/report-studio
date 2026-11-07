# Report Studio for Oracle APEX

A visual PDF report designer that lives inside your APEX application. You lay out bands and elements on a canvas, bind them to SQL queries, preview them with live data, and generate pixel-exact PDFs, with proper **Tamil and Sinhala** text.

```
report-studio/
├─ db/                     Oracle objects (run in the parsing schema)
│  ├─ 00_network_acl.sql   ACL so APEX can reach the render server (run as DBA)
│  ├─ 01_tables.sql        RPT_REPORTS, RPT_SOURCES, RPT_ASSETS, RPT_VERSIONS, RPT_LOG, RPT_CONFIG
│  ├─ 02_rpt_util.sql      SQL validation, bind detection, data fetch → JSON
│  ├─ 03_rpt_designer.sql  Ajax back end of the designer (RPT_AJAX)
│  ├─ 04_rpt_api.sql       Public API: get_pdf, download, get_payload, ajax (RPT_RUN)
│  ├─ 05_samples.sql       Sample reports INVOICE and STOCK_LIST + LOGO image
│  ├─ install.sql / uninstall.sql
├─ static/                 Upload to APEX Static Application (or Workspace) Files
│  ├─ rpt-engine.js        Layout engine (shared by designer, browser print, render server)
│  ├─ rpt-designer.js/.css The designer UI
│  └─ rpt-print.js         Runtime helper for your application pages
├─ render-server/          Node + Puppeteer PDF renderer with bundled Noto fonts (+ Dockerfile)
├─ railway.json            Railway deployment config (builds render-server/Dockerfile)
├─ demo/index.html         Offline designer demo (no database needed)
└─ samples/samples.js      Sample report definitions (source of 05_samples.sql)
```

## How it works

```
 Designer page (APEX)                       Your APEX pages / PL/SQL
 rpt-designer.js + rpt-engine.js            RptPrint.pdf('INVOICE') · rpt_api.get_pdf(...)
        │  RPT_AJAX                                   │  RPT_RUN
        ▼                                             ▼
 RPT_DESIGNER ──► RPT_REPORTS / RPT_SOURCES ◄── RPT_API ──► RPT_UTIL (runs the SQL → JSON)
                                                  │
                                                  │ POST {layout, data}  (APEX_WEB_SERVICE)
                                                  ▼
                                    render-server (Node + headless Chromium)
                                    runs the same rpt-engine.js → PDF with embedded fonts
```

A layout is stored as one JSON document. The **same engine** lays out the pages in the designer preview, in the browser print mode, and on the server, so the preview matches the PDF. Chromium shapes complex scripts, which is why Tamil and Sinhala render correctly; a PDF writer written in PL/SQL can't do that.

---

## 1. Database

Run as the workspace **parsing schema** (requires Oracle 19c+ and APEX 22.1+; tested design target APEX 26.1):

```sql
@db/install.sql
```

Then, **as SYS/ADMIN**, allow APEX to call the render server (edit host/port first):

```sql
@db/00_network_acl.sql
```

Configure the render server in `RPT_CONFIG`:

```sql
update rpt_config set value = 'http://localhost:3900/render' where key = 'RENDER_URL';
update rpt_config set value = 'a-long-random-secret'         where key = 'RENDER_API_KEY';
commit;
```

| Key | Meaning |
|---|---|
| `RENDER_URL` | Render server endpoint |
| `RENDER_API_KEY` | Must equal `API_KEY` of the render server |
| `RENDER_TIMEOUT` | Seconds to wait for a PDF (default 120) |
| `PREVIEW_MAX_ROWS` | Row limit per source in previews (500) |
| `MAX_ROWS` | Row limit per source in production (100 000) |
| `WALLET_PATH` / `WALLET_PWD` | Only if `RENDER_URL` is https |

## 2. Render server

```bash
cd render-server
npm install
API_KEY=a-long-random-secret PORT=3900 node server.js
curl http://localhost:3900/health
npm test                      # renders both samples to render-server/out/*.pdf
```

* Fonts (Noto Sans, Serif, Mono, **Noto Sans Tamil**, **Noto Sans Sinhala**) come from npm `@fontsource` packages, so the server needs no internet access.
* `server.js` loads `../static/rpt-engine.js`, so keep the folder structure (or copy `rpt-engine.js` next to `server.js`).
* **Windows service** (NSSM, elevated prompt): `install-windows-service.cmd a-long-random-secret 3900`
* **Linux systemd**: `ExecStart=/usr/bin/node /opt/report-studio/render-server/server.js` with `Environment=API_KEY=…`.
* Environment variables: `PORT`, `HOST` (bind to `127.0.0.1` when it runs on the DB/ORDS host), `API_KEY`, `MAX_PAGES` (parallel renders, default 4), `CHROME_PATH`, `ALLOW_REMOTE_IMAGES=1` (default: only embedded images load).
* **Inside Apex Forge Print or another Express app:**
  `app.use('/report-studio', require('./render-server/server').createApp({ selfUrl: 'http://127.0.0.1:3000/report-studio' }))`
  then set `RENDER_URL` to `…/report-studio/render`.

### Deploy the render server on Railway

The repository root contains `railway.json`, which builds `render-server/Dockerfile` (Debian Chromium + Node 20, Noto fonts from npm) and health-checks `/health`.

1. Push the `report-studio` folder to a GitHub repository (or run `railway up` from the folder with the Railway CLI).
2. Railway → **New Project → Deploy from GitHub repo**, and pick the repository. Railway finds `railway.json` by itself.
3. Service → **Variables**: `API_KEY` = a long random secret, `MAX_PAGES` = `2` (raise it if the service has more than 1 GB RAM). Railway sets `PORT` itself.
4. Service → **Settings → Networking → Generate Domain**, e.g. `report-studio-render.up.railway.app`. Choose the region closest to your database (Singapore for Sri Lanka).
5. Check `https://<domain>/health` in a browser.
6. In the database:
   * `RENDER_URL` = `https://<domain>/render`, and `RENDER_API_KEY` = the same secret.
   * Network ACL for `<domain>` on port **443** (edit `render_host`/`render_port` in `00_network_acl.sql`).
   * An Oracle wallet that trusts Railway's certificate authority (Let's Encrypt **ISRG Root X1**), set in `WALLET_PATH` / `WALLET_PWD` or as the APEX instance wallet.
   * If the database reaches the internet only through a proxy, make sure the proxy allows `*.up.railway.app`.

## 3. APEX application setup (≈10 minutes)

**a. Static files.** Upload `static/rpt-engine.js`, `rpt-designer.js`, `rpt-designer.css` and `rpt-print.js` to *Shared Components → Static Application Files* (or Workspace Files if several apps use them).

**b. Authorization scheme** `REPORT_DESIGNER`: who may design reports. Designers can run any SELECT as the parsing schema, so restrict this.

**c. Application processes** (*Shared Components → Application Processes*, Point = **Ajax Callback**):

| Name | Code | Authorization |
|---|---|---|
| `RPT_AJAX` | `rpt_designer.ajax;` | `REPORT_DESIGNER` |
| `RPT_RUN` | `rpt_api.ajax;` | any authenticated user (or your own scheme) |

**d. Page 1 – Reports** (Interactive Report, authorization `REPORT_DESIGNER`):

```sql
select report_id, code, name, status, version_no,
       coalesce(updated_on, created_on) as changed_on,
       coalesce(updated_by, created_by) as changed_by
  from rpt_reports
 order by code
```
Make `CODE` a link to page 2 with `P2_REPORT_ID = #REPORT_ID#`. Add a **Create** button that goes to page 2 with *Clear Cache = 2*.

**e. Page 2 – Designer** (authorization `REPORT_DESIGNER`; the *Minimal (No Navigation)* page template gives the most room)

* Hidden item **`P2_REPORT_ID`**.
* Region type *Static Content*, template *Blank with Attributes (No Grid)*, source: `<div id="rpt-designer"></div>`
* Page → JavaScript → File URLs:
  ```
  #APP_FILES#rpt-engine.js
  #APP_FILES#rpt-designer.js
  #APP_FILES#rpt-print.js
  ```
* Page → CSS → File URLs: `#APP_FILES#rpt-designer.css`
* Page → JavaScript → Execute when Page Loads:
  ```js
  window.rptDesigner = RptDesigner.init({
    el: '#rpt-designer',
    reportId: $v('P2_REPORT_ID') || null,
    reportItem: 'P2_REPORT_ID',
    listUrl: 'f?p=&APP_ID.:1:&SESSION.',
    height: 'calc(100vh - 90px)'
  });
  ```

Open page 1: the sample reports **INVOICE** and **STOCK_LIST** are already there.

## 4. Printing from your application

Add `#APP_FILES#rpt-print.js` to the page (plus `#APP_FILES#rpt-engine.js` if you use browser printing). Then, in a Dynamic Action → Execute JavaScript Code:

```js
// Server PDF in a new tab. :P10_INVOICE_NO in the query is filled from the submitted item.
RptPrint.pdf('INVOICE', { items: ['P10_INVOICE_NO'] });

// Explicit parameters, download instead of opening
RptPrint.pdf('INVOICE', { params: { INVOICE_NO: $v('P10_INVOICE_NO') }, download: true });

// No render server: render in the browser and open the print dialog / an HTML preview
RptPrint.print('STOCK_LIST', { params: { MIN_QTY: 10 } });
RptPrint.preview('INVOICE', { items: ['P10_INVOICE_NO'] });
```

PL/SQL (processes, jobs, e-mail):

```sql
declare
  l_pdf  blob := rpt_api.get_pdf('INVOICE', '{"INVOICE_NO":"INV-2026-0042"}');
  l_mail number;
begin
  l_mail := apex_mail.send(p_to => 'customer@example.com', p_from => 'billing@example.com',
                           p_subj => 'Your invoice', p_body => 'Please find your invoice attached.');
  apex_mail.add_attachment(l_mail, l_pdf, 'invoice.pdf', 'application/pdf');
  apex_mail.push_queue;
end;
```

* `rpt_api.download('INVOICE')` in a *Before Header* process streams the PDF to the browser.
* `rpt_api.get_payload(code, params)` returns the layout+data JSON.
* Outside an APEX session (e.g. a DBMS_SCHEDULER job), call `apex_session.create_session` (or `apex_util.set_workspace`) first, so APEX_WEB_SERVICE can be used.

**Bind values** are resolved in this order: the `params` JSON (keys case-insensitive, colon optional), then APEX session state `v('NAME')`.

---

## 5. Designer guide

| Area | What you do there |
|---|---|
| **Elements** tab | Drag Text, Field, Line, Box, Ellipse, Image, Table, Barcode onto a band (or click to add to the selected band). System fields: page numbers, dates, user. |
| **Data** tab | Add data sources (SQL). *Validate & describe* lists columns and binds; enter test values for Preview. Drag a column onto a band to create a field, or onto a table to add a column. |
| **Images** tab | Upload logos, signatures and stamps. They're shared by all reports and referenced by code (e.g. `LOGO`). |
| Canvas | Click to select, Shift+click to add to the selection, drag on empty space to lasso, drag handles to resize, drag a band's bottom edge to resize the band. Drag elements between bands. |
| Properties | Nothing selected → report and page settings, detail source, groups, bands, batch. Band selected → height, print on, group options. Element → geometry, content, style, conditions. |
| Toolbar | Save, undo/redo (150 steps), copy/paste/duplicate/delete, align (first selected = reference), z-order, grid & snap, zoom, **Preview** (browser, unsaved layout), **PDF** (server, saved version), version history, export/import JSON bundles (moves reports + images between environments). |

Keyboard: arrows move (Shift = 10 pt) · Del · Ctrl+C / X / V / D · Ctrl+Z / Y · Ctrl+A (band) · Ctrl+S · Esc.

### Bands

`Page Header` → `Report Header` → `Group Header n` → **`Detail`** (repeats per row of the *detail source*) → `Group Footer n` → `Summary` → `Page Footer`.

* Page header/footer: *every page*, *first page only*, *all but first*.
* Report header: *new page after* (cover page). Summary: *start on a new page*. Group: *new page per group*.
* Group bands require the detail query to be **ordered by the group fields**.
* Any band or element can have **Print when** (e.g. `STATUS == 'PAID'`).
* Group headers are kept together with the first detail row (no orphan headers at the bottom of a page).

### Elements

* **Text / Field**: text with `{{tokens}}`; *Can grow* wraps long text and pushes the elements below it down.
* **Stretch with band**: backgrounds and vertical lines follow rows that grew (see the zebra rows in INVOICE).
* **Table**: own data source (or the current scope); columns with header, value template, width, alignment and total (sum / count / avg / min / max). Header repeats on every page, rows can grow, zebra colours, grid styles, and a total row whose label spans the columns before the first total. Tables split across pages row by row.
* **Image**: an asset code (`LOGO`) or a field (`{{PHOTO_CODE}}`) to choose the image per row.
* **Barcode**: Code 128 from any value (`{{INV_NO}}`).

### Template language

| Token | Meaning |
|---|---|
| `{{COLUMN}}` | Column of the current row, otherwise the first row of the other sources |
| `{{HEADER.COLUMN}}` | Column of a specific source |
| `{{:P10_ITEM}}` | Parameter / bind / page item value |
| `{{PAGE}}`, `{{PAGES}}` | Page numbers (per document in batch mode) |
| `{{TODAY}}`, `{{NOW}}`, `{{APP_USER}}`, `{{ROWNUM}}` | System values |
| `{{SUM(AMOUNT)}}`, `COUNT()`, `AVG()`, `MIN()`, `MAX()` | Aggregates over the current scope (group in group bands, all rows in headers/summary). `SUM(LINES.AMOUNT)` forces a source. Arguments may be expressions: `SUM(QTY*PRICE)` |
| `{{QTY * PRICE}}` | Arithmetic `+ - * / %`; `+` joins text |
| `{{IIF(PAID == 'Y', 'Paid', 'Due')}}` | Also `NVL`, `UPPER`, `LOWER`, `INITCAP`, `TRIM`, `SUBSTR`, `LENGTH`, `ROUND`, `TRUNC`, `ABS`, `CONCAT`, `TO_CHAR(v, fmt)` |
| `{{WORDS(TOTAL, 'Rupees', 'Cents')}}` | Amount in words (million/billion); `WORDS_IN` uses lakh/crore |

**Formats** go after a bar: `{{AMOUNT|#,##0.00}}` (also Oracle style `999G999D99`; prefixes/suffixes like `LKR #,##0.00`, `0.0%`), `{{INV_DATE|DD-Mon-YYYY}}` (`YYYY YY MONTH MON MM DD DAY DY HH24 HH MI SS AM`, letter case is copied), `upper`, `lower`, `trim`, `words`.
**Conditions** (`Print when`): `== != < > <= >=`, `AND OR NOT` (or `&& || !`), functions as above.

### Batch printing

Report properties → *Batch printing*: one document per row of a source (e.g. `HEADER` with all invoices of the month), with a link column (`INVOICE_ID`). The other sources are filtered to that document, and page numbers restart for each document.

### Render server status

The toolbar chip shows whether **the database** can reach the render server: green = connected (with response time), amber = connected but the engine version differs, red = offline. It checks when the designer opens and every 2 minutes (`serverCheckInterval` option in ms, `0` = only on open; `serverStatus: false` hides it). Click it for details: URL, HTTP status, API key accepted or rejected, Chromium state, queue, uptime and a hint for the usual errors (missing ACL, nothing listening, wrong key, certificate). **Check again** and **Test PDF** are in the same window. Status changes (lost / back online) also show as a notification at the top of the designer.

The same check from SQL Workshop → SQL Commands:

```sql
begin dbms_output.put_line(rpt_util.server_status().to_clob()); end;
```

## 6. Offline demo

Open `demo/index.html` through any web server (e.g. `npx serve .` in the project root, then go to `/demo/`). It runs the real designer against an in-browser mock of `RPT_AJAX` with the two sample reports, so it's useful for trying layouts without a database. Changes are kept in the browser's local storage. Use *Reset demo* to start over.

## 7. Security notes

* `RPT_AJAX` executes designer-written SELECT statements as the parsing schema. Protect it with an authorization scheme. Only `SELECT`/`WITH`, single statements, are accepted.
* `RPT_RUN` runs stored reports only. Add your own authorization if some reports are restricted, e.g. a scheme that checks `apex_application.g_x02` against a role table.
* Bind the render server to `127.0.0.1` (or a firewalled host), and use a strong `API_KEY`.
* The render page blocks all network access except embedded images, unless `ALLOW_REMOTE_IMAGES=1`.

## 8. Limits and ideas for the next version

* There's no PL/SQL-only rendering engine. Server PDFs need the render server; without it, use `RptPrint.print` (the browser's print to PDF).
* Not yet: QR codes, sub-reports, charts, repeating a group header after a page break, rich text, Excel output.
* `CLOB` columns are truncated to 8 000 characters in report data; `BLOB`/`RAW` columns are ignored (images go through `RPT_ASSETS`).
