# ABSORPTION.md — the origin of record

**Event**: D1, branch `detach-v1` (see the commit "the absorption").

**What happened**: the vendored upstream trees and the numbered patch
stacks were dissolved into first-class source. From this point on the
backend and the frontend are OURS — a feature is a commit, not a patch
against a foreign base, and no upstream release can break our build.

## The absorbed material

| Absorbed tree | Origin | Upstream sha | Divergence carried |
|---|---|---|---|
| `app/backend` | `vendor/npm/` (nginx-proxy-manager **v2.17.0**) | `5c8aec9bdeca0a2fb6a71e060ec598aa6eddd186` | BE patches **001→029** (the WAF API, static hosts, metrics, the audit parser v3, the log viewer, geoblocking, LDAP, debrand, the cert/model fixes, the geoip2 gate/territory) |
| `app/frontend` | `vendor/npm-frontend/` (frontend of the same tag) | same lineage | FE patches **001→028** (static hosts UI, metrics, the WAF/country modals, the custom-cert Update, the vertical sidebar + lucide, the Dashboard absorption of /metrics, the cert triage) |

The patch files themselves are **archived in git history** (removed from
the tree in this branch) — `git log --follow` on any of them documents
the full divergence era.

## What the origin still means

- **Legal**: the absorbed code retains its upstream license
  (`app/backend/LICENSE`, the upstream README kept alongside).
- **Security**: the upstream's advisories remain relevant to the
  absorbed dependency tree (express/knex/body-parser class) — a
  watchdog watches their releases; their fixes are now MANUAL
  cherry-picks, evaluated deliberately. The nginx engine is and always
  was OURS (nginx.org built from source) — their bundled-nginx CVEs
  were never our concern.
- **Pins**: `NPM_VERSION` survives as the version identity (it composes
  the image tag). The origin sha above is the provenance of record;
  there is no re-vendor ritual anymore.

## The health of the source is a CI concern now

`scripts/backend-lint.py` (schema $ref integrity + permission schemas)
runs at CI time before any build — the successor of the gates that
used to live in the overlay Dockerfile when "patched" was a build-time
state.
