# syntax=docker/dockerfile:1.7

# Build dependencies. sharp and better-sqlite3 ship prebuilt binaries for
# linux-x64 / linux-arm64 on glibc, so no native toolchain is needed — but we
# use `npm ci` to lock in the versions from package-lock.json.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/kylecaulfield/DeepSkyLog"
LABEL org.opencontainers.image.description="Self-hosted astronomy observation tracker"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Build-time port default. Override with `--build-arg PORT=8080` if you need a
# different EXPOSE in the image metadata; for runtime overrides just pass
# `-e PORT=8080` on `docker run` (or `environment: { PORT: 8080 }` in compose).
ARG PORT=3000

# Version metadata baked at build time so the running container can advertise
# which commit it was built from. The CI workflow fills these in from the
# triggering commit; local builds can leave them blank or pass --build-arg.
ARG GIT_SHA=""
ARG GIT_REF=""
ARG BUILD_TIME=""

# All mutable state lives under /data so a single volume mount is enough.
ENV NODE_ENV=production \
    PORT=${PORT} \
    GIT_SHA=${GIT_SHA} \
    GIT_REF=${GIT_REF} \
    BUILD_TIME=${BUILD_TIME} \
    DATABASE_PATH=/data/deepskylog.sqlite \
    UPLOAD_DIR=/data/uploads \
    STAGE_DIR=/data/stage \
    BACKUP_DIR=/data/backups

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js backup.sh ./
COPY lib ./lib
COPY db ./db
COPY public ./public
COPY admin ./admin

RUN chmod +x backup.sh \
 && mkdir -p /data \
 && chown -R node:node /app /data

USER node
VOLUME ["/data"]
EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
