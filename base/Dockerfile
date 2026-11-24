#############
# Nginx Builder (Phase B: plain nginx.org source — no OpenResty bundle,
# no LuaJIT, no lua-resty. The vendored tree is now OUR base: labels are
# ours from line one; the fork point lives in PROVENANCE.md.)
#############

FROM debian:trixie-slim AS nginxbuilder

ARG NGINX_VERSION
ENV NGINX_VERSION=${NGINX_VERSION}

RUN apt-get update \
	&& apt-get install -y \
	build-essential \
	ca-certificates \
	libpcre2-dev \
	libssl-dev \
	wget \
	zlib1g-dev \
	git \
	libmaxminddb-dev

# Nginx build: nginx.org tarball, sha256-pinned in the script (fail-closed
# on a version bump without its sha); geoip2 as the dynamic module at the
# literal path the overlay's captured-args configure will expect back.
COPY ./base/scripts/build-nginx.sh /tmp/build-nginx.sh
RUN /tmp/build-nginx.sh

#############
# Final Image
#############

FROM debian:trixie-slim AS final
LABEL maintainer="funkysys-org"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG TARGETPLATFORM
RUN echo "Base: debian:trixie-slim, ${TARGETPLATFORM:-linux/amd64}" > /built-for-arch

# Same runtime set the openresty base carried, minus the Lua-only libs
# (libncurses6 / libreadline8 rode with LuaJIT, which is gone).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
	apache2-utils \
	ca-certificates \
	curl \
	figlet \
	jq \
	libpcre2-8-0 \
	openssl \
	perl \
	tzdata \
	unzip \
	zlib1g \
	gettext \
	wget \
	xz-utils \
	libmaxminddb-dev \
	moreutils \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/* \
	&& rm -rf /var/cache/* /var/log/* /tmp/* /var/lib/dpkg/status-old

COPY ./base/files/.bashrc /root/.bashrc

# Copy the nginx build from the first image and install it (make only for
# the install; the openresty install's gcc/socat/git/wget/gettext rode
# with luarocks, which is gone with the bundle).
COPY --from=nginxbuilder /tmp/nginx-src /tmp/nginx-src
COPY ./base/scripts/install-nginx.sh /tmp/install-nginx.sh

ARG NGINX_VERSION
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
	NGINX_VERSION=${NGINX_VERSION}

RUN apt-get update \
	&& apt-get install -y make \
	&& /tmp/install-nginx.sh \
	&& apt-get remove -y make \
	&& apt-get autoremove -y \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/* \
	&& rm -rf /var/cache/* /var/log/* /tmp/* /var/lib/dpkg/status-old

LABEL org.label-schema.schema-version="1.0" \
	org.label-schema.license="MIT" \
	org.label-schema.name="nginx-full" \
	org.label-schema.description="The funkysys-org nginx base for Proxywarden (Phase B: plain nginx, no bundle)" \
	org.label-schema.url="https://github.com/funkysys-org/nginx-full" \
	org.label-schema.vcs-url="https://github.com/funkysys-org/nginx-full.git" \
	org.label-schema.cmd="ghcr.io/funkysys-org/nginx-full"
