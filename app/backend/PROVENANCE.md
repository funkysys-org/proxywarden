# NPM source vendoring — PROVENANCE

| | |
|---|---|
| Upstream repo | https://github.com/NginxProxyManager/nginx-proxy-manager |
| Tag | v2.17.0 |
| Commit | 5c8aec9bdeca0a2fb6a71e060ec598aa6eddd186 |
| Vendored | 2026-11-18 (Phase A4) |
| Tree | complete checkout of the tag, minus `.git/` — byte-faithful, ZERO local modifications |

## Rules

- This tree is the reference for `app/Dockerfile` (the stock app image) and
  for the backend patch layer in `overlay/patches/` (git-format patches,
  applied at build time, validated with `git apply --check` run FROM THIS
  DIRECTORY — the patch paths start at `backend/`).
- NEVER commit local modifications here. Our deltas live ONLY as patch files
  in `overlay/patches/` (frontend deltas stay in proxywarden).
- Upstream sync is a HUMAN ritual, cued by the drift-check: clone the new
  tag, diff it against this tree, replace the tree in one reviewable commit,
  bump `NPM_VERSION` + `NPM_COMMIT` (workflow env + this table), re-validate
  the patch set from this dir, rebuild.

## CI invariant

`pins-sync` asserts `NPM_COMMIT` (workflow env) == the `Commit` row above.
