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

The same overlay philosophy as repo 1: **no stock file is edited** — the
backend Node app and its API are unmodified; we replace only the built
frontend (`/app/frontend`). The product image therefore inherits every
guarantee of the overlay (module ABI, CRS blocking, smoke-tested boot).

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
`/data/modsec` is seeded, and the WAF still blocks attacks (payload matrix →
403). If someone points `OVERLAY_IMAGE` at a wrong base, this test fails
loudly.

## Frontend fork conventions

- `patches/frontend/*.patch` — numbered unified diffs applied in lexical
  order against the pinned upstream tag inside the image build. F1 ships
  **zero patches**: the pipeline first proves a stock build is byte-clean.
- Never commit upstream source; the pinned tag is cloned at build time.
- See `patches/frontend/README.md` for the patch workflow.

## Roadmap

- **F1** ✅ (this scaffold) — frontend stock build proven, image pipeline
- **F2** — branding: name, logo, Tabler theme, login page
- **F3** — WAF toggle per host (admin panel; writes marked directives into
  `advanced_config`)
- **F4** — audit-log viewer (sidecar API, JWT-verified, admin-only)
- **F5** — hardening, UI smoke for non-admin login, docs, `v1`

Users: NPM native model — admin + users with granular capabilities/visibility
(untouched by this fork, restyled). Multi-tenant is explicitly out of scope.

## License

MIT, with attribution to Nginx Proxy Manager — see `LICENSE`.
