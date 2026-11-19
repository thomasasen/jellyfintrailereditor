#!/usr/bin/env python3
"""Populate the Jellyfin plugin catalog from locally packaged, published ZIPs."""
import datetime
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[1]
assets = pathlib.Path(sys.argv[1])
release = "https://github.com/thomasasen/jellyfintrailereditor/releases/download/v0.1.0"
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
versions = []
for suffix, number, abi in [
    ("10.11", "0.1.0.0", "10.11.0.0"),
    ("12", "0.1.0.12", "12.0.0.0"),
]:
    name = f"JellyfinTrailerEditor_{suffix}.zip"
    data = (assets / name).read_bytes()
    versions.append({
        "version": number,
        "changelog": "Initial release: edit and persist YouTube trailer URLs in Jellyfin Web.",
        "targetAbi": abi,
        "sourceUrl": f"{release}/{name}",
        "checksum": hashlib.md5(data).hexdigest(),
        "timestamp": now,
    })
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
manifest[0]["versions"] = versions
(root / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("Validated release ZIPs and wrote", root / "manifest.json")
