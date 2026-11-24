#!/bin/sh
# Seeds /data/modsec tunables on first run.
# Invoked by the modsec-seed s6-rc oneshot via its execline `up` file —
# oneshot `up` files must be execline, so shell logic lives here.
SRC=/usr/local/modsecurity/crs
DST=/data/modsec

if [ ! -f "$DST/crs-setup.conf" ]; then
  mkdir -p "$DST"
  cp "$SRC/crs-setup.conf" "$DST/crs-setup.conf"
  printf '# custom rules evaluated BEFORE CRS\n' > "$DST/rules-before.conf"
  printf '# custom rules/exclusions evaluated AFTER CRS\n' > "$DST/rules-after.conf"
  echo "modsec-seed: seeded $DST"
fi
