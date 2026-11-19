# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml==6.0.3", "brotli==1.1.0"]
# ///
"""The licence check on what goes into the image ("the image build runs V11 on what it copies").

    uv run scripts/check_release.py release/      # exit 1 on any finding

Every manifest in <dir>/releases must name only objects that exist and match their hash; every object a manifest names
is decoded and scanned with the same V11 test the build runs (no source of a class that may not be shown, no
fund-level field, no vendor block, no long daily/weekly/monthly series). Objects that no
manifest names are not allowed either, so nothing reaches the server by accident.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import brotli

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sitebuild import verify  # noqa: E402


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "release")
    named: dict[str, str] = {}
    for m in sorted((root / "releases").glob("*.json")):
        for path, h in json.loads(m.read_text())["files"].items():
            named.setdefault(h, path)
    bad = []
    files = {}
    for h, path in sorted(named.items()):
        f = root / "objects" / f"{h}.json.br"
        if not f.exists():
            bad.append(f"missing object {h} ({path})")
            continue
        b = brotli.decompress(f.read_bytes())
        if hashlib.sha256(b).hexdigest() != h:
            bad.append(f"hash mismatch {h} ({path})")
        if not path.startswith("registry/"):
            files[f"{path}@{h[:8]}"] = b
    extra = {f.name.split(".")[0] for f in (root / "objects").glob("*.json.br")} - set(named)
    bad += [f"object no release names: {h}" for h in sorted(extra)]
    r = verify.v11_licence(files, [])
    bad += r.details if r.status == "fail" else []
    for b in bad[:40]:
        print(b)
    print(f"{len(named)} objects in {len(list((root / 'releases').glob('*.json')))} releases: {'OK' if not bad else f'{len(bad)} findings'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
