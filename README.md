# proxywarden

Custom-branded Nginx Proxy Manager with a first-class WAF: the **NPM backend
with our WAF-audit patch** (from nginx-full, Phase A4), with **our own
frontend build** (branding + WAF panels), on top of the **validated WAF
overlay image from funkysys-org/nginx-full** (libmodsecurity v3 +
connector + OWASP CRS).

## Architecture — two repos, layered

```
repo 1  nginx-full (funkysys-org: base + app + WAF — the merged A2b stack)
          vendored openresty (parity-gated vs the official build) + node + certbot
            → :certbot-node-or1.31.8.1-node26                        (base)
          vendored NPM source @ v2.17.0 (backend + frontend + rootfs + s6)
            → :2.17.0-or1.31.8.1                                      (app)
          libmodsecurity + CRS + vts + purge layer
            → ghcr.io/funkysys-org/nginx-full:2.17.0-or1.31.8.1-modsec3.0.17-crs4.30.0-vts0.2.7-purge3.0.4   (WAF overlay,
              backend carries our WAF-audit patch from overlay/patches/)

repo 2  proxywarden (this repo)
          vendored frontend (vendor/npm-frontend/, PROVENANCE-gated)
            + our frontend patch set → pure-frontend product on the WAF image
            → ghcr.io/funkysys-org/proxywarden:<overlay-tag>-fe<npm-tag>
```

The same overlay philosophy as repo 1, applied to the VENDORED tree: no
build-time clone of jc21's repo anywhere in the chain. Our numbered frontend
patches (`patches/frontend/`) are applied at build time on the vendored
source and only the built `dist/` overlays the image. Backend deltas are
repo 1's jurisdiction (`overlay/patches/`) — this repo never touches backend
files. No stock file is edited at runtime.

## Pins

| Pin | Value | Where |
|---|---|---|
| `OVERLAY_IMAGE` | `ghcr.io/funkysys-org/nginx-full:2.17.0-or1.31.8.1-modsec3.0.17-crs4.30.0-vts0.2.7-purge3.0.4` (pass `--build-arg` to use a local tag) | `build/Dockerfile` ARG + workflow env |
| `NPM_FRONTEND_REF` | `v2.17.0` | `build/Dockerfile` ARG + workflow env |
| `NPM_COMMIT` | `5c8aec9bdeca0a2fb6a71e060ec598aa6eddd186` | workflow env ↔ `vendor/npm-frontend/PROVENANCE.md` |

Invariants enforced by CI (`pins-sync` job):
- `NPM_FRONTEND_REF` must equal the `ARG` in `build/Dockerfile` (no drift
  between files — a wasted build is caught in seconds);
- `NPM_COMMIT` must equal the vendored tree's `PROVENANCE.md` sha — the
  vendored source IS the build input, so the pin and the tree can never
  drift apart silently;
- the frontend tag MUST match the NPM version inside the overlay image tag
  (`fe2.17.0` ↔ overlay `2.17.0-…`) — a frontend built against a different
  backend version never ships;
- `OVERLAY_IMAGE` must not contain the `REPLACE-ME` placeholder.

## Build (local — overlay image already built locally, see repo 1)

```bash
docker build -f build/Dockerfile \
  --build-arg OVERLAY_IMAGE=ghcr.io/funkysys-org/nginx-full:2.17.0-or1.31.8.1-modsec3.0.17-crs4.30.0-vts0.2.7-purge3.0.4 \
  -t proxywarden:2.17.0-or1.31.8.1-modsec3.0.17-crs4.30.0-vts0.2.7-purge3.0.4-fe2.17.0 .
```

CI builds `FROM` the published overlay image instead and pushes
`ghcr.io/funkysys-org/proxywarden:<tag>` + `:latest`.

## Test before deploy

```bash
PROXYWARDEN_IMAGE=proxywarden:2.17.0-or1.31.8.1-modsec3.0.17-crs4.30.0-vts0.2.7-purge3.0.4-fe2.17.0 \
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

## Deploy

The repo ships the production stack: `docker-compose.yml` + `env.example`.

```bash
cp env.example .env          # pins the exact image tag — never a floating :latest
docker login ghcr.io          # PAT with read:packages (the registry is private)
docker compose pull           # fails here = prod untouched
docker compose up -d
```

- First boot on fresh volumes: the **setup page** on `:81` (create the
  admin). The mandatory mounts are already wired (`/data` +
  `/etc/letsencrypt` — the stock prepare service hard-fails without them).
- The WAF ships **dormant**: enable per host from the UI (Options →
  WAF DetectionOnly → watch Logs → WAF Audit → then WAF Block).
- An update is one deliberate line: edit the tag in `.env`, then
  `docker compose pull && docker compose up -d`.
- The compose exposes the admin UI on `:81`; to bind it local instead see
  the comment in `docker-compose.yml` (`127.0.0.1:81:81` + SSH tunnel).

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
  `frontend/003-waf-log-viewer` — the backend half moved to nginx-full
  `overlay/patches/` in Phase A4) — WAF Audit as a 4th source in the native
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
