#!/usr/bin/env python3
"""
Backend source lint — the D1 successor of the overlay-Dockerfile gates.

The absorption (branch detach-v1) made app/backend OUR source: no patch
layers, no assembly whitelist. What remains load-bearing for the
backend's health is checked here, at CI time, before anything cooks:

  1. Schema $ref integrity: the backend compiles every schema at BOOT
     (getCompiledSchema) — a relative $ref pointing at a missing
     component crash-loops the image. Walk them all here instead.

  2. Permission schemas: access.can("x:y") loads lib/access/x-y.json at
     REQUEST time — a missing file 500s every call that needs it. Every
     statically-used permission string in the source must resolve.

Run from the repo root:  python3 scripts/backend-lint.py
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "app", "backend", "backend")
ROOT = os.path.abspath(ROOT)

if not os.path.isdir(ROOT):
    print(f"FATAL: backend source not found at {ROOT}")
    sys.exit(2)

missing = []
for f in glob.glob(os.path.join(ROOT, "schema", "**", "*.json"), recursive=True):
    try:
        d = json.load(open(f))
    except Exception as e:
        missing.append(("INVALID JSON: " + str(e), f))
        continue
    stack = [d]
    while stack:
        o = stack.pop()
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "$ref" and isinstance(v, str) and v.startswith("."):
                    target = os.path.normpath(
                        os.path.join(os.path.dirname(f), v.split("#")[0])
                    )
                    if not os.path.isfile(target):
                        missing.append((v, f))
                else:
                    stack.append(v)
        elif isinstance(o, list):
            stack.extend(o)

perm_missing = []
for f in (
    glob.glob(os.path.join(ROOT, "internal", "**", "*.js"), recursive=True)
    + glob.glob(os.path.join(ROOT, "routes", "**", "*.js"), recursive=True)
):
    text = open(f, encoding="utf-8").read()
    for m in re.finditer(r"\.can\(\s*[\"']([a-z0-9_-]+:[a-z0-9_-]+)[\"']", text):
        perm = m.group(1)
        schema = os.path.join(ROOT, "lib", "access", perm.replace(":", "-") + ".json")
        if not os.path.isfile(schema):
            perm_missing.append((perm, f))

for ref, src in missing:
    print(f"MISSING $ref: {ref}  (from {src})")
for perm, src in perm_missing:
    print(f"MISSING permission schema: {perm}  (used in {src})")

if missing or perm_missing:
    sys.exit(1)

print(f"backend lint OK: schema $refs and permission schemas all resolve "
      f"under {os.path.relpath(ROOT)}")
