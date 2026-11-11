# Report Studio render server - container image (Railway, Docker, Kubernetes)
# Build context = repository root (the server needs ../static/rpt-engine.js):
#   docker build -f render-server/Dockerfile -t report-studio-render .
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    HOST=0.0.0.0 \
    PORT=3900 \
    MAX_PAGES=2

# Debian's Chromium + the libraries it needs; Noto fonts come from npm (@fontsource)
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/render-server
COPY render-server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY render-server/server.js render-server/office.js ./
COPY static/rpt-engine.js /app/static/rpt-engine.js

RUN chown -R node:node /app
USER node

EXPOSE 3900
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
