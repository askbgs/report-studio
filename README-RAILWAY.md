# Docsmith render server on Railway

This folder is a complete, deployable repository for the Docsmith render server
(PDF, Word and Excel). Railway builds `render-server/Dockerfile` (Node 20 + Debian
Chromium, Noto fonts from npm) as configured in `railway.json`, and health-checks `/health`.

```
railway.json                 Railway build/deploy settings
.dockerignore
render-server/Dockerfile     container image
render-server/server.js      HTTP API  (/render, /health)
render-server/office.js      Word (.docx) and Excel (.xlsx) builder
render-server/package.json
render-server/test.js        smoke test (needs samples/)
static/rpt-engine.js         layout engine, shared with the designer (keep this path)
samples/                     sample reports used by test.js
.github/workflows/render-image.yml   optional: build the image on GitHub
```

## 1. Put it on GitHub

```bash
cd docsmith-render-railway
git init && git add . && git commit -m "Docsmith render server"
git branch -M main
git remote add origin https://github.com/<you>/docsmith-render.git
git push -u origin main
```

(Or, without GitHub: install the Railway CLI, then `railway login`, `railway init`, `railway up` in this folder.)

## 2. Create the service

1. railway.com → **New Project → Deploy from GitHub repo** → pick `docsmith-render`.
   Railway reads `railway.json` and builds the Dockerfile (first build ≈ 3–5 min).
2. Service → **Variables**:

   | Variable | Value |
   |---|---|
   | `API_KEY` | a long random secret (e.g. `openssl rand -hex 32`) |
   | `MAX_PAGES` | `2` (parallel renders; `3–4` if the service has 2 GB+ RAM) |

   Do **not** set `PORT` (Railway sets it) or any `TLS_*` variable (Railway provides HTTPS).
3. Service → **Settings → Networking → Generate Domain**, e.g. `docsmith-render.up.railway.app`.
   **Settings → Region**: pick the one closest to your database (Southeast Asia / Singapore for Sri Lanka).
4. Open `https://<domain>/health`. Expected:
   `{"ok":true,"engine":"1.3.0","chromium":"ready",...,"formats":["pdf","docx","xlsx"]}`

Memory: one render uses about 150–250 MB; give the service at least 1 GB.

## 3. Point the database at it

```sql
update rpt_config set value = 'https://<domain>/render' where key = 'RENDER_URL';
update rpt_config set value = '<the same API_KEY>'      where key = 'RENDER_API_KEY';
commit;
```

As SYS: network ACL for `<domain>`, port **443** (edit `render_host` / `render_port` in `db/00_network_acl.sql`).

HTTPS from the database needs an Oracle wallet that trusts Let's Encrypt (**ISRG Root X1**,
https://letsencrypt.org/certs/isrgrootx1.pem):

```bash
orapki wallet create -wallet /u01/wallet/docsmith -pwd <WalletPwd> -auto_login
orapki wallet add    -wallet /u01/wallet/docsmith -trusted_cert -cert isrgrootx1.pem -pwd <WalletPwd>
```
```sql
update rpt_config set value = 'file:/u01/wallet/docsmith' where key = 'WALLET_PATH';
update rpt_config set value = '<WalletPwd>'               where key = 'WALLET_PWD';
commit;
```
(Or add the certificate to the APEX instance wallet and leave these empty.)
If the database reaches the internet through a proxy, allow `*.up.railway.app`.

Check from SQL Commands:
```sql
begin dbms_output.put_line(rpt_util.server_status().to_clob()); end;
```
or the server chip in the designer toolbar (green **Online**).

## 4. Updating

Push to `main`, Railway rebuilds and redeploys. When you update the APEX app, deploy the
matching `server.js`, `office.js` and `static/rpt-engine.js` too, so the engine versions match
(the designer chip turns amber when they differ).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Health check fails during deploy | Check the deploy logs; usually too little memory. Raise the plan, keep `MAX_PAGES=2`. |
| `ORA-29024: Certificate validation failure` | Wallet missing ISRG Root X1, or `WALLET_PATH` wrong. |
| `ORA-24247: network access denied by ACL` | ACL for the Railway domain, port 443. |
| `401` / "API key rejected" | `RENDER_API_KEY` ≠ Railway `API_KEY`. |
| Word/Excel error "server returned PDF" | An old image is running; redeploy this version. |
