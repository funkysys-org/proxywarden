# armer runs at EVERY boot: DB deployed → write all files; DB gone →
# remove them all. Idempotent, reactive, no manual steps.
MMDB=/data/geoip/GeoLite2-Country.mmdb
LOAD=/etc/nginx/modules/10-geoip2-load.conf
BLOCK=/etc/nginx/conf.d/geoip2.conf
MERGE=/etc/nginx/conf.d/geoip2-override.conf
NETWORKS=/data/nginx/override-networks.conf
if [ -f "$MMDB" ]; then
  printf 'load_module /usr/lib/nginx/modules/ngx_http_geoip2_module.so;\n' > "$LOAD"
  # ngx_http_geoip2_module: space-separated lookup path (country iso_code),
  # not one underscored key — wrong path = empty variable for every lookup.
  printf 'geoip2 %s {\n  auto_reload 5m;\n  $geoip2_data_country_code country iso_code;\n}\n' "$MMDB" > "$BLOCK"
  # The operator's override layer: networks mapped to pseudo-countries
  # (any code: XX, HQ, ...). Seeded ONCE — never clobbered on later boots.
  if [ ! -f "$NETWORKS" ]; then
    mkdir -p /data/nginx
    printf '# proxywarden: your network overrides — these take priority over\n# the geoip2 lookup for the listed addresses.\n# Format: <CIDR or single IP>  <CODE>;\n#10.0.0.0/8        XX;\n#192.168.0.0/16    XX;\n#203.0.113.0/24    HQ;\n' > "$NETWORKS"
  fi
  # The merge include ships ONLY when the override file exists — a failed
  # seed must never kill nginx with an unresolvable include (fail-safe).
  if [ -f "$NETWORKS" ]; then
    printf 'geo $geoip2_override {\n  default "";\n  include %s;\n}\nmap $geoip2_override $country_code {\n  ""      $geoip2_data_country_code;\n  default $geoip2_override;\n}\n' "$NETWORKS" > "$MERGE"
  else
    rm -f "$MERGE"
    echo "25-geoblock: WARNING — $NETWORKS missing and unseedable, override layer skipped"
  fi
else
