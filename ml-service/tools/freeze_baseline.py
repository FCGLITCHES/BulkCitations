"""Freeze the current model bundle as an immutable baseline.

The baseline is the bar every future BIO model must beat on the held-out eval
set. Freezing is a non-destructive copy plus a manifest capturing the source,
file hashes, and the metrics the bundle claimed at freeze time.

  python tools/freeze_baseline.py                       # -> models/baseline/baseline-v1
  python tools/freeze_baseline.py --version baseline-v2 --force
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Freeze the current model bundle as a baseline.")
    parser.add_argument("--source", default=str(ML_SERVICE_ROOT / "models" / "current"))
    parser.add_argument("--version", default="baseline-v1")
    parser.add_argument("--dest-root", default=str(ML_SERVICE_ROOT / "models" / "baseline"))
    parser.add_argument("--force", action="store_true", help="Overwrite an existing baseline of the same version.")
    return parser.parse_args(argv)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    source = Path(args.source).resolve()
    dest = Path(args.dest_root).resolve() / args.version

    if not source.exists():
        print(f"Source bundle not found: {source}", file=sys.stderr)
        return 1
    if dest.exists():
        if not args.force:
            print(f"Baseline already exists: {dest} (use --force to overwrite)", file=sys.stderr)
            return 1
        shutil.rmtree(dest)

    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, dest)

    files = {
        path.name: {"bytes": path.stat().st_size, "sha256": sha256_file(path)}
        for path in sorted(dest.iterdir())
        if path.is_file()
    }

    source_metrics: dict = {}
    metadata_path = dest / "metadata.json"
    if metadata_path.exists():
        try:
            meta = json.loads(metadata_path.read_text(encoding="utf-8"))
            source_metrics = meta.get("metrics") or meta.get("evaluation") or {}
        except json.JSONDecodeError:
            source_metrics = {}

    manifest = {
        "version": args.version,
        "frozen_at": datetime.now(timezone.utc).isoformat(),
        "source": str(source),
        "files": files,
        "claimed_metrics": source_metrics,
        "note": "Immutable baseline. Beat this on the held-out eval set before promoting any model.",
    }
    (dest / "baseline_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print(f"Froze baseline '{args.version}'")
    print(f"  source: {source}")
    print(f"  dest:   {dest}")
    print(f"  files:  {len(files)}")
    if source_metrics:
        print(f"  claimed metrics captured: {', '.join(sorted(source_metrics)[:8])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
