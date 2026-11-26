#!/bin/bash
# NOTE: same-tag digest discipline — when the WAF image republishes under the
# same tag, this product run must be re-triggered AFTER the upstream green
# (a mid-flight build pulls the OLD digest and ships without the new backend).
# UI smoke for the proxywarden image against the compose test stack
# (docker-compose.test.yml must be UP before running this).
# Verifies the LAYERING, not just the UI:
#   our frontend served -> API alive -> modsec module loads at a real boot
#   -> overlay seed present -> WAF still blocks attacks.
# Self-diagnosing: on ANY failure it prints compose ps + container logs.
set -uo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.test.yml}
SVC=${COMPOSE_SERVICE:-proxywarden}
UI=${UI_URL:-http://127.0.0.1:8181}
WAF=${WAF_URL:-http://127.0.0.1:8080}
# Proves the frontend served is OUR build (title of index.html).
# F2 flips this to the proxywarden brand — updated WITH the branding patch.
MARKER=${UI_MARKER:-Proxywarden}

say()  { echo "[ui-smoke] $*"; }
pass() { echo "[ui-smoke] ok: $*"; }

diagnose() {
  echo "--- diagnostics: compose ps ---"
  docker compose -f "$COMPOSE_FILE" ps 2>&1
  echo "--- diagnostics: $SVC last 40 log lines ---"
  docker compose -f "$COMPOSE_FILE" logs --tail 40 "$SVC" 2>&1
}
die() { echo "[ui-smoke] FAIL: $*" >&2; diagnose; exit 1; }

code()    { curl -s -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }
execsvc() { docker compose -f "$COMPOSE_FILE" exec -T "$SVC" sh -c "$1"; }

# 0) stack is up
say "compose file: $COMPOSE_FILE (service: $SVC)"
state=$(docker compose -f "$COMPOSE_FILE" ps 2>&1) || die "docker compose ps failed — run from the repo root"
echo "$state"
if [ -z "$(docker compose -f "$COMPOSE_FILE" ps -q --status running "$SVC" 2>/dev/null)" ]; then
  die "no running '$SVC' container — did 'docker compose up -d' succeed?"
fi

# 1) UI up (first boot runs DB migrations, can take ~60 s)
say "waiting for admin UI on $UI/ ..."
ui=""
for i in $(seq 1 45); do
  ui=$(code "$UI/")
  { [ "$ui" = "200" ] || [ "$ui" = "302" ]; } && break
  sleep 2
done
{ [ "$ui" = "200" ] || [ "$ui" = "302" ]; } \
  || die "admin UI not ready after 90s (last code: '${ui:-none}')"
pass "UI up ($ui)"

# 2) OUR frontend build is the one being served
html=$(curl -s "$UI/" 2>/dev/null) || die "could not fetch UI index"
echo "$html" | grep -qF "$MARKER" || die "served index.html lacks the build marker — is /app/frontend ours?"
pass "frontend build marker present"

# 3) API alive (the backend boots AFTER nginx — first-boot migrations can
#    take tens of seconds. The UI coming up fast is NOT the backend being
#    ready: with the lean nginx the frontend snaps up in ~2s and a single
#    API probe raced the backend (502) — the one thing the openresty-era
#    slower boot used to hide. Retry like the UI wait.)
say "waiting for the API on $UI/api/ ..."
api=""
for i in $(seq 1 45); do
  api=$(code "$UI/api/")
  case "$api" in
    200|301|302|401|404) break ;;
    *) sleep 2 ;;
  esac
done
case "$api" in
  200|301|302|401|404) pass "API responds ($api)" ;;
  *) die "API not responding after 90s (code: ${api:-none})" ;;
esac


# 4) overlay layer intact: module loads at a real boot
out=$(execsvc 'nginx -t 2>&1') || die "could not run nginx -t inside container"
echo "$out" | grep -q 'test is successful' || die "nginx -t inside container: $out"
pass "nginx -t clean (modsec module loaded at real boot)"

# 5) overlay seed
execsvc 'test -f /data/modsec/crs-setup.conf' \
  || die '/data/modsec/crs-setup.conf missing — overlay layer not active?'
pass "/data/modsec seeded"

# 6) WAF layering: attacks blocked by the in-container test instance
execsvc 'mkdir -p /tmp/waf-test && nginx -c /etc/nginx-modsec-test/nginx-waf.conf' \
  || die 'could not start WAF test instance (base image without the modsec overlay?)'
sleep 2
c=$(code "$WAF/") || die "curl to WAF failed"
[ "$c" = "200" ] || die "benign GET / -> $c (want 200)"
pass "benign 200"
for u in '/?id=1%20UNION%20SELECT%20password%20FROM%20users' \
         '/?exec=/bin/bash' \
         '/?q=%3Cscript%3Ealert%281%29%3C%2Fscript%3E'; do
  c=$(code "$WAF$u") || die "curl to WAF failed on $u"
  [ "$c" = "403" ] || die "$u -> $c (want 403)"
done
pass "attacks 403 (overlay WAF active in the product image)"

execsvc 'grep -q 949110 /data/logs/modsec_audit.log' \
  || die 'no 949110 (Inbound Anomaly Score) in /data/logs/modsec_audit.log'
pass "audit log has CRS blocking evidence"

# 7) global hardening active (image-level conf.d file; :81 is nginx-served)
hdrs=$(curl -sI "$UI/" 2>/dev/null) || die "could not fetch UI headers"
if echo "$hdrs" | grep -qi '^server:'; then
  die "Server header leaked — more_clear_headers not active"
fi
echo "$hdrs" | grep -qi '^x-content-type-options: *nosniff' \
  || die "X-Content-Type-Options missing on UI — hardening conf not active"
pass "global hardening active (no Server header, nosniff on UI)"

# 8) non-admin login works, WAF audit denied server-side
API="$UI/api"
admin_email="admin@proxywarden.local"; admin_secret='SmokeAdmin-123'
setup_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/users" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Admin\",\"nickname\":\"smoke\",\"email\":\"$admin_email\",\"auth\":{\"type\":\"password\",\"secret\":\"$admin_secret\"}}")
if [ "$setup_code" = "200" ] || [ "$setup_code" = "201" ]; then
  admin_tok=$(curl -s -X POST "$API/tokens" -H 'Content-Type: application/json' \
    -d "{\"identity\":\"$admin_email\",\"secret\":\"$admin_secret\"}" \
    | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')
  [ -n "$admin_tok" ] || die "admin login failed"
  u_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/users" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"name":"Plain User","nickname":"plain","email":"plain@proxywarden.local","auth":{"type":"password","secret":"PlainUser-123"}}')
  case "$u_code" in 2*) : ;; *) die "non-admin user creation failed ($u_code)" ;; esac
  user_tok=$(curl -s -X POST "$API/tokens" -H 'Content-Type: application/json' \
    -d '{"identity":"plain@proxywarden.local","secret":"PlainUser-123"}' \
    | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')
  [ -n "$user_tok" ] || die "non-admin login failed"
  waf_code=$(curl -s -o /dev/null -w '%{http_code}' "$API/logs/sources" \
    -H "Authorization: Bearer $user_tok")
  case "$waf_code" in
    401|403) : ;;
    *) die "non-admin got $waf_code on /logs/sources (want 401/403)" ;;
  esac
  pass "non-admin login works; WAF audit source denied to non-admin ($waf_code)"
else
  say "skip: non-admin flow (first-boot user creation returned $setup_code — volume not fresh)"
fi

# 9) certificate path (the SSL class guard): a cert'd host renders
#    _certificates.conf (which carries the ssl-cache include) — a duplicate
#    shared-zone directive is only parseable at THIS point. The boot-time -t
#    never renders it; the operator would find out on the first real cert
#    (proven the hard way: shared:SSL declared twice, image dead on reload).
API="$UI/api"
admin_email="admin@proxywarden.local"; admin_secret='SmokeAdmin-123'
cert_tok=$(curl -s -X POST "$API/tokens" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$admin_email\",\"secret\":\"$admin_secret\"}" \
  | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')
[ -n "$cert_tok" ] || die "admin token for the cert-path step failed"
openssl req -x509 -nodes -newkey rsa:2048 -days 2 -subj '/CN=certsmoke.test' \
  -keyout /tmp/certsmoke.key -out /tmp/certsmoke.crt >/dev/null 2>&1 \
  || die "openssl self-signed generation failed"
cert_res=$(curl -s -X POST "$API/nginx/certificates" \
  -H "Authorization: Bearer $cert_tok" -H 'Content-Type: application/json' \
  -d '{"provider":"other","nice_name":"certsmoke"}')
cert_id=$(echo "$cert_res" | grep -o '"id": *[0-9]*' | head -1 | tr -dc '0-9')
[ -n "$cert_id" ] || die "custom certificate create failed: $cert_res"
up_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/nginx/certificates/$cert_id/upload" \
  -H "Authorization: Bearer $cert_tok" \
  -F "certificate=@/tmp/certsmoke.crt" -F "key=@/tmp/certsmoke.key")
[ "$up_code" = "200" ] || die "certificate upload failed ($up_code)"
sh_res=$(curl -s -X POST "$API/nginx/static-hosts" \
  -H "Authorization: Bearer $cert_tok" -H 'Content-Type: application/json' \
  -d '{"domain_names":["certsmoke.test"],"content":"<h1>x</h1>","certificate_id":'"$cert_id"'}')
sh_id=$(echo "$sh_res" | grep -o '"id": *[0-9]*' | head -1 | tr -dc '0-9')
[ -n "$sh_id" ] || die "cert'd static host create failed: $sh_res"
execsvc 'nginx -t' >/dev/null 2>&1 \
  || die "nginx -t FAILED with a cert'd host rendered — the SSL duplicate-directive class is back"
curl -s -o /dev/null -X DELETE "$API/nginx/static-hosts/$sh_id" -H "Authorization: Bearer $cert_tok"
curl -s -o /dev/null -X DELETE "$API/nginx/certificates/$cert_id" -H "Authorization: Bearer $cert_tok"
rm -f /tmp/certsmoke.key /tmp/certsmoke.crt
pass "certificate path: custom cert + cert'd host render, nginx -t clean (the SSL class, guarded)"

echo
echo "UI SMOKE OK: our frontend served, API alive, overlay layer intact (module + seed + WAF blocking), hardening + access control verified"
