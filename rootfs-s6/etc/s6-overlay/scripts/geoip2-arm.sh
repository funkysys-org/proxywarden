#!/bin/sh
# default=XX: any address the DB cannot resolve (RFC1918/private, loopback,
# link-local, or a DB miss) yields the pseudo-code XX — the operator manages
# it as a NORMAL list entry: XX in an allow-list lets private networks pass,
# XX in a deny-list blocks them per host. The trade-off is global: every DB
# miss lands in XX (fail-closed by nature; the geoipupdate sidecar keeps the
# misses rare).
# Arms the geoip2 country lookup when the operator provides a GeoLite2
# Country DB at /data/geoip/GeoLite2-Country.mmdb (e.g. via the official
# maxmindinc/geoipupdate sidecar writing to a volume mounted there).
# Writes the nginx include; REMOVES it when the DB is absent — the
# $geoip2_data_country_code variable only exists when this include does,
# so hosts with country_deny stay renderable either way (the backend
# skips the if() lines when unarmed).
# Idempotent: safe at every boot.
DB=/data/geoip/GeoLite2-Country.mmdb
CONF=/etc/nginx/conf.d/geoip2.conf

if [ -f "$DB" ]; then
  mkdir -p /etc/nginx/conf.d
  # ngx_http_geoip2_module: the lookup path is SPACE-SEPARATED nesting
  # ("country iso_code" = the mmdb's country->iso_code), NOT one underscored
  # key — a wrong path yields an EMPTY variable for every lookup, silently.
  printf 'geoip2 %s {\n    auto_reload 5m;\n    $geoip2_data_country_code default=XX country iso_code;\n}\n' "$DB" > "$CONF"
  echo "geoip2-arm: armed ($DB)"
else
  rm -f "$CONF"
  echo "geoip2-arm: no GeoLite2 DB at $DB — country rules dormant"
fi
