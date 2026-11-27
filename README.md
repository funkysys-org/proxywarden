# proxywarden

Proxywarden: a custom-branded, WAF-first reverse-proxy manager — the
nginx-proxy-manager backend and our own frontend, hardened, on a **plain
nginx** core.

One repo, one pipeline, one engine. The chain lived in two repos on an
OpenResty base until 2026-11-24 — see [History](#history).

## Architecture — one repo, one pipeline

`​.github/workflows/build.yml` is the single pipeline; `main` publishes.

```
base/      THE ENGINE — plain nginx.org source (Phase B):
             scripts/build-nginx.sh downloads the tarball and verifies it
             against the sha256 case block (per-version, fail-closed —
             the case block IS the base provenance);
             geoip2 + headers-more as dynamic modules (the ONLY non-stock
             modules we ship besides the WAF set);
             the certbot/acmesh chain rides on it (docker-bake.hcl).
           base/PROVENANCE.md = the fork point of the vendored
             jc21 docker-nginx-full tree (the openresty bundle retired
             2026-11-24 — nothing in this chain ever executed Lua).

app/       OUR SOURCE, ABSORBED (D1) — app/backend = the former
           vendor/npm with the BE patch stack 001-029 dissolved into
           it; app/frontend = the former vendor/npm-frontend with the
           FE stack 001-028. The origin of record: ABSORPTION.md. A
           feature is a COMMIT here now, not a patch against a
           foreign base; the patch files live in git history.

overlay/   THE WAF LAYER — libmodsecurity + connector + OWASP CRS +
           vts + cache-purge + brotli + headers-more, compiled as
           dynamic modules against the base binary (the configure args
           are captured from the binary; the ABI guard asserts the
           banner against the pin), loaded by the build-time printf
           chain — the build dies if any module fails to load.

build/     THE PRODUCT — OUR frontend (app/frontend) built on the
           LOCAL WAF stage (:waf-build — never published; the
           two-repo same-tag race is dead by construction) + rootfs/
           (the hardening: the Server header erased, nosniff, the
           modsec and vts confs).

SMOKES     scripts/waf-smoke.sh — the 18-check WAF suite: the attack
           payload matrix → 403, the CRS audit evidence, the tuning
           round-trip, the geoblocking (dormant + armed + the ^()
           tripwire), the static hosts e2e, the debrand gates, and the
           Phase B engine tripwire (a plain nginx banner, no luajit,
           zero bundle directives in anything we ship).
           scripts/smoke-ui.sh — the layering gate: our frontend, the
           API alive, the module loads at a real boot, the seed, the
           hardening, the access control.
           scripts/parity-check.sh — the self-oracle: the built binary's
           configure args must match parity/our-configure-args.txt
           byte-for-byte (a reviewed commit moves it; nothing ships
           until then).

WATCHDOG   nginx-1.31.10-watch (cron): nginx.org/download monitored
           hourly. A new release = an alert with the evidence and the
           procedure — never an auto-bump (pins are a human decision).
```

## Pins — the single source is the workflow env

| Pin | Value | Governed files |
|---|---|---|
| `NGINX_VERSION` | `1.31.10` | base bake `--var`; the banner asserted by the overlay args stage + the parity gate |
| `NPM_VERSION` | `2.17.0` | `app/Dockerfile` ARG; the version identity (the origin sha: ABSORPTION.md) |
| WAF modules | modsec 3.0.17, connector 1.0.4, CRS v4.30.0, vts v0.2.7, purge 3.0.4, brotli v1.2.1 (+module sha) | `overlay/Dockerfile` ARGs |

Invariants enforced by the `pins-sync` job: the frontend version must
equal the backend version (a frontend never ships against a different
backend), every pin must equal its governed file, and every vendored
PROVENANCE sha must equal the workflow pin.

## Build & test

CI builds and smokes the whole chain in one run; `main` publishes.
The local product build (for poking at it):

```bash
docker build -f build/Dockerfile \
  --build-arg NPM_FRONTEND_REF=v2.17.0 \
  --build-arg OVERLAY_IMAGE=<a local WAF image> \
  -t proxywarden:local .
```

## Test before deploy

```bash
PROXYWARDEN_IMAGE=proxywarden:<tag> docker compose -f docker-compose.test.yml up -d
bash scripts/smoke-ui.sh
docker compose -f docker-compose.test.yml down -v
```

The smoke verifies the layering, not just the UI: our frontend is the
one served, the API is alive (it retries — the backend boots after
nginx), the module loads at a real boot (`nginx -t`), `/data/modsec` is
seeded, the WAF still blocks the payload matrix, the hardening is
active (no `Server` header, `nosniff`), and a non-admin login is denied
the WAF audit source server-side.

## Deploy

The repo ships the production stack: `docker-compose.yml` + `env.example`.

```bash
cp env.example .env          # pin the exact image tag — never a floating :latest
docker login ghcr.io          # PAT with read:packages (the registry is private)
docker compose pull           # fails here = prod untouched
docker compose up -d
```

Rollback = point the `.env` pin at the previous tag (or the previous
digest) and `up -d`. Keep the last-known-good tag written down.

## Bumping nginx

The watchdog alerts; the operator decides. The full procedure, in one
line each:

1. add the new version + its captured sha256 to the case block in
   `base/scripts/build-nginx.sh` (the sha from the nginx.org download);
2. `NGINX_VERSION` in the workflow env;
3. ONE run — the configure args are version-independent, so the parity
   oracle does not change (the gate asserts the banner against the pin);
4. the product fe-tag publishes with the new version; deploy, verify.

## History

November 2026, three phases in one day:

- **Phase B** (2026-11-24): the OpenResty bundle retired. Nothing in
  this chain ever executed a line of Lua (audited across every shipped
  config, template and script); the bundle lag on nginx security
  releases had cost two manual bridge-patch waves. The base became
  plain nginx.org source with a sha256-pinned provenance.
- **Phase C** (2026-11-24): `nginx-full` merged into this repo. The
  two-repo split was an artifact of the openresty era (a vendored
  upstream to track + a parity reference); every cross-cutting fix had
  cost two repos and two CI runs. One repo, one pipeline.
- **The bump precedent** (same day): nginx 1.31.10 — a security release
  shipped by nginx.org the day before, caught by the watchdog nine
  hours after its first tick, deployed as one commit.

The archived repos: `npm-modsec` (the pre-A2b WAF overlay era) and
`nginx-full` (the base+app+WAF era) — `nginx-full`'s last `main` is the
frozen rollback reference.
