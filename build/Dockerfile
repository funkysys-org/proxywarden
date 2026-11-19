# syntax=docker/dockerfile:1
#
# proxywarden = validated WAF overlay image + our frontend build.
#
# Stage 1 (fe-builder): the VENDORED NPM frontend source (Phase A4:
#   vendor/npm-frontend/, PROVENANCE-gated — no build-time clone of jc21),
#   our frontend patch set (zero patches = stock build), `yarn build`.
# Stage 2 (product):   FROM the WAF image (its backend already carries our
#   WAF-audit patch from nginx-full since Phase A4), replace /app/frontend
#   with our dist. Modsec layer, s6 seed, backend: untouched here.
#
# Pins (mirrored in .github/workflows/build.yml — pins-sync enforces):
#   NPM_FRONTEND_REF : upstream tag the vendored frontend is from
#   NPM_COMMIT       : upstream sha — must equal vendor/npm-frontend/PROVENANCE.md
#   OVERLAY_IMAGE    : base image (local tag for local builds; CI passes the
#                      GHCR path — location-dependent, checked by pins-sync
#                      only for the REPLACE-ME placeholder and the version
#                      invariant vs NPM_FRONTEND_REF)

# Global ARGs — ONLY these are visible to FROM lines (stage 2 consumes
# OVERLAY_IMAGE; an ARG declared inside a stage is invisible to FROM).
# Base = the funkysys-org/nginx-full WAF image (Phase A2b merged stack:
# parity-gated openresty base + NPM app + libmodsecurity/CRS/vts/purge layer).
ARG OVERLAY_IMAGE=ghcr.io/funkysys-org/nginx-full:2.17.0-or1.31.8.1-modsec3.0.17-crs4.30.0-vts0.2.7-purge3.0.4

# ---- stage 1: frontend builder -------------------------------------------
# Frontend base = the vendored pinned source (Phase A4). git stays installed
# (node:26 ships it): `git apply` runs the patch set.
FROM node:26 AS fe-builder

# Provenance tag pin (the vendored tree is the actual build input; pins-sync
# checks this value against vendor/npm-frontend/PROVENANCE.md via NPM_COMMIT).
ARG NPM_FRONTEND_REF=v2.17.0

COPY vendor/npm-frontend/ /build/npm/
COPY patches/ /patches/
# Apply our FRONTEND patch set in lexical order; empty set = stock build.
# (Backend patches live in funkysys-org/nginx-full since Phase A4.)
RUN set -eu; cd /build/npm; \
    found=0; \
    for p in /patches/frontend/*.patch; do \
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
