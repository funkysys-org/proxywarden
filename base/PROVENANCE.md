# docker-nginx-full base vendoring — PROVENANCE

| | |
|---|---|
| Upstream repo | https://github.com/nginxproxymanager/docker-nginx-full |
| Commit | 38654e0738a6c19578e0045678480622e48473878c |
| Vendored | 2026-11-19 (sync: LICENSE e9cb203 + the HTTP/2 security backports d361a16 — CVE-2026-123007, CVE-2026-123633, http2-data-frame-queue) |
| Tree | complete checkout of the commit, minus `.git/` — byte-faithful, ZERO local modifications |
| Build-time security carriage | `docker/patches/`: the upstream h2 backports (part of the commit) + `security-1.31.9-batch.patch` (OUR delta: the verbatim nginx.org 1.31.8→1.31.9 diff, 30 security files, v2/version-bump/CHANGES excluded; applied by `build-openresty.sh` after the h2 patches; superseded by the 1.31.9.x bundle bump) |

## Rules

- NEVER edit this tree in place: deltas ride a build-time patch layer only.
- An upstream sync = replace the tree in ONE reviewable commit (this file's
  Commit row + the workflow `NGINX_FULL_COMMIT` pin move together; the CI
  pins-sync asserts they match).
- The configure-args oracle and the parity gate ride the binary built FROM
  this tree — a sync that changes build inputs (like the security backports)
  must re-run the full pipeline; the args themselves must stay byte-identical
  to the official image's, or the parity gate dies (by design).

## Phase B — the engine fork (2026-11-24, branch phase-b/nginx-base)

The base is OURS now: plain **nginx.org source** (`docker/scripts/build-nginx.sh`,
tarball sha256-pinned per version in the script's case block) — no OpenResty
bundle, no LuaJIT, no lua-resty stack. Zero Lua ever executed in this chain
(audit: no `by_lua` / `resty.` / `openidc` / `cjson` reference in any shipped
config, template or script), and the bundle lag on nginx security releases
cost two manual bridge-patch waves (h2 + security-1.31.9-batch, both
superseded). The Commit row above = the FORK POINT, kept for history: the
tree diverges from it and is no longer re-vendored. The parity gate's tier-1
official-image comparison retired with the reference; the self-oracle
(`parity/our-configure-args.txt`) is the gate. The build-time debrand patch
now covers the certbot/certbot-node images only — this Dockerfile carries
funkysys-org labels from line one. The upstream-sync rules below apply to
the parts that still track upstream (nginx.org itself), NOT to
the base build.

One bundle module SURVIVES, deliberately: **headers-more-nginx-module v0.42**
(clone-pinned in build-nginx.sh and overlay/Dockerfile) — proxywarden-hardening.conf
uses `more_clear_headers Server;` (the full Server-header erase; server_tokens
only trims the version). The 2026-11-24 complete audit (both repos, every
shipped surface) found it is the ONLY bundle directive in the chain. The smoke
tripwire (check 18) sanctions the more_* family and keeps banning lua/echo/set_misc.
