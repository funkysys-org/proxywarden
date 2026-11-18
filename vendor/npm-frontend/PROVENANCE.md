# NPM frontend source vendoring — PROVENANCE

| | |
|---|---|
| Upstream repo | https://github.com/NginxProxyManager/nginx-proxy-manager |
| Tag | v2.17.0 |
| Commit | 5c8aec9bdeca0a2fb6a71e060ec598aa6eddd186 |
| Vendored | 2026-11-18 (Phase A4) |
| Tree | the `frontend/` subtree of the pinned tag checkout — byte-faithful, ZERO local modifications |

## Rules

- This tree is the patch base for `patches/frontend/` (git-format patches
  applied at build time by `build/Dockerfile`, validated with
  `git apply --check` run FROM THE DIRECTORY CONTAINING `frontend/`).
- NEVER commit local modifications here — our deltas live only as patch
  files.
- Backend deltas live in funkysys-org/nginx-full (`overlay/patches/`)
  since Phase A4 — this repo is pure frontend.
- Upstream sync = the same human ritual as nginx-full's `vendor/npm/`:
  diff the new tag into this tree in one reviewable commit, bump
  `NPM_COMMIT` here and in the workflow env, re-validate the patch set
  from this dir.

## CI invariant

`pins-sync` asserts `NPM_COMMIT` (workflow env) == the `Commit` row above.
