#!/bin/bash -e
#
# Phase B: the lean base. nginx.org mainline + our dynamic module set —
# no OpenResty bundle, no LuaJIT, no lua-resty stack. Nothing in this
# chain ever executed a line of Lua (verified: zero by_lua / resty. /
# openidc / cjson references across every config, template and script we
# ship), and the bundle lag on nginx security releases cost this project
# two manual bridge-patch waves. The core is the SAME one that ran inside
# openresty 1.31.9.1: nginx 1.31.9.
#
# The sha256 case block IS the provenance of the base: a version bump
# without its pinned sha dies here, fail-closed.

BLUE='\E[1;34m'
CYAN='\E[1;36m'
YELLOW='\E[1;33m'
GREEN='\E[1;32m'
RESET='\E[0m'

echo -e "${BLUE}❯ ${CYAN}Building nginx ${YELLOW}${NGINX_VERSION}${RESET}"

case "${NGINX_VERSION}" in
	1.31.9)
		NGINX_SHA256="a11c5eeee2e257f4478f0e649f84b0040787d277d2d3e5233952aa6b6dcb80ad"
		;;
	1.31.10)
		NGINX_SHA256="a9b690957fca84abdae8a9b52d66b1bb459282d7f01fe4b94b498ed8e977bdb3"
		;;
	*)
		echo "FATAL: no sha256 pinned for nginx ${NGINX_VERSION} — add it to the case block in build-nginx.sh" >&2
		exit 1
		;;
esac

cd /tmp

wget "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz"
echo "${NGINX_SHA256}  nginx-${NGINX_VERSION}.tar.gz" | sha256sum -c -

tar -xzf "nginx-${NGINX_VERSION}.tar.gz"
mv "/tmp/nginx-${NGINX_VERSION}" /tmp/nginx-src

# geoip2 at the LITERAL path that gets baked into the binary's configure
# arguments — the overlay re-runs configure with the captured args and
# needs the module source at exactly this path.
git clone 'https://github.com/leev/ngx_http_geoip2_module.git' /tmp/nginx-src/ngx_http_geoip2_module

# headers-more v0.42 — the ONE former-bundle module this chain genuinely
# uses: proxywarden-hardening.conf erases the Server header entirely
# (server_tokens only trims the version). Pinned at the bundle's last
# version; loaded by the overlay's printf chain, audited 2026-11-24.
git clone --depth 1 --branch v0.42 \
	'https://github.com/openresty/headers-more-nginx-module.git' \
	/tmp/nginx-src/headers-more-nginx-module

cd /tmp/nginx-src

./configure \
	--prefix=/etc/nginx/nginx \
	--with-cc-opt='-O2' \
	--sbin-path=/usr/sbin/nginx \
	--modules-path=/usr/lib/nginx/modules \
	--conf-path=/etc/nginx/nginx.conf \
	--error-log-path=/var/log/nginx/error.log \
	--http-log-path=/var/log/nginx/access.log \
	--pid-path=/var/run/nginx.pid \
	--lock-path=/var/run/nginx.lock \
	--http-client-body-temp-path=/var/cache/nginx/client_temp \
	--http-proxy-temp-path=/var/cache/nginx/proxy_temp \
	--http-fastcgi-temp-path=/var/cache/nginx/fastcgi_temp \
	--http-uwsgi-temp-path=/var/cache/nginx/uwsgi_temp \
	--http-scgi-temp-path=/var/cache/nginx/scgi_temp \
	--user=nginx \
	--group=nginx \
	--with-compat \
	--with-threads \
	--with-http_addition_module \
	--with-http_auth_request_module \
	--with-http_dav_module \
	--with-http_flv_module \
	--with-http_gunzip_module \
	--with-http_gzip_static_module \
	--with-http_mp4_module \
	--with-http_random_index_module \
	--with-http_realip_module \
	--with-http_secure_link_module \
	--with-http_slice_module \
	--with-http_ssl_module \
	--with-http_stub_status_module \
	--with-http_sub_module \
	--with-http_v2_module \
	--with-mail \
	--with-mail_ssl_module \
	--with-stream \
	--with-stream_realip_module \
	--with-stream_ssl_module \
	--with-stream_ssl_preread_module \
	--with-http_v3_module \
	--add-dynamic-module=/tmp/nginx-src/ngx_http_geoip2_module \
	--add-dynamic-module=/tmp/nginx-src/headers-more-nginx-module

make -j"$(nproc)"

echo -e "${BLUE}❯ ${GREEN}nginx build completed${RESET}"
