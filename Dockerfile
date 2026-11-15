# RegChain AI for a shared deployment: named users sign in (REGCHAIN_AUTH=password), data in the /data volume.
# Put it behind an HTTPS reverse proxy and set REGCHAIN_PUBLIC_ORIGIN to its address. See RegChain-AI-Deployment.md.
FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /data/cache && chown -R node:node /data

ENV REGCHAIN_HOST=0.0.0.0 \
    REGCHAIN_PORT=4173 \
    REGCHAIN_AUTH=password \
    REGCHAIN_DATA_DIR=/data \
    REGCHAIN_CACHE_DIR=/data/cache

USER node
EXPOSE 4173
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/v1/health').then(r=>r.json()).then(b=>process.exit(b.status==='ok'&&b.audit.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "serve-regchain.cjs"]
