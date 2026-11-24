# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# WAF overlay (Phase A2b): the former funkysys-org/npm-modsec layer, merged
# into this pipeline. Builds libmodsecurity + the connector + vts + cache
# purge against the SAME nginx the base bake just built, and assembles
# the WAF image on top of OUR app image.
#
# The args stage keeps the proven self-validation: configure args are
# extracted FROM THE BINARY and the nginx version asserted against the
# pin — the ABI gate stays, even inside one pipeline.
# ---------------------------------------------------------------------------

# Global ARGs — ONLY these are visible to FROM lines (learned the hard way).
# NEVER point this default at a PUBLISHED tag: BuildKit resolves published
# tags from the registry, and the overlay would consume the STALE app digest
# instead of the fresh local build. ":app-build" is local-only by contract;
# the workflow always passes it explicitly anyway.
ARG WAF_BASE_IMAGE=ghcr.io/funkysys-org/nginx-full:app-build
ARG NGINX_VERSION=1.31.9
ARG MODSEC_VERSION=3.0.17
ARG MODSEC_NGINX_VERSION=1.0.4
ARG CRS_VERSION=v4.30.0
ARG VTS_VERSION=v0.2.7
ARG CACHE_PURGE_VERSION=3.0.4
# brotli: the module repo has no usable tags — pinned by commit SHA; the
# submodule (the C library, deps/brotli) is checked out at the BROTLI tag —
# 1.2.1 is the CVE-2026-111497 (Broccoli2Shell) fix: never below it
ARG BROTLI_VERSION=v1.2.1
ARG BROTLI_MODULE_SHA=53e0fb55f250f48fe80c0ddbf6c0f7103cdbaae1
ARG BUILD_JOBS=6

# --- stage 1: capture exact configure args from the base binary ------------
# ABI guardrail: if the base's nginx drifts from the pin, fail loudly.
FROM ${WAF_BASE_IMAGE} AS args
ARG NGINX_VERSION
RUN set -eu; \
    nginx -V 2>&1 | sed -n 's/^nginx version: nginx\///p' > /tmp/version; \
    grep -qx "${NGINX_VERSION}" /tmp/version \
      || { echo "FATAL: base image has nginx $(cat /tmp/version), pinned ${NGINX_VERSION} — update pins"; exit 1; }; \
    nginx -V 2>&1 | sed -n 's/^configure arguments: //p' > /tmp/args

# --- stage 2: build libmodsecurity + connector + vts + purge + fetch CRS ----
FROM debian:trixie-slim AS builder
ARG MODSEC_VERSION MODSEC_NGINX_VERSION NGINX_VERSION CRS_VERSION VTS_VERSION CACHE_PURGE_VERSION BROTLI_VERSION BROTLI_MODULE_SHA BUILD_JOBS
RUN set -eu; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential g++ gcc make git wget ca-certificates xz-utils \
      flex bison pkg-config autoconf automake libtool perl rsync python3-minimal \
      libpcre2-dev libyajl-dev libxml2-dev libcurl4-openssl-dev liblmdb-dev \
      libssl-dev zlib1g-dev libmaxminddb-dev; \
    rm -rf /var/lib/apt/lists/*

# libmodsecurity (BUILD_JOBS capped: seclang parser TUs take ~2 GB each)
RUN set -eu; \
    git clone --depth 1 --branch v${MODSEC_VERSION} --recurse-submodules --shallow-submodules \
      https://github.com/owasp-modsecurity/ModSecurity /tmp/ModSecurity; \
    cd /tmp/ModSecurity; \
    ./build.sh; \
    ./configure --prefix=/usr/local/modsecurity; \
    make -j${BUILD_JOBS}; \
    make install; \
    mkdir -p /usr/local/modsecurity/etc; \
    cp modsecurity.conf-recommended /usr/local/modsecurity/etc/modsecurity.conf; \
    cp unicode.mapping /usr/local/modsecurity/etc/unicode.mapping

RUN set -eu; \
    git clone --depth 1 --branch v${MODSEC_NGINX_VERSION} \
      https://github.com/owasp-modsecurity/ModSecurity-nginx /tmp/ModSecurity-nginx; \
    git clone --depth 1 --branch ${CRS_VERSION} \
      https://github.com/coreruleset/coreruleset /tmp/crs; \
    cp /tmp/crs/crs-setup.conf.example /tmp/crs/crs-setup.conf; \
    git clone --depth 1 --branch ${VTS_VERSION} \
      https://github.com/vozlt/nginx-module-vts /tmp/nginx-module-vts; \
    git clone --depth 1 --branch ${CACHE_PURGE_VERSION} \
      https://github.com/nginx-modules/ngx_cache_purge /tmp/ngx_cache_purge; \
    git clone https://github.com/google/ngx_brotli /tmp/ngx_brotli; \
    git -C /tmp/ngx_brotli checkout ${BROTLI_MODULE_SHA}; \
    git -C /tmp/ngx_brotli submodule update --init --depth 1; \
    git -C /tmp/ngx_brotli/deps/brotli fetch --depth 1 origin tag ${BROTLI_VERSION}; \
    git -C /tmp/ngx_brotli/deps/brotli checkout ${BROTLI_VERSION}; \
    # the repo carries TWO tags on this commit (v1.2.1 and go/brotli/v1.2.1) —
    # verify the COMMIT identity, not the tag string describe picks
    [ "$(git -C /tmp/ngx_brotli/deps/brotli rev-parse HEAD)" \
      = "$(git -C /tmp/ngx_brotli/deps/brotli rev-parse "${BROTLI_VERSION}^{}")" ] \
      || { echo "FATAL: deps/brotli is not at ${BROTLI_VERSION} — refusing to build"; exit 1; }

# nginx source (nginx.org release tarball) at the pinned version; geoip2
# at the literal path baked into the base binary's configure arguments.
RUN set -eu; \
    cd /tmp; \
    wget -q https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz; \
    tar xzf nginx-${NGINX_VERSION}.tar.gz; \
    mv /tmp/nginx-${NGINX_VERSION} /tmp/nginx-src; \
    git clone --depth 1 https://github.com/leev/ngx_http_geoip2_module \
      /tmp/nginx-src/ngx_http_geoip2_module; \
    git clone --depth 1 --branch v0.42 \
      https://github.com/openresty/headers-more-nginx-module \
      /tmp/nginx-src/headers-more-nginx-module

# Direct configure (Phase B): no bundle wrapper and no LuaJIT env — the
# captured -V args ARE the full configure line; add our four WAF dynamic
# modules and build them against this exact source.
COPY --from=args /tmp/args /tmp/nginx-args
RUN set -eu; \
    export MODSECURITY_INC=/usr/local/modsecurity/include \
           MODSECURITY_LIB=/usr/local/modsecurity/lib; \
    cd /tmp/nginx-src; \
    ./configure $(cat /tmp/nginx-args) \
      --add-dynamic-module=/tmp/ModSecurity-nginx \
      --add-dynamic-module=/tmp/nginx-module-vts \
      --add-dynamic-module=/tmp/ngx_cache_purge \
      --add-dynamic-module=/tmp/ngx_brotli; \
    make modules; \
    mkdir -p /tmp/out; \
    cp objs/ngx_http_modsecurity_module.so \
       objs/ngx_http_vhost_traffic_status_module.so \
       objs/ngx_http_cache_purge_module.so \
       objs/ngx_http_geoip2_module.so \
       objs/ngx_http_headers_more_filter_module.so \
       objs/ngx_http_brotli_filter_module.so \
       objs/ngx_http_brotli_static_module.so /tmp/out/

# Backend patch layer (Phase A4 — the F4 WAF-audit log source, moved here
# from proxywarden; Phase A5 — Static Hosts, the first full-stack feature):
# apply on the vendored virgin tree; the patched files overlay /app in the
# final stage (same assembly upstream uses for backend). 004 also patches
# the stock main nginx.conf (one include line) — the whole vendored tree is
# copied here so backend/ and docker/ paths both resolve.
COPY vendor/npm/ /npm-virgin/
COPY overlay/patches/ /tmp/patches/
RUN set -eu; cd /npm-virgin; \
    for p in /tmp/patches/*.patch; do git apply --check "$p" && git apply "$p"; done; \
    # Schema $ref integrity gate: the backend dereferences the schema at BOOT
    # (getCompiledSchema) — a ref to a missing component crash-loops it. This
    # walks every relative $ref in the patched tree and fails the build instead.
    python3 - <<'PYEOF'
import json, os, glob
missing = []
for f in glob.glob('/npm-virgin/backend/schema/**/*.json', recursive=True):
    try:
        d = json.load(open(f))
    except Exception as e:
        missing.append(('INVALID JSON: ' + str(e), f)); continue
    stack = [d]
    while stack:
        o = stack.pop()
        if isinstance(o, dict):
            for k, v in o.items():
                if k == '$ref' and isinstance(v, str) and v.startswith('.'):
                    target = os.path.normpath(os.path.join(os.path.dirname(f), v.split('#')[0]))
                    if not os.path.isfile(target):
                        missing.append((v, f))
                else:
                    stack.append(v)
        elif isinstance(o, list):
            stack.extend(o)
for ref, src in missing:
    print('MISSING $ref: ' + ref + '  (from ' + src + ')')
# Permission-schema gate: access.can("x:y") loads lib/access/x-y.json at
# request time — a missing file 500s every call with that permission. Every
# statically-used permission string in the patched backend must resolve.
import re
perm_missing = []
for f in glob.glob('/npm-virgin/backend/internal/**/*.js', recursive=True) + glob.glob('/npm-virgin/backend/routes/**/*.js', recursive=True):
    text = open(f, encoding='utf-8').read()
    for m in re.finditer(r'\.can\(\s*["\']([a-z0-9_-]+:[a-z0-9_-]+)["\']', text):
        perm = m.group(1)
        schema = '/npm-virgin/backend/lib/access/' + perm.replace(':', '-') + '.json'
        if not os.path.isfile(schema):
            perm_missing.append((perm, f))
for perm, src in perm_missing:
    print('MISSING permission schema: ' + perm + '  (used in ' + src + ')')
raise SystemExit(1 if missing or perm_missing else 0)
PYEOF

# --- stage 3: overlay onto our app image ------------------------------------
FROM ${WAF_BASE_IMAGE}
ARG CRS_VERSION

# runtime deps of libmodsecurity (trixie names)
RUN set -eu; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      libyajl2 libxml2 libcurl4t64 liblmdb0 libpcre2-8-0; \
    rm -rf /var/lib/apt/lists/*

# slim copy: runtime objects only (skip 222 MB static lib, headers, pkgconfig)
# NOTE: the .so.3 SONAME symlink is created in the final RUN — BuildKit COPY
# of a symlink to an explicit path dereferences it (duplicate 58 MB file).
COPY --from=builder /usr/local/modsecurity/lib/libmodsecurity.so.3.0.17 /usr/local/modsecurity/lib/libmodsecurity.so.3.0.17
COPY --from=builder /usr/local/modsecurity/etc /usr/local/modsecurity/etc
COPY --from=builder /tmp/out/ngx_http_modsecurity_module.so /usr/lib/nginx/modules/
COPY --from=builder /tmp/out/ngx_http_vhost_traffic_status_module.so /usr/lib/nginx/modules/
COPY --from=builder /tmp/out/ngx_http_cache_purge_module.so /usr/lib/nginx/modules/
COPY --from=builder /tmp/out/ngx_http_geoip2_module.so /usr/lib/nginx/modules/
COPY --from=builder /tmp/out/ngx_http_headers_more_filter_module.so /usr/lib/nginx/modules/
COPY --from=builder /tmp/out/ngx_http_brotli_filter_module.so /usr/lib/nginx/modules/
COPY --from=builder /tmp/out/ngx_http_brotli_static_module.so /usr/lib/nginx/modules/
COPY --from=builder /tmp/crs /usr/local/modsecurity/crs

# engine config: paths match the /data/modsec layout seeded on first run
COPY modsec/ /etc/nginx/modsec/

# Backend overlay: the files touched by overlay/patches/ — same assembly as
# upstream's `COPY backend /app` (the patched files overlay these paths).
# Extend this list when a patch touches new files (001: log-viewer, logs;
# 002: main, docs; 003: schema/swagger.json; 004: the Static Hosts stack).
COPY --from=builder /npm-virgin/backend/internal/log-viewer.js /app/internal/
COPY --from=builder /npm-virgin/backend/routes/logs.js /app/routes/
COPY --from=builder /npm-virgin/backend/routes/main.js /app/routes/
# 009 — WAF tuning API (Wave 3): the panel-side canary runbook
COPY --from=builder /npm-virgin/backend/routes/waf.js /app/routes/
COPY --from=builder /npm-virgin/backend/internal/waf.js /app/internal/
COPY --from=builder /npm-virgin/backend/schema/paths/waf/ /app/schema/paths/waf/
# 013 — debrand residuals: db.js (error string) rides the overlay; the
# swagger.json and production.conf.template edits land via the existing COPYs
COPY --from=builder /npm-virgin/backend/db.js /app/
COPY --from=builder /npm-virgin/backend/routes/docs.js /app/routes/
COPY --from=builder /npm-virgin/backend/schema/swagger.json /app/schema/swagger.json
COPY --from=builder /npm-virgin/backend/models/static_host.js /app/models/
COPY --from=builder /npm-virgin/backend/models/certificate.js /app/models/
COPY --from=builder /npm-virgin/backend/internal/static-host.js /app/internal/
COPY --from=builder /npm-virgin/backend/internal/host.js /app/internal/
COPY --from=builder /npm-virgin/backend/internal/certificate.js /app/internal/
COPY --from=builder /npm-virgin/backend/internal/report.js /app/internal/
COPY --from=builder /npm-virgin/backend/internal/metrics.js /app/internal/
COPY --from=builder /npm-virgin/backend/lib/access.js /app/lib/
COPY --from=builder /npm-virgin/backend/lib/access/static_hosts-*.json /app/lib/access/
COPY --from=builder /npm-virgin/backend/routes/nginx/static_hosts.js /app/routes/nginx/
COPY --from=builder /npm-virgin/backend/routes/reports.js /app/routes/
COPY --from=builder /npm-virgin/backend/templates/static_host.conf /app/templates/
COPY --from=builder /npm-virgin/backend/templates/proxy_host.conf /app/templates/
COPY --from=builder /npm-virgin/backend/migrations/20261118120000_static_host.js /app/migrations/
# 011 — geoblocking (Wave 5): the country_deny plumbing (models, render
# gate, shared schema prop, proxy-host schemas/migration)
COPY --from=builder /npm-virgin/backend/models/proxy_host.js /app/models/
COPY --from=builder /npm-virgin/backend/internal/nginx.js /app/internal/
COPY --from=builder /npm-virgin/backend/schema/common.json /app/schema/
COPY --from=builder /npm-virgin/backend/schema/components/proxy-host-object.json /app/schema/components/
COPY --from=builder /npm-virgin/backend/schema/paths/nginx/proxy-hosts/ /app/schema/paths/nginx/proxy-hosts/
COPY --from=builder /npm-virgin/backend/migrations/20261118200000_country_deny.js /app/migrations/
# 012 — max_body_size (Wave 6): the migration (schemas + template ride the
# 011 COPYs — common.json, proxy-host paths, proxy_host.conf are all there)
COPY --from=builder /npm-virgin/backend/migrations/20261118210000_max_body_size.js /app/migrations/
COPY --from=builder /npm-virgin/backend/schema/components/static-host-object.json /app/schema/components/
COPY --from=builder /npm-virgin/backend/schema/components/static-host-list.json /app/schema/components/
COPY --from=builder /npm-virgin/backend/schema/paths/nginx/static-hosts/ /app/schema/paths/nginx/static-hosts/
COPY --from=builder /npm-virgin/backend/schema/paths/reports/hosts/get.json /app/schema/paths/reports/hosts/
COPY --from=builder /npm-virgin/backend/schema/paths/reports/metrics/get.json /app/schema/paths/reports/metrics/
COPY --from=builder /npm-virgin/backend/schema/paths/settings/settingID/ /app/schema/paths/settings/settingID/
# 008 — document_root (Wave 2): the value-validation lib (render-time gate),
# the migration, and the already-copied template/service/schemas carry the
# conditional root + the documentRoot pattern.
COPY --from=builder /npm-virgin/backend/lib/nginx-values.js /app/lib/
COPY --from=builder /npm-virgin/backend/migrations/20261118191000_static_host_document_root.js /app/migrations/
# 006 — LDAP auth: the new backend files...
COPY --from=builder /npm-virgin/backend/internal/ldap.js /app/internal/
COPY --from=builder /npm-virgin/backend/internal/token.js /app/internal/
COPY --from=builder /npm-virgin/backend/internal/user.js /app/internal/
COPY --from=builder /npm-virgin/backend/setup.js /app/setup.js
# 006 — ...and the FIRST runtime dependency added by the patch layer: the
# app image stays stock (its identity is the NPM-equivalent reference), so
# ldapts lands HERE — patched package.json+yarn.lock, then a frozen-lockfile
# reconcile of /app/node_modules (yarn adds only the delta).
COPY --from=builder /npm-virgin/backend/package.json /app/package.json
COPY --from=builder /npm-virgin/backend/yarn.lock /app/yarn.lock
RUN set -eu; \
    npm i -g yarn@1.22.22 >/dev/null 2>&1; \
    yarn install --frozen-lockfile; \
    npm rm -g yarn >/dev/null 2>&1 || true
# 005 also ships the vts zone conf (http-level counters ON) and the patched
# admin template (the 127.0.0.1-only /vts_status display location):
COPY --from=builder /npm-virgin/docker/rootfs/etc/nginx/conf.d/proxywarden-vts-zone.conf /etc/nginx/conf.d/
COPY --from=builder /npm-virgin/docker/rootfs/etc/nginx/conf.d/production.conf.template /etc/nginx/conf.d/production.conf.template
# 004 also ships the stock main nginx.conf with ONE added include line:
COPY --from=builder /npm-virgin/docker/rootfs/etc/nginx/nginx.conf /etc/nginx/nginx.conf

# s6 oneshot that seeds /data/modsec tunables on first run.
# (up files are EXECLINE; shell logic lives in scripts/modsec-seed.sh)
COPY rootfs-s6/ /
RUN set -eu; \
    printf 'oneshot\n' > /etc/s6-overlay/s6-rc.d/modsec-seed/type; \
    chmod +x /etc/s6-overlay/scripts/modsec-seed.sh; \
    touch /etc/s6-overlay/s6-rc.d/user/contents.d/modsec-seed; \
    printf 'oneshot\n' > /etc/s6-overlay/s6-rc.d/geoip2-arm/type; \
    chmod +x /etc/s6-overlay/scripts/geoip2-arm.sh; \
    touch /etc/s6-overlay/s6-rc.d/user/contents.d/geoip2-arm

# Build-time nginx -t gate: transient npm user (never shipped — the stock
# boot's usermod branch has no -o; a pre-existing npm user kills the boot),
# runtime dirs, load_module confs. If ANY module fails to load, the build dies.
RUN set -eu; \
    ln -sf libmodsecurity.so.3.0.17 /usr/local/modsecurity/lib/libmodsecurity.so.3; \
    echo '/usr/local/modsecurity/lib' > /etc/ld.so.conf.d/modsecurity.conf; \
    ldconfig; \
    mkdir -p /etc/nginx/modules; \
    printf 'load_module /usr/lib/nginx/modules/ngx_http_modsecurity_module.so;\n' \
      > /etc/nginx/modules/modsecurity.conf; \
    printf 'load_module /usr/lib/nginx/modules/ngx_http_vhost_traffic_status_module.so;\n' \
      > /etc/nginx/modules/vts.conf; \
    printf 'load_module /usr/lib/nginx/modules/ngx_http_cache_purge_module.so;\n' \
      > /etc/nginx/modules/cache-purge.conf; \
    printf 'load_module /usr/lib/nginx/modules/ngx_http_geoip2_module.so;\n' \
      > /etc/nginx/modules/geoip2.conf; \
    printf 'load_module /usr/lib/nginx/modules/ngx_http_headers_more_filter_module.so;\n' \
      > /etc/nginx/modules/headers-more.conf; \
    printf 'load_module /usr/lib/nginx/modules/ngx_http_brotli_filter_module.so;\n' \
      > /etc/nginx/modules/brotli-filter.conf; \
    printf 'load_module /usr/lib/nginx/modules/ngx_http_brotli_static_module.so;\n' \
      > /etc/nginx/modules/brotli-static.conf; \
    useradd -r -M npm; \
    mkdir -p /tmp/nginx /run/nginx /var/log/nginx /var/cache/nginx \
             /var/lib/nginx/cache/public /var/lib/nginx/cache/private \
             /data/logs; \
    nginx -t; \
    userdel npm; \
    groupdel npm 2>/dev/null || true
