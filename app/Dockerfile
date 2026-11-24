# NPM-equivalent app image on OUR base (Phase A1; Phase A4: source vendored).
# Assembles the NPM application from the VENDORED pinned source tree
# (vendor/npm/ — see its PROVENANCE.md) exactly like upstream's
# docker/Dockerfile — but on OUR nginx-full base, with the frontend built
# inside the image (our proven chain). No build-time clone of jc21's repo.
#
# Deliberate, documented deviations from upstream's assembly:
#   - frontend built in stage `npmsrc` (upstream builds it outside the image
#     via scripts/ci/frontend-build)
#   - the `testca` root CA is NOT included: it exists for upstream's own
#     HTTPS test harness, not for production function

# Global ARGs — ONLY these are visible to FROM lines (stage 2 consumes
# BASE_IMAGE; an ARG declared inside a stage is invisible to FROM).
ARG NPM_VERSION=2.17.0
ARG BASE_IMAGE=ghcr.io/funkysys-org/nginx-full:certbot-node

# ---- stage 1: vendored NPM source (pinned tag) + frontend build ------------
FROM node:26 AS npmsrc
COPY vendor/npm/ /npm/
RUN set -eu; cd /npm/frontend; \
    npm i -g yarn@1.22.22; \
    yarn install --frozen-lockfile; \
    yarn locale-compile; \
    yarn build; \
    test -f dist/index.html

# ---- stage 2: assemble on our base -----------------------------------------
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

# s6 overlay (installer vendored from the NPM source at the pinned tag)
COPY --from=npmsrc /npm/docker/scripts/install-s6 /tmp/install-s6
RUN /tmp/install-s6 "${TARGETPLATFORM}" && rm -f /tmp/install-s6

EXPOSE 80 81 443

COPY --from=npmsrc /npm/backend       /app
COPY --from=npmsrc /npm/frontend/dist /app/frontend
COPY --from=npmsrc /npm/docker/rootfs /

WORKDIR /app
RUN yarn install \
    && yarn cache clean

# Remove the frontend service (dev-only) and the dev nginx config,
# exactly like upstream's release assembly.
RUN rm -rf /etc/s6-overlay/s6-rc.d/user/contents.d/frontend /etc/nginx/conf.d/dev.conf \
    && chmod 644 /etc/logrotate.d/nginx-proxy-manager

VOLUME [ "/data" ]
ENTRYPOINT [ "/init" ]
