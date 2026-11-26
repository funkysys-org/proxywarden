#!/bin/sh
# The operator curates the pseudo-countries (XX or any code) in
# /data/geoip/override-networks.conf — an OVERRIDE layer with priority over
# the geoip2 lookup for the listed networks. Addresses NOT in that file keep
# the real geoip resolution (a DB miss stays the empty code: deny passes it,
# allow blocks it — fail-closed as designed).
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
CONF_MERGE=/etc/nginx/conf.d/geoip2-override.conf

if [ -f "$DB" ]; then
  mkdir -p /etc/nginx/conf.d /data/geoip
  # ngx_http_geoip2_module: the lookup path is SPACE-SEPARATED nesting
  # ("country iso_code" = the mmdb's country->iso_code), NOT one underscored
  # key — a wrong path yields an EMPTY variable for every lookup, silently.
  printf 'geoip2 %s {\n    auto_reload 5m;\n    $geoip2_data_country_code country iso_code;\n}\n' "$DB" > "$CONF"

  # The operator's override layer: networks mapped to pseudo-countries
  # (any code: XX, HQ, ...). Seeded ONCE — never clobbered on later boots.
  NETWORKS=/data/geoip/override-networks.conf
  if [ ! -f "$NETWORKS" ]; then
    printf '# proxywarden: your network overrides — these take priority over\n# the geoip2 lookup for the listed addresses.\n# Format: <CIDR or single IP>  <CODE>;\n#10.0.0.0/8        XX;\n#192.168.0.0/16    XX;\n#203.0.113.0/24    HQ;\n' > "$NETWORKS"
    echo "geoip2-arm: seeded $NETWORKS (edit it to map your networks)"
  fi

  # The merge include ships ONLY when the override file is actually
  # readable — a seed that failed silently (ro volume, perms) must NEVER
  # take nginx down with an unresolvable include. The override layer is
  # skippable by design: without it, $country_code stays pure geoip2.
  if [ -f "$NETWORKS" ]; then
    printf 'geo $geoip2_override {\n    default "";\n    include %s;\n}\nmap $geoip2_override $country_code {\n    ""      $geoip2_data_country_code;\n    default $geoip2_override;\n}\n' "$NETWORKS" > "$CONF_MERGE"
  else
    rm -f "$CONF_MERGE"
    echo "geoip2-arm: WARNING — $NETWORKS missing and unseedable, override layer SKIPPED (nginx stays clean, pure geoip2)"
  fi
  echo "geoip2-arm: armed ($DB) + override layer ($NETWORKS)"
else
  rm -f "$CONF" "$CONF_MERGE"
  echo "geoip2-arm: no GeoLite2 DB at $DB — country rules dormant"
fi
