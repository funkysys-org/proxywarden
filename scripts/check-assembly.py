#!/usr/bin/env python3
"""Assembly whitelist gate — the 024/025 lesson, enforced.

The WAF image assembles /app as the stock app plus PER-FILE COPYs of the
patch-touched files (overlay/Dockerfile's whitelist zone). A patch that adds
a NEW backend file, or touches one for the first time, is INVISIBLE to that
list unless the wave extends it in the same commit — the failure mode is a
perfectly green build whose image silently lacks the file (the 024: a new
module never shipped; the 025: a migration never ran, the column never
existed, the backend died at the first create citing it).

This gate compares every backend file touched by every overlay patch with
the Dockerfile's COPY list and fails the build naming the gaps. Directory
COPYs cover their subtree (recursive, not just the immediate parent).

The frontend is exempt by construction: the product builds the whole
vendored FE tree (no per-file list), so the class cannot occur there.

Run from the repo root:  python3 scripts/check-assembly.py
"""

import fnmatch
import glob
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCKERFILE = os.path.join(REPO, "overlay", "Dockerfile")
PATCHES = sorted(glob.glob(os.path.join(REPO, "overlay", "patches", "*.patch")))


def collect_copies():
    """Every source path COPY'd from the builder stage, split files/dirs."""
    files, dirs = set(), set()
    for line in open(DOCKERFILE, encoding="utf-8"):
        m = re.match(r"^\s*COPY --from=builder /npm-virgin/(\S+)", line)
        if not m:
            continue
        src = m.group(1)
        # Only the backend tree participates: the touched-files side has no
        # "backend/" prefix, so strip it (and skip non-backend COPYs).
        if not src.startswith("backend/"):
            continue
        src = src[len("backend/"):]
        if src.endswith("/"):
            dirs.add(src.rstrip("/"))
        else:
            files.add(src)
    return files, dirs


def is_covered(path, files, dirs):
    if path in files:
        return True
    if any(path.startswith(d + "/") for d in dirs):
        return True
    # COPY sources may carry shell globs (lib/access/static_hosts-*.json)
    if any(fnmatch.fnmatch(path, pat) for pat in files if "*" in pat):
        return True
    return False


def touched_backend_files(patch_path):
    text = open(patch_path, encoding="utf-8").read()
    return [m.group(1) for m in re.finditer(r"^diff --git a/backend/(\S+) b/backend/", text, re.M)]


def main():
    files, dirs = collect_copies()
    if not files and not dirs:
        sys.exit("assembly gate: no COPY --from=builder lines found in overlay/Dockerfile — is this the right Dockerfile?")

    missing = []
    for p in PATCHES:
        name = os.path.basename(p)
        for f in touched_backend_files(p):
            if is_covered(f, files, dirs):
                continue
            if f.startswith("test/"):
                continue  # tests run in the builder stage; /app is runtime-only
            missing.append((name, f))

    if missing:
        for patch, f in missing:
            print(f"ASSEMBLY WHITELIST GAP: backend/{f} (touched by {patch})")
        print(
            "\nThe file(s) above are patched but NOT in overlay/Dockerfile's COPY list —"
            "\nthey would silently not ship in the image. Extend the whitelist in the SAME"
            "\ncommit that touches them (the 024/025 lesson)."
        )
        sys.exit(1)

    print(f"assembly gate OK: {len(PATCHES)} patches, every touched backend file ships")


if __name__ == "__main__":
    main()
