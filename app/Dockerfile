# syntax=docker/dockerfile:1
#
# proxywarden app image — OUR backend, on OUR base.
#
# D1 (the absorption): app/backend IS our source now — the vendored NPM
# tree with the former patch stack 001-029 dissolved into it. No patch
# stages, no foreign base: what you see in app/backend is what ships.
# The stock frontend is NOT built here anymore — the product image
# (build/Dockerfile) assembles OUR frontend from app/frontend.
#
# Historical note (the origin of record): the tree descends from
# Nginx Proxy Manager v2.17.0 (see app/backend/PROVENANCE.md); the
# divergence was expressed as 29 numbered backend patches until this
# commit — the patch files live in git history from here on.

# Global ARGs — ONLY these are visible to FROM lines.
ARG NPM_VERSION=2.17.0
ARG BASE_IMAGE=ghcr.io/funkysys-org/nginx-full:certbot-node

FROM ${BASE_IMAGE}
ARG NPM_VERSION
ARG TARGETPLATFORM
ARG BUILD_COMMIT
ARG BUILD_DATE

ENV SUPPRESS_NO_CONFIG_WARNING=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=1 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_FIX_ATTRS_HIDDEN=1 \
    S6_KILL_FINISH_MAXTIME=10000 \
    S6_VERBOSITY=1 \
    NODE_ENV=production \
    NPM_BUILD_VERSION="${NPM_VERSION}" \
    NPM_BUILD_COMMIT="${BUILD_COMMIT}" \
    NPM_BUILD_DATE="${BUILD_DATE}" \
    NODE_OPTIONS="--openssl-legacy-provider"

RUN echo "fs.file-max = 65535" > /etc/sysctl.conf \
    && apt-get update \
    && apt-get install -y --no-install-recommends jq logrotate \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# s6 overlay (installer vendored from the absorbed tree at its origin tag)
COPY app/backend/docker/scripts/install-s6 /tmp/install-s6
RUN /tmp/install-s6 "${TARGETPLATFORM}" && rm -f /tmp/install-s6

EXPOSE 80 81 443

# OUR backend — the whole /app, straight from the absorbed source.
COPY app/backend/backend /app
COPY app/backend/docker/rootfs /

WORKDIR /app
RUN yarn install \
    && yarn cache clean

# Remove the frontend service (dev-only) and the dev nginx config,
# exactly like upstream's release assembly.
RUN rm -rf /etc/s6-overlay/s6-rc.d/user/contents.d/frontend /etc/nginx/conf.d/dev.conf \
    && chmod 644 /etc/logrotate.d/nginx-proxy-manager

VOLUME [ "/data" ]
ENTRYPOINT [ "/init" ]
