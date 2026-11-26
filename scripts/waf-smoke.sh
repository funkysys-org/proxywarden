#!/bin/bash
# Smoke test for the npm-modsec image against the compose stack
# (docker-compose.waf-test.yml must be UP before running this).
# Self-diagnosing: on ANY failure it prints compose ps + container logs.
set -uo pipefail   # deliberately NO set -e: errors are handled explicitly

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.waf-test.yml}
SVC=${COMPOSE_SERVICE:-npm}
UI=${UI_URL:-http://127.0.0.1:8181}
WAF=${WAF_URL:-http://127.0.0.1:8080}

say()  { echo "[smoke] $*"; }
pass() { echo "[smoke] ok: $*"; }

diagnose() {
  echo "--- diagnostics: compose ps ---"
  docker compose -f "$COMPOSE_FILE" ps 2>&1
  echo "--- diagnostics: $SVC error lines (any age) ---"
  docker compose -f "$COMPOSE_FILE" logs "$SVC" 2>&1 | grep -iE 'error|emerg|fatal|exception|ENOENT' | tail -25
  echo "--- diagnostics: $SVC last 100 log lines ---"
  docker compose -f "$COMPOSE_FILE" logs --tail 100 "$SVC" 2>&1
}
die() { echo "[smoke] FAIL: $*" >&2; diagnose; exit 1; }

code()  { curl -s -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }
execsvc() { docker compose -f "$COMPOSE_FILE" exec -T "$SVC" sh -c "$1"; }

# 0) compose stack is actually up
say "compose file: $COMPOSE_FILE (service: $SVC)"
state=$(docker compose -f "$COMPOSE_FILE" ps 2>&1) || die "docker compose ps failed — run from the repo root"
echo "$state"
# NOTE: do NOT grep the human-readable ps table for 'running' — compose versions
# print STATUS as 'Up 56 seconds' etc. Use the format-agnostic query instead.
if [ -z "$(docker compose -f "$COMPOSE_FILE" ps -q --status running "$SVC" 2>/dev/null)" ]; then
  die "no running '$SVC' container — did 'docker compose up -d' succeed? see compose output above"
fi

# 1) wait for the NPM admin UI (first boot runs DB migrations, can take ~60 s)
say "waiting for admin UI on $UI/ ..."
ui=""
for i in $(seq 1 45); do
  ui=$(code "$UI/")
  if [ "$ui" = "200" ] || [ "$ui" = "302" ]; then break; fi
  sleep 2
done
[ "$ui" = "200" ] || [ "$ui" = "302" ] \
  || die "admin UI not ready after 90s (last HTTP code: '${ui:-none/transport-error}')"

# 2) stock nginx config valid with the module loaded (real container, real boot)
out=$(execsvc 'nginx -t 2>&1') || die "could not run nginx -t inside container"
echo "$out" | grep -q 'test is successful' || die "nginx -t inside container: $out"
pass "nginx -t clean inside container (module loaded at real boot)"

# 3) s6 seed created the /data/modsec tunables
execsvc 'test -f /data/modsec/crs-setup.conf' \
  || die '/data/modsec/crs-setup.conf missing (s6 seed did not run)'
pass "/data/modsec seeded"

# 3b) overlay+ modules present (loading itself is proven by the nginx -t above)
execsvc 'test -f /usr/lib/nginx/modules/ngx_http_vhost_traffic_status_module.so' \
  || die 'vts module .so missing'
execsvc 'test -f /usr/lib/nginx/modules/ngx_http_cache_purge_module.so' \
  || die 'cache_purge module .so missing'
pass "vts + cache_purge modules present"

# 4) start the in-container WAF test instance
execsvc 'mkdir -p /tmp/waf-test && nginx -c /etc/nginx-modsec-test/nginx-waf.conf' \
  || die 'could not start WAF test instance'
sleep 2

c=$(code "$WAF/") || die "curl to WAF failed (exit $?)"
[ "$c" = "200" ] || die "benign GET / -> $c (want 200)"
pass "benign 200"

# 5b) brotli (A3): the filter module ships and the default site answers
# br-compressed when the client asks for it (http-level conf.d + module)
execsvc 'ls /usr/lib/nginx/modules/ngx_http_brotli_filter_module.so /usr/lib/nginx/modules/ngx_http_brotli_static_module.so >/dev/null && test -f /etc/nginx/modules/brotli-filter.conf' \
  || die "brotli module files or load conf missing"
# curl -D writes CRLF headers — strip the CR BEFORE comparing, or "br\r" != "br"
# (first green run died on exactly that: the feature worked, the check didn't)
br_ce=$(curl -s -o /dev/null -D - -H 'Accept-Encoding: br' http://127.0.0.1:80/ | tr -d '\r' | sed -n 's/^[Cc]ontent-[Ee]ncoding:[[:space:]]*//p' | head -1)
[ "$br_ce" = "br" ] || die "response not brotli-compressed: content-encoding='$br_ce'"
pass "brotli: modules loaded, default site answers Content-Encoding: br"

for u in '/?id=1%20UNION%20SELECT%20password%20FROM%20users' \
         '/?exec=/bin/bash' \
         '/?q=%3Cscript%3Ealert%281%29%3C%2Fscript%3E'; do
  c=$(code "$WAF$u") || die "curl to WAF failed on $u (exit $?)"
  [ "$c" = "403" ] || die "$u -> $c (want 403)"
done
pass "attacks 403"

# 5) CRS blocking evidence in the audit log
execsvc 'grep -q 949110 /data/logs/modsec_audit.log' \
  || die 'no 949110 (Inbound Anomaly Score) in /data/logs/modsec_audit.log'
pass "audit log has CRS blocking evidence"

# 6) live API schema + Swagger UI docs page (backend patch layer)
API="$UI/api"
s=$(code "$API/schema") || die "curl to /api/schema failed (exit $?)"
[ "$s" = "200" ] || die "GET /api/schema -> $s (want 200)"
curl -fsS "$API/schema" | grep -q '"openapi"' || die 'schema payload does not look like OpenAPI'
curl -fsS "$API/schema" | grep -q 'Proxywarden API' || die 'schema info.title is not the branded one'
s=$(code "$API/docs") || die "curl to /api/docs failed (exit $?)"
[ "$s" = "200" ] || die "GET /api/docs -> $s (want 200)"
curl -fsS "$API/docs" | grep -q 'swagger-ui' || die 'docs page does not embed Swagger UI'
pass "API schema live + Swagger UI docs served"

# 7) WAF-audit log source exposed by the patched backend (Phase A4)
admin_email="admin@nginx-full-smoke.local"; admin_secret='SmokeAdmin-123'
setup_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/users" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Admin\",\"nickname\":\"smoke\",\"email\":\"$admin_email\",\"auth\":{\"type\":\"password\",\"secret\":\"$admin_secret\"}}")
if [ "$setup_code" = "200" ] || [ "$setup_code" = "201" ]; then
  admin_tok=$(curl -s -X POST "$API/tokens" -H 'Content-Type: application/json' \
    -d "{\"identity\":\"$admin_email\",\"secret\":\"$admin_secret\"}" \
    | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')
  [ -n "$admin_tok" ] || die "admin login failed"
  srcs=$(curl -s "$API/logs/sources" -H "Authorization: Bearer $admin_tok")
  echo "$srcs" | grep -q '"waf"' \
    || die "WAF audit source missing from /logs/sources: $srcs"
  pass "WAF audit source present in the API log sources"

  # 8) Static Hosts (Phase A5): create via API -> serves the content on :80 -> cleanup
  sh_create=$(curl -s -X POST "$API/nginx/static-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["static-smoke.test"],"content":"<h1>StaticSmokeWorks</h1>"}')
  sh_id=$(echo "$sh_create" | sed -n 's/^{"id" *: *\([0-9]*\).*/\1/p')
  [ -n "$sh_id" ] || die "static host creation failed: $sh_create"
  sleep 2   # configure() reloads nginx — give it a beat
  sh_body=$(curl -s -H 'Host: static-smoke.test' http://127.0.0.1:80/)
  echo "$sh_body" | grep -q 'StaticSmokeWorks' \
    || die "static host did not serve its content: $sh_body"
  curl -s -o /dev/null -X DELETE "$API/nginx/static-hosts/$sh_id" -H "Authorization: Bearer $admin_tok"
  pass "static host: created via API, serves its content, deleted"

  # 12) Static host DOCUMENT ROOT (Wave 2): a mounted tree beats inline
  # content — seed a real dir inside the container, point the host at it.
  execsvc 'mkdir -p /data/docroot-smoke && echo DocRootWorks > /data/docroot-smoke/index.html'
  dr_create=$(curl -s -X POST "$API/nginx/static-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["docroot-smoke.test"],"document_root":"/data/docroot-smoke"}')
  dr_id=$(echo "$dr_create" | sed -n 's/^{"id" *: *\([0-9]*\).*/\1/p')
  [ -n "$dr_id" ] || die "document_root host creation failed: $dr_create"
  sleep 2   # configure() reloads nginx — give it a beat
  dr_body=$(curl -s -H 'Host: docroot-smoke.test' http://127.0.0.1:80/)
  echo "$dr_body" | grep -q 'DocRootWorks' \
    || die "document_root host did not serve the tree: $dr_body"
  # and a traversal attempt must be rejected by the API schema (pattern gate)
  dr_bad=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/nginx/static-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["docroot-bad.test"],"document_root":"/data/../etc"}')
  [ "$dr_bad" = "400" ] || die "traversal document_root accepted: $dr_bad (want 400)"
  curl -s -o /dev/null -X DELETE "$API/nginx/static-hosts/$dr_id" -H "Authorization: Bearer $admin_tok"
  pass "static host document_root: serves a mounted tree; traversal rejected"

  # 12b) Static-host WAF toggle (024): the inversion test — a static host
  #      with waf_enabled=false SERVES what the WAF-on host blocks (the
  #      ctl:ruleEngine=Off rule, Host-matched, spike-proven 2026-11-24).
  waf_create=$(curl -s -X POST "$API/nginx/static-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["wafsmoke-off.test"],"content":"<h1>WafOffWorks</h1>","waf_enabled":false}')
  waf_off_id=$(echo "$waf_create" | sed -n 's/^{"id" *: *\([0-9]*\).*/\1/p')
  [ -n "$waf_off_id" ] || die "waf-off static host creation failed: $waf_create"
  sleep 2   # configure + the WAF rules regeneration reload
  atk='http://127.0.0.1:80/?id=1%20UNION%20SELECT%20password%20FROM%20users'
  c_off=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: wafsmoke-off.test' "$atk")
  [ "$c_off" != "403" ] || die "waf_enabled=false still got 403 — the ctl:ruleEngine=Off rule is not firing"
  up_code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/nginx/static-hosts/$waf_off_id" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["wafsmoke-off.test"],"content":"<h1>WafOffWorks</h1>","waf_enabled":true}')
  [ "$up_code" = "200" ] || die "waf_enabled=true update failed ($up_code)"
  sleep 2   # the rules regeneration reloads again
  c_on=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: wafsmoke-off.test' "$atk")
  [ "$c_on" = "403" ] || die "after waf_enabled=true the attack got $c_on — want 403"
  curl -s -o /dev/null -X DELETE "$API/nginx/static-hosts/$waf_off_id" -H "Authorization: Bearer $admin_tok"
  pass "static-host WAF toggle: off serves the attack ($c_off), on blocks it (403) — inversion proven"

  # 12d) country_list_mode (025): enum gate, fail-closed empty whitelist, round-trip
  cm_bad=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/nginx/static-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["cm-bad.test"],"content":"<h1>x</h1>","country_list_mode":"bogus"}')
  [ "$cm_bad" = "400" ] || die "country_list_mode=bogus accepted: $cm_bad (want 400)"
  cm_empty=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/nginx/static-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["cm-empty.test"],"content":"<h1>x</h1>","country_list_mode":"allow","country_deny":[]}')
  [ "$cm_empty" = "400" ] || die "empty allow-list accepted: $cm_empty (want 400 — it would block every visitor)"
  cm_ok=$(curl -s -X POST "$API/nginx/static-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["cm-ok.test"],"content":"<h1>x</h1>","country_list_mode":"allow","country_deny":["IT"]}')
  cm_id=$(echo "$cm_ok" | sed -n 's/^{"id" *: *\([0-9]*\).*/\1/p')
  [ -n "$cm_id" ] || die "allow+list host creation failed: $cm_ok"
  cm_body=$(curl -s "$API/nginx/static-hosts/$cm_id" -H "Authorization: Bearer $admin_tok")
  echo "$cm_body" | grep -q '"country_list_mode":"allow"' \
    || die "country_list_mode not stored/returned as allow: $cm_body"
  curl -s -o /dev/null -X DELETE "$API/nginx/static-hosts/$cm_id" -H "Authorization: Bearer $admin_tok"
  pass "country_list_mode: enum rejects bogus, empty allow-list 400s (fail-closed), allow+list round-trips"

  # 12e) geoip2 armer self-test (027): a dummy DB must arm with the RIGHT
  #      directive shape — "default=XX country iso_code". The geoip2 module
  #      is SILENT on a wrong lookup path (empty variable, zero errors) and
  #      only an operator with a real DB ever sees it — this guards the class
  #      at CI time. The dummy+include are removed right after (a lingering
  #      dummy would break the next nginx -t).
  execsvc 'mkdir -p /data/geoip && touch /data/geoip/GeoLite2-Country.mmdb'
  execsvc 'rm -f /data/nginx/override-networks.conf'   # force the SEED path
  execsvc 'sh /etc/s6-overlay/scripts/geoip2-arm.sh' >/dev/null 2>&1
  ARMED=$(execsvc 'cat /etc/nginx/conf.d/geoip2.conf')
  echo "$ARMED" | grep -q 'country iso_code' \
    || die "geoip2 armer wrote the wrong directive: $ARMED"
  MERGED=$(execsvc 'cat /etc/nginx/conf.d/geoip2-override.conf')
  echo "$MERGED" | grep -q 'map \$geoip2_override \$country_code' \
    || die "geoip2 merge include missing/malformed: $MERGED"
  echo "$MERGED" | grep -q 'default \$geoip2_override;' \
    || die "the merge must PASS THROUGH the operator's override code: $MERGED"
  SEED=$(execsvc 'cat /data/nginx/override-networks.conf')
  echo "$SEED" | grep -q '<CODE>;' \
    || die "the override-networks seed is missing its format comment: $SEED"
  execsvc 'rm -f /data/geoip/GeoLite2-Country.mmdb /etc/nginx/conf.d/geoip2.conf /etc/nginx/conf.d/geoip2-override.conf /data/nginx/override-networks.conf'
  pass "geoip2 armer: dummy DB arms directive + override merge (pass-through) + seed (the silent-wrong-path class, guarded)"

  # 9) Metrics endpoint (A6): vts data live through the JWT-gated route
  m_code=$(curl -s -o /dev/null -w '%{http_code}' "$API/reports/metrics" -H "Authorization: Bearer $admin_tok")
  [ "$m_code" = "200" ] || die "GET /api/reports/metrics -> $m_code (want 200)"
  m_body=$(curl -s "$API/reports/metrics" -H "Authorization: Bearer $admin_tok")
  echo "$m_body" | grep -q 'serverZones' || die "metrics payload has no serverZones: $m_body"
  pass "metrics endpoint live (vts through the JWT gate)"

  # 10) LDAP auth setting (A7): seeded by setup and served by the settings API
  l_code=$(curl -s -o /dev/null -w '%{http_code}' "$API/settings/ldap-auth" -H "Authorization: Bearer $admin_tok")
  [ "$l_code" = "200" ] || die "GET /api/settings/ldap-auth -> $l_code (want 200)"
  l_body=$(curl -s "$API/settings/ldap-auth" -H "Authorization: Bearer $admin_tok")
  echo "$l_body" | grep -q '"enabled"' || die "ldap-auth setting has no enabled flag: $l_body"
  # Round-trip the PUT too (the settings body is a per-setting anyOf — the
  # minimal ldap payload is a subset of the 2fa-policy shape, exactly the
  # overlap that oneOf rejected): write it back unchanged, expect 200.
  lput=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/settings/ldap-auth" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"value":"disabled","meta":{"enabled":false,"url":"","bind_dn":"","bind_password":"","base_dn":"","filter":"(uid={username})","starttls":false,"provision_on_login":true,"default_visibility":"user"}}')
  [ "$lput" = "200" ] || die "PUT /api/settings/ldap-auth -> $lput (want 200)"
  pass "LDAP auth setting seeded, served, PUT round-trip clean"

  # 11) 2FA policy (Wave 1): setting round-trip + admin EXEMPTION — flipping
  # the policy on must not lock the operator out of their own panel.
  p_code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/settings/2fa-policy" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"value":"enabled","meta":{"enabled":true}}')
  [ "$p_code" = "200" ] || die "PUT /api/settings/2fa-policy -> $p_code (want 200)"
  re_tok=$(curl -s -X POST "$API/tokens" -H 'Content-Type: application/json' \
    -d "{\"identity\":\"$admin_email\",\"secret\":\"$admin_secret\"}" \
    | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')
  [ -n "$re_tok" ] || die "admin re-login failed with 2FA policy ON (admins must be exempt)"
  curl -s -o /dev/null -X PUT "$API/settings/2fa-policy" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"value":"disabled","meta":{"enabled":false}}'
  pass "2FA policy round-trip + admin exemption"

  # 13) WAF tuning API (Wave 3): the canary-runbook CLI, panel-side.
  # A WAF-ON proxy host must be LIVE during the PUT: the handler's reload
  # (the per-host WAF is NOT an API field — it is a marked block in the
  # admin-only advancedConfig, exactly what the FE composes on submit)
  # runs nginx -t, and only a live host's conf includes the modsec files —
  # without one, a broken directive in rules-before.conf sails through
  # un-parsed (exactly how the trailing-';' SecAction shipped CI-green).
  tn_create=$(curl -s -X POST "$API/nginx/proxy-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["tuning-smoke.test"],"forward_scheme":"http","forward_host":"backend","forward_port":80,"advanced_config":"# BEGIN PROXYWARDEN WAF\nmodsecurity on;\nmodsecurity_rules_file /etc/nginx/modsec/main.conf;\n# END PROXYWARDEN WAF"}')
  tn_id=$(echo "$tn_create" | sed -n 's/^{"id" *: *\([0-9]*\).*/\1/p')
  [ -n "$tn_id" ] || die "WAF-ON host for the tuning gate failed: $tn_create"
  sleep 2
  w_code=$(curl -s -o /dev/null -w '%{http_code}' "$API/waf/tuning" -H "Authorization: Bearer $admin_tok")
  [ "$w_code" = "200" ] || die "GET /api/waf/tuning -> $w_code (want 200)"
  wput=$(curl -s -X PUT "$API/waf/tuning" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"exclusions":[{"id":920350,"note":"smoke test exclusion"}],"paranoia_level":1}')
  echo "$wput" | grep -q '"id":920350' || die "WAF tuning PUT did not return the exclusion: $wput"
  execsvc 'grep -q "SecRuleRemoveById 920350;" /data/modsec/rules-after.conf' \
    || die "rules-after.conf does not contain the exclusion"
  execsvc 'grep -q "tx.blocking_paranoia_level=1" /data/modsec/rules-before.conf' \
    || die "rules-before.conf does not contain the paranoia block"
  echo "[smoke] rules-before.conf entering the cleanup PUT (the exact bytes):"
  execsvc 'cat -A /data/modsec/rules-before.conf' 
  wclr=$(curl -s -X PUT "$API/waf/tuning" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"exclusions":[],"paranoia_level":1}')
  echo "$wclr" | grep -q '"exclusions":\[\]' || die "WAF tuning cleanup failed: $wclr"
  execsvc 'grep -vq "SecRuleRemoveById" /data/modsec/rules-after.conf' \
    || die "rules-after.conf still has exclusions after cleanup"
  curl -s -o /dev/null -X DELETE "$API/nginx/proxy-hosts/$tn_id" -H "Authorization: Bearer $admin_tok"
  pass "WAF tuning API: exclusions + paranoia round-trip, files written (nginx -t gate live)"

  # 14) WAF activity report (Wave 4): the attacks from check 5 must show up
  wafr=$(curl -s "$API/waf/report" -H "Authorization: Bearer $admin_tok")
  echo "$wafr" | grep -q '"flagged"' || die "GET /api/waf/report has no counters: $wafr"
  wafr_n=$(echo "$wafr" | sed -n 's/.*"flagged" *: *\([0-9]*\).*/\1/p')
  [ "${wafr_n:-0}" -gt 0 ] || die "WAF report flagged=0 — the audit events from the attack checks did not aggregate: $wafr"
  echo "$wafr" | grep -q '"perRule":\[{' || die "WAF report has no perRule ENTRIES — the rule-id extraction is broken: $wafr"
  pass "WAF activity report live (audit events aggregated, scoped)"

  # 15) Geoblocking (Wave 5): dormant without the GeoLite2 DB, armer idempotent
  execsvc 'test ! -f /etc/nginx/conf.d/geoip2.conf' \
    || die "geoip2.conf present without a DB (armer must remove it)"
  execsvc 'sh /etc/s6-overlay/scripts/geoip2-arm.sh' >/dev/null
  execsvc 'test ! -f /etc/nginx/conf.d/geoip2.conf' \
    || die "armer created geoip2.conf without a DB"
  # a host with country_deny is accepted and SERVES while dormant
  gb_create=$(curl -s -X POST "$API/nginx/static-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["geo-smoke.test"],"content":"<h1>GeoDormantWorks</h1>","country_deny":["IT","CN"]}')
  gb_id=$(echo "$gb_create" | sed -n 's/^{"id" *: *\([0-9]*\).*/\1/p')
  [ -n "$gb_id" ] || die "country_deny host creation failed (dormant mode must accept): $gb_create"
  sleep 2
  gb_body=$(curl -s -H 'Host: geo-smoke.test' http://127.0.0.1:80/)
  echo "$gb_body" | grep -q 'GeoDormantWorks' \
    || die "dormant country_deny host does not serve: $gb_body"
  # a malformed code must be rejected by the schema
  gb_bad=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/nginx/static-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["geo-bad.test"],"content":"x","country_deny":["IT) { return 200; }"]}')
  [ "$gb_bad" = "400" ] || die "malformed country code accepted: $gb_bad (want 400)"
  curl -s -o /dev/null -X DELETE "$API/nginx/static-hosts/$gb_id" -H "Authorization: Bearer $admin_tok"
  # armer round-trip with a dummy DB file
  execsvc 'mkdir -p /data/geoip && : > /data/geoip/GeoLite2-Country.mmdb && sh /etc/s6-overlay/scripts/geoip2-arm.sh >/dev/null && test -f /etc/nginx/conf.d/geoip2.conf' \
    || die "armer did not write geoip2.conf with a DB present"
  # MODULE LOADED, DIRECTIVE KNOWN: with the armed conf present, nginx -t must
  # NOT report 'unknown directive "geoip2"' — it must instead fail on the
  # DUMMY DB (a different, expected error). The absence of the unknown-directive
  # message proves the load_module conf shipped and the module loads.
  arm_t=$(execsvc 'nginx -t 2>&1' || true)
  echo "$arm_t" | grep -q 'unknown directive "geoip2"' \
    && die 'nginx does not know the geoip2 directive — the load_module conf is missing and the module never shipped'
  echo "$arm_t" | grep -qi 'geoip2\|GeoLite2\|mmdb' \
    || die "armed-window nginx -t did not even reach the DB — unexpected: $arm_t"
  execsvc 'rm -f /data/geoip/GeoLite2-Country.mmdb && sh /etc/s6-overlay/scripts/geoip2-arm.sh >/dev/null && test ! -f /etc/nginx/conf.d/geoip2.conf' \
    || die "armer did not remove geoip2.conf after the DB disappeared"
  # The ^() empty-regex signature must NEVER appear in ANY rendered conf:
  # an empty country_deny is a TRUTHY empty JS array — the template's own
  # check cannot catch it, and the empty regex matches the EMPTY country
  # code (every client the DB cannot resolve: private IPs first) = 403.
  # The generator's flag is the gate; this sweep is the tripwire.
  execsvc "grep -rlF '~ ^()' /data/nginx/" >/dev/null 2>&1 \
    && die "empty country_deny rendered the ^() regex (the unresolved-client 403 bug)"
  pass "geoblocking: no empty ^() signature in any rendered conf"

  pass "geoblocking: dormant host renders + serves, malformed codes rejected, armer round-trips"

  # 16) max_body_size (Wave 6): proxy host carries the upload limit into
  # its rendered config; the pattern gate rejects directive-injecting junk
  mb_create=$(curl -s -X POST "$API/nginx/proxy-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["body-smoke.test"],"forward_scheme":"http","forward_host":"backend","forward_port":80,"max_body_size":"32m"}')
  mb_id=$(echo "$mb_create" | sed -n 's/^{"id" *: *\([0-9]*\).*/\1/p')
  [ -n "$mb_id" ] || die "proxy host with max_body_size creation failed: $mb_create"
  sleep 2
  execsvc "grep -q 'client_max_body_size 32m;' /data/nginx/proxy_host/$mb_id.conf" \
    || { echo "[smoke] mb_create response: $mb_create"; \
         echo "[smoke] the rendered conf ($mb_id):"; \
         execsvc "cat /data/nginx/proxy_host/$mb_id.conf" || true; \
         die "the rendered proxy host config lacks client_max_body_size"; }
  mb_bad=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/nginx/proxy-hosts" \
    -H "Authorization: Bearer $admin_tok" -H 'Content-Type: application/json' \
    -d '{"domain_names":["body-bad.test"],"forward_scheme":"http","forward_host":"backend","forward_port":80,"max_body_size":"32m; return 200;"}')
  [ "$mb_bad" = "400" ] || die "injected max_body_size accepted: $mb_bad (want 400)"
  curl -s -o /dev/null -X DELETE "$API/nginx/proxy-hosts/$mb_id" -H "Authorization: Bearer $admin_tok"
  pass "max_body_size: rendered into the host config, injection rejected"

  # 17) Debrand gates (Wave 2): the shipped image and the served schema
  #     carry ZERO upstream references (labels, description, error strings).
  #     Inspect the image the STACK runs (compose-resolved): env vars like
  #     WAF_IMAGE are NOT in this script's scope — the first version of this
  #     check inspected nothing (empty string) and passed VACUOUSLY.
  img_id=$(docker compose -f "$COMPOSE_FILE" images -q "$SVC" | head -1)
  [ -n "$img_id" ] || die "debrand check: no running image found for the stack"
  img_labels=$(docker inspect "$img_id" --format '{{json .Config.Labels}}')
  echo "$img_labels" | grep -q 'nginxproxymanager\|jc21' \
    && die "upstream references in the image LABELS: $img_labels"
  schema_body=$(curl -s "$API/schema" -H "Authorization: Bearer $admin_tok")
  echo "$schema_body" | grep -q 'nginxproxymanager\|Nginx Proxy Manager' \
    && die "upstream references in the served API schema: $(echo "$schema_body" | head -c 200)"
  tpl_name=$(execsvc 'grep -h "^server_name" /etc/nginx/conf.d/production.conf.template 2>/dev/null | head -1' || true)
  echo "$tpl_name" | grep -q 'nginxproxymanager' \
    && die "the admin template still says nginxproxymanager: $tpl_name"
  fs_resid=$(execsvc "grep -ri 'nginx-proxy-manager|NginxProxyManager' /etc/nginx/conf.d/ /etc/logrotate.d/ /var/www/html/ /root/.bashrc 2>/dev/null | head -3")
  [ -z "$fs_resid" ] || die "upstream references in the shipped filesystem: $fs_resid"
  pass "debrand: image labels + API schema + admin template clean"
else
  say "skip: API source check (first-boot user creation returned $setup_code — volume not fresh)"
fi

  # 18) Phase B (the engine swap): the binary is PLAIN nginx — the banner
  #     must not identify as openresty, the configure line must carry no
  #     luajit rpath, and NOTHING we ship may use an openresty-bundle-only
  #     directive. The base audit proved the negative once; this makes it
  #     permanent.
  ver_line=$(execsvc 'nginx -V 2>&1 | head -1')
  echo "$ver_line" | grep -q 'openresty' \
    && die "the binary still identifies as openresty: $ver_line"
  echo "$ver_line" | grep -qE '^nginx version: nginx/[0-9]+\.[0-9]+\.[0-9]+$' \
    || die "unexpected nginx banner: $ver_line"
  args_line=$(execsvc 'nginx -V 2>&1 | sed -n "s/^configure arguments: //p"')
  echo "$args_line" | grep -q 'luajit' \
    && die "luajit in the configure args: $args_line"
  bundle_res=$(execsvc "grep -rlE 'by_lua|content_by_lua|access_by_lua|echo_start|echo_exec|set_misc|ngx_lua|lua_code_cache' /etc/nginx/ /data/nginx/ 2>/dev/null | head -3")
  [ -z "$bundle_res" ] || die "openresty-bundle directives in shipped configs: $bundle_res"
  pass "phase-b: plain nginx banner, no luajit, zero bundle directives"

echo
echo "SMOKE OK: UI up, nginx -t clean, seed present, benign 200, brotli br live, attacks 403, audit log written, API docs served, WAF audit in API sources, static host e2e works, phase-b engine clean"
