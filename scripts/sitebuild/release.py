"""The release store: content-addressed site files and one manifest per release.

    $MONEY_FLOW_DATA_ROOT/site/objects/<sha256>.json.br   every data file, by the sha256 of its JSON
    $MONEY_FLOW_DATA_ROOT/site/releases/<tag>.json         method version, code hash, vintages, checks, path -> sha256
    $MONEY_FLOW_DATA_ROOT/site/releases/latest             the newest tag

A file is serialised with sorted keys and compact separators, so the same content always has the same hash (V9). A
release is cut only when some file changed; its tag is the KST date and a counter, like the deploy tags (20261029.1).
Releases are never deleted: the app serves any of them by ?r=<tag>.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path

import brotli

SITE = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data")) / "site"
KST = dt.timezone(dt.timedelta(hours=9))


def dumps(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False,
                      default=lambda o: o.isoformat()).encode("utf-8")      # dates in the registries


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def put(b: bytes, root: Path = SITE) -> str:
    h = sha(b)
    p = root / "objects" / f"{h}.json.br"
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_bytes(brotli.compress(b, quality=9))
        tmp.rename(p)
    return h


def get(h: str, root: Path = SITE) -> bytes:
    """The JSON of a stored object by its hash."""
    return brotli.decompress((root / "objects" / f"{h}.json.br").read_bytes())


def latest(root: Path = SITE) -> dict | None:
    f = root / "releases" / "latest"
    if not f.exists():
        return None
    return json.loads((root / "releases" / f"{f.read_text().strip()}.json").read_text())


def all_releases(root: Path = SITE) -> list[dict]:
    out = []
    for p in sorted((root / "releases").glob("*.json")):
        m = json.loads(p.read_text())
        out.append({k: m[k] for k in ("tag", "date", "built", "method", "code", "changed", "checks") if k in m})
    return out


def next_tag(now: dt.datetime, root: Path = SITE) -> str:
    day = now.astimezone(KST).strftime("%Y%m%d")
    n = 1 + max([int(p.stem.split(".")[1]) for p in (root / "releases").glob(f"{day}.*.json")] or [0])
    return f"{day}.{n}"


VOLATILE = ("checks", "surface")                                 # files that differ at every build without a data change: they cut no release alone


def surface(tag: str, built: str, method: str) -> dict:
    """The export surface manifest (the surface contract, surface 1.0): what a reader of the store may read, under which
    release and method. Written to <store>/surface.json at every release and stored as release file `surface`."""
    return {"surface": "1.0", "release": tag, "method": method, "built": built,
            "files": ["world/global", "econ/*", "mkt/*", "earn/global", "changes/global", "episodes/global", "sovereign/global", "registry/*", "checks", "meta"]}


def write_surface(s: dict, root: Path = SITE) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    p = root / "surface.json"
    p.write_text(json.dumps(s, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return p


def cut(files: dict[str, bytes], meta: dict, root: Path = SITE, force: bool = False, now: dt.datetime | None = None) -> tuple[dict, bool]:
    """When anything changed (or force), store the files and a new release manifest. Returns (manifest, is_new). An
    unchanged build stores nothing, so the store holds no object that no release names (check_release.py). `now` fixes
    the tag and the built time (the surface file inside the release names the same tag)."""
    hashes = {path: sha(b) for path, b in files.items()}
    prev = latest(root)
    same = lambda a, b: {k: v for k, v in a.items() if k not in VOLATILE} == {k: v for k, v in b.items() if k not in VOLATILE}
    if prev and same(prev["files"], hashes) and not force:          # the checks and the surface alone cut no release
        return prev, False
    for _, b in sorted(files.items()):
        put(b, root)
    now = now or dt.datetime.now(KST)
    tag = next_tag(now, root)
    changed = sorted(p for p in hashes if not prev or prev["files"].get(p) != hashes[p]) + sorted(p for p in (prev or {}).get("files", {}) if p not in hashes)
    m = {"tag": tag, "date": now.date().isoformat(), "built": now.isoformat(timespec="seconds"), "previous": prev["tag"] if prev else None,
         "changed": changed, "files": hashes, **meta}
    d = root / "releases"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{tag}.json").write_text(json.dumps(m, indent=1, sort_keys=True), encoding="utf-8")
    (d / "latest").write_text(tag + "\n", encoding="utf-8")
    return m, True
