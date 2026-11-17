# Frontend patch set

Our fork of the NPM frontend is expressed ONLY as numbered unified diffs
against the pinned upstream tag (`NPM_FRONTEND_REF` in `build/Dockerfile`).
Upstream source is never committed to this repo.

## Rules

1. **Numbered, lexical order**: `001-<topic>.patch`, `002-…` — applied by the
   image build with `git apply --check` first, so a patch that no longer
   fits the pinned tag fails the build LOUDLY instead of shipping a partial
   customization.
2. **Small and marked**: one topic per patch, minimal diff. The smaller the
   set, the cheaper the rebase on every upstream release (the overlay
   philosophy applied to source code).
3. **Stock build is the baseline**: this directory is intentionally EMPTY
   in F1. The pipeline first proves that a zero-patch build reproduces the
   official UI byte-clean from the pinned tag; every patch afterwards is a
   deliberate, reviewable delta on top of that baseline.
4. **Never edit upstream files in place in a patch** when an additive change
   works (new components/files preferred over modified ones).

## Producing a patch

```bash
git clone --depth 1 --branch v2.17.0 \
  https://github.com/NginxProxyManager/nginx-proxy-manager.git work
cd work/frontend
git checkout -b topic
# ...edit...
git add -A && git commit -m "topic"
git format-patch -1 --stdout > ../../patches/frontend/00N-topic.patch
```

Verify locally before pushing: the CI applies the set in lexical order, so
re-run numbering if you insert a patch mid-sequence.
