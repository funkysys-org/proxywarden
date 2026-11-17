# syntax=docker/dockerfile:1
#
# proxywarden = validated WAF overlay image + our frontend build.
#
# Stage 1 (fe-builder): clone the pinned upstream NPM tag, apply our patch
#   set (zero patches = stock build), `yarn build` the React/Vite frontend.
# Stage 2 (product):   FROM the overlay image, replace /app/frontend with
#   our dist. Backend, modsec layer, s6 seed: untouched.
#
# Pins (mirrored in .github/workflows/build.yml — pins-sync enforces):
#   NPM_FRONTEND_REF : upstream tag the frontend is built from
#   OVERLAY_IMAGE    : base image (local tag for local builds; CI passes the
#                      GHCR path — location-dependent, checked by pins-sync
#                      only for the REPLACE-ME placeholder and the version
#                      invariant vs NPM_FRONTEND_REF)

# Global ARGs — ONLY these are visible to FROM lines (stage 2 consumes
# OVERLAY_IMAGE; an ARG declared inside a stage is invisible to FROM).
ARG OVERLAY_IMAGE=npm-modsec:2.17.0-modsec3.0.17-crs4.30.0

# ---- stage 1: frontend builder -------------------------------------------
FROM node:26 AS fe-builder

ARG NPM_FRONTEND_REF=v2.17.0
RUN git clone --depth 1 --branch "$NPM_FRONTEND_REF" \
      https://github.com/NginxProxyManager/nginx-proxy-manager.git /build/npm

COPY patches/ /patches/
# Apply our patch sets — backend first, then frontend — in lexical order;
# empty sets = proven stock build.
RUN set -eu; cd /build/npm; \
    found=0; \
    for p in /patches/backend/*.patch /patches/frontend/*.patch; do \
      [ -e "$p" ] || continue; \
      found=1; echo "applying $(basename "$p")"; \
      git apply --check "$p" && git apply "$p"; \
    done; \
    if [ "$found" = 1 ]; then echo "PATCH SET APPLIED"; else echo "STOCK BUILD (no patches)"; fi

# Upstream CI chain (scripts/ci/frontend-build) is:
#   yarn install && yarn lint && yarn locale-compile && yarn vitest run && yarn build
# We run the build-required subset — our functional gate is scripts/smoke-ui.sh.
# locale-compile is NOT optional: src/locale/lang/*.json is generated (gitignored)
# and `tsc` fails without it.
RUN set -eu; cd /build/npm/frontend; \
    npm i -g yarn@1.22.22; \
    yarn install --frozen-lockfile; \
    yarn locale-compile; \
    yarn build; \
    test -f dist/index.html

# ---- stage 2: product image -----------------------------------------------
FROM ${OVERLAY_IMAGE}

# Replace the stock frontend with ours (old hashed assets removed — no orphans).
RUN rm -rf /app/frontend
COPY --from=fe-builder /build/npm/frontend/dist/ /app/frontend/

# Backend overlay: the files touched by patches/backend/. Same assembly as
# upstream (its docker/Dockerfile does `COPY backend /app`), so overlaying the
# patched files is equivalent — the module runs from source, no rebuild.
# NOTE: extend this list when a backend patch touches new files.
COPY --from=fe-builder /build/npm/backend/internal/log-viewer.js /app/internal/log-viewer.js
COPY --from=fe-builder /build/npm/backend/routes/logs.js /app/routes/logs.js

# Image-level overlay files: the global hardening conf lands in
# /etc/nginx/conf.d/, which the stock nginx.conf already includes.
COPY rootfs/ /

# Build-time config gate: the whole image config must parse — including our
# conf.d hardening file (duplicate directives are fatal and only nginx -t
# catches them). Transient npm user like the overlay build; never shipped.
RUN set -eu; \
    useradd -r -M npm; \
    nginx -t; \
    userdel npm; \
    groupdel npm 2>/dev/null || true
