#!/bin/bash
# Parity gate (Phase B form): the base is OURS — plain nginx.org source,
# no OpenResty bundle. The tier-1 comparison against the official NPM
# image (jc21's openresty-based reference) RETIRED with the engine swap:
# see PROVENANCE.md. What remains is the strongest form of the gate that
# era produced: the SELF-ORACLE — the committed configure-args line the
# binary must reproduce byte-for-byte, which moves only in a reviewed
# commit.
#
#   version: banner == nginx/${NGINX_VERSION}     → else FAIL (the pin lies)
#   args:    ours == parity/our-configure-args   → PASS
#            else                                 → FAIL, printing the
#                                                     captured args and
#                                                     the file to commit
#
# A new base shape (version bump, configure change) therefore costs one
# reviewed commit by design: run 1 dies here and prints the args; the
# human reviews against the release notes; commit; run 2 ships.
set -eu

OURS="${1:?usage: parity-check.sh <our-image>}"
NGINX_VERSION="${NGINX_VERSION:?set NGINX_VERSION}"
SELF_ORACLE="parity/our-configure-args.txt"

ver()  { docker run --rm --entrypoint nginx "$1" -V 2>&1 | sed -n 's/^nginx version: //p'; }
args() { docker run --rm --entrypoint nginx "$1" -V 2>&1 | sed -n 's/^configure arguments: //p'; }

fail() { echo "::error::parity: $*" >&2; exit 1; }

our_ver="$(ver "$OURS")"
[ "$our_ver" = "nginx/${NGINX_VERSION}" ] \
  || fail "base binary is '${our_ver}', pinned nginx/${NGINX_VERSION} — the pin and the build disagree"

our_args="$(args "$OURS")"

if [ -f "$SELF_ORACLE" ] && [ "$our_args" = "$(cat "$SELF_ORACLE")" ]; then
  echo "PARITY OK: nginx/${NGINX_VERSION} — configure args match the committed self-oracle"
  exit 0
fi

echo "::error::parity: configure args do NOT match the committed self-oracle." >&2
echo "  Committed: $(cat "$SELF_ORACLE" 2>/dev/null || echo '<missing>')" >&2
echo "  Ours:      ${our_args}" >&2
echo "  If this is the intentional base change (version bump, configure edit —" >&2
echo "  review the diff against the release notes), commit ours to ${SELF_ORACLE}" >&2
echo "  and re-run. Nothing ships until then." >&2
exit 1
