# syntax=docker/dockerfile:1
#
# proxywarden = validated WAF overlay image + our frontend build.
#
# D1 (the absorption): stage 1 builds OUR source from app/frontend/ —
#   the former vendored tree with the patch stack 001-028 dissolved
#   into it. Stage 2 (product): FROM the WAF overlay image, replace
#   /app/frontend with our dist. Modsec layer, s6 seed, backend:
#   untouched here — the backend IS the app image's /app now.
#
# Pins (mirrored in .github/workflows/build.yml — pins-sync enforces):
#   OVERLAY_IMAGE    : base image (local tag for local builds; CI passes the
#                      GHCR path — location-dependent, checked by pins-sync
#                      only for the REPLACE-ME placeholder)

# Global ARGs — ONLY these are visible to FROM lines (stage 2 consumes
# OVERLAY_IMAGE; an ARG declared inside a stage is invisible to FROM).
# Base = the funkysys-org/nginx-full WAF image (Phase A2b merged stack:
# parity-gated openresty base + NPM app + libmodsecurity/CRS/vts/purge layer).
ARG OVERLAY_IMAGE=ghcr.io/funkysys-org/nginx-full:2.17.0-nginx1.31.9-modsec3.0.17-crs4.30.0-vts0.2.7-purge3.0.4-brotli1.2.1

# ---- stage 1: frontend builder -------------------------------------------
# D1 (the absorption): app/frontend IS our source — the former vendored
# tree with the FE patch stack 001-028 dissolved into it. No patch step.
FROM node:26 AS fe-builder

COPY app/frontend/ /build/npm/frontend/

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
    test -f dist/index.html; \
    if grep -rq 'NPM instance' dist/; then echo "FATAL: upstream 'NPM instance' string leaked into the bundle — debrand patch (005) not applied?"; exit 1; fi; \
    grep -rq 'Warden instance' dist/ || { echo "FATAL: 'Warden instance' marker missing from the bundle"; exit 1; }; \
    if grep -rq 'jc21' dist/; then echo "FATAL: 'jc21' leaked into the bundle — footer/product debrand regressed?"; exit 1; fi; \
    if grep -rq 'NginxProxyManager' dist/; then echo "FATAL: 'NginxProxyManager' leaked into the bundle — footer/repo links regressed?"; exit 1; fi

# ---- stage 2: product image -----------------------------------------------
FROM ${OVERLAY_IMAGE}

# Replace the stock frontend with ours (old hashed assets removed — no orphans).
RUN rm -rf /app/frontend
COPY --from=fe-builder /build/npm/frontend/dist/ /app/frontend/

# (Backend overlay: gone in Phase A4 — the WAF image from nginx-full ships
#  the backend already patched: the WAF-audit log source lives in nginx-full's
#  overlay/patches/. This stage is frontend-only now.)

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
