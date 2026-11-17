# proxywarden

Custom-branded Nginx Proxy Manager with a first-class WAF: the **official NPM
backend, untouched**, with **our own frontend build** (branding + WAF panels),
on top of the **validated npm-modsec overlay image** (libmodsecurity v3 +
connector + OWASP CRS).

## Architecture — two repos, layered

```
repo 1  npm-modsec (exists, validated)
          jc21/nginx-proxy-manager:2.17.0
            → npm-modsec:2.17.0-modsec3.0.17-crs4.30.0      (WAF overlay)

repo 2  proxywarden (this repo)
          npm-modsec image + frontend fork at v2.17.0
            → ghcr.io/funkysys-org/proxywarden:<overlay-tag>-fe<npm-tag>
```

The same overlay philosophy as repo 1, now applied to both trees: the
upstream tag is cloned at build time, our numbered patches are applied
(frontend: `patches/frontend/`, backend: `patches/backend/`), and only the
patched artifacts overlay the image — `/app/frontend`, plus the specific
backend files the backend patch set touches (equivalent to upstream's own
`COPY backend /app`). No stock file is edited at runtime.

## Pins

| Pin | Value | Where |
|---|---|---|
| `OVERLAY_IMAGE` | `npm-modsec:2.17.0-modsec3.0.17-crs4.30.0` (local tag; CI uses the GHCR path) | `build/Dockerfile` ARG + workflow env |
| `NPM_FRONTEND_REF` | `v2.17.0` | `build/Dockerfile` ARG + workflow env |

Invariants enforced by CI (`pins-sync` job):
- `NPM_FRONTEND_REF` must equal the `ARG` in `build/Dockerfile` (no drift
  between files — a wasted build is caught in seconds);
- the frontend tag MUST match the NPM version inside the overlay image tag
  (`fe2.17.0` ↔ overlay `2.17.0-…`) — a frontend built against a different
  backend version never ships;
- `OVERLAY_IMAGE` must not contain the `REPLACE-ME` placeholder.

## Build (local — overlay image already built locally, see repo 1)

```bash
docker build -f build/Dockerfile \
  --build-arg OVERLAY_IMAGE=npm-modsec:2.17.0-modsec3.0.17-crs4.30.0 \
  -t proxywarden:2.17.0-modsec3.0.17-crs4.30.0-fe2.17.0 .
```

CI builds `FROM` the published overlay image instead and pushes
`ghcr.io/funkysys-org/proxywarden:<tag>` + `:latest`.

## Test before deploy

```bash
PROXYWARDEN_IMAGE=proxywarden:2.17.0-modsec3.0.17-crs4.30.0-fe2.17.0 \
  docker compose -f docker-compose.test.yml up -d
bash scripts/smoke-ui.sh
docker compose -f docker-compose.test.yml down -v
```

The smoke verifies the layering, not just the UI: our frontend is the one
served, the API is alive, the module still loads (`nginx -t` at a real boot),
`/data/modsec` is seeded, the WAF still blocks attacks (payload matrix →
403), the global hardening is active (no `Server` header, `nosniff` on the
UI), and a non-admin login is denied the WAF audit source server-side.
If someone points `OVERLAY_IMAGE` at a wrong base, this test fails loudly.

## Global hardening (image-level)

`rootfs/etc/nginx/conf.d/proxywarden-hardening.conf` is baked into the image
and picked up by the stock `include /etc/nginx/conf.d/*.conf;` — no stock
file is modified; per-server config can still override.

Defaults applied at http level:
- TLS: `TLSv1.2 TLSv1.3` only, strong ECDHE suite,
  `ssl_prefer_server_ciphers off`, shared session cache, tickets off
- Slow-client resistance: header/body timeouts 10s, send 15s,
  `large_client_header_buffers 4 16k`
- Headers: `Server` cleared entirely (stock already sets `server_tokens off`),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`
- `proxy_hide_header X-Powered-By` on proxied responses
- Connection guard: `limit_conn` 256 per client IP (generous; tune per host
  if you ever hit it behind a huge NAT)

Deliberately NOT baked in: request rate limiting (`limit_req`) — it can
throttle real users invisibly. The recipe: `limit_req_zone` in
`/data/nginx/custom/http_top.conf` + per-host `limit_req` in the Advanced
tab; per-host visibility to tune it comes from the vts module (repo 1).

Node-runtime note: the base image's Node must stay above the current
security fix line (Broccoli2Shell / CVE-2026-111497 was fixed in Node
26.12.1; the pinned base ships 26.13.1) — verified at every NPM pin bump.

## Frontend fork conventions

- `patches/frontend/*.patch` — numbered unified diffs applied in lexical
  order against the pinned upstream tag inside the image build. F1 ships
  **zero patches**: the pipeline first proves a stock build is byte-clean.
- Never commit upstream source; the pinned tag is cloned at build time.
- See `patches/frontend/README.md` for the patch workflow.

## Roadmap

- **F1** ✅ — frontend stock build proven, image pipeline
- **F2** ✅ (branch `f2-branding`, patch `001-branding.patch`) — branding:
  name, shield mark, horizontal brand, login/setup pages, teal accent,
  product name across all 25 locales; smoke marker flipped with it
- **F3** ✅ (patch `002-waf-toggle.patch`) — WAF toggle per host: two admin
  switches in the proxy host Options section (DetectionOnly / Block),
  mutually exclusive, persisted as a marked `# BEGIN/END PROXYWARDEN WAF`
  block in `advanced_config`; hand-written directives are recognized and
  rewritten safely (never duplicated)
- **F4** ✅ (branch `f4-audit-viewer`, patches `backend/001-waf-log-source` +
  `frontend/003-waf-log-viewer`) — WAF Audit as a 4th source in the native
  `/logs` viewer: the log-viewer gains a `waf` source that parses
  `modsec_audit.log` JSON lines into readable text (`time ip "METHOD uri"
  host=… -> code INTERRUPTED rules [...]`), riding the existing `logs:list`
  access and UI (tail/search/download). No new service, no new auth surface.
- **F5** ✅ (branch `f5-hardening`) — hardening: image-level global nginx
  defaults (`rootfs/etc/nginx/conf.d/proxywarden-hardening.conf`), brand
  favicon set, non-admin access-control smoke, docs

Users: NPM native model — admin + users with granular capabilities/visibility
(untouched by this fork, restyled). Multi-tenant is explicitly out of scope.

## License

MIT, with attribution to Nginx Proxy Manager — see `LICENSE`.
