"""Quarantine the synthetic bootstrap BIO rows out of the active training track.

The bootstrap rows were a cold-start crutch; they teach the model template
shapes rather than real-world variety. This marks them `row_status: quarantined`
so `load_bio_gold_jsonl` excludes them by default — WITHOUT deleting anything
(reversible via --restore, and via git).

DRY-RUN BY DEFAULT. Pass --apply to actually rewrite the files. Quarantining
zeroes the gold track until real data lands, so this is a deliberate step.

  python tools/quarantine_synthetic_bootstrap.py                 # report only
  python tools/quarantine_synthetic_bootstrap.py --apply         # rewrite rows
  python tools/quarantine_synthetic_bootstrap.py --restore --apply
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))

from app.dataset_paths import engine_v2_citation_bio_root, legacy_citation_bio_root

QUARANTINE_REASON = "synthetic-bootstrap superseded by real-data track (P0)"
SYNTHETIC_FAMILY = "synthetic-bootstrap"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Quarantine synthetic bootstrap BIO rows.")
    parser.add_argument("--apply", action="store_true", help="Write changes (default: dry-run).")
    parser.add_argument("--restore", action="store_true", help="Remove quarantine marks instead of adding them.")
    parser.add_argument("--all-rows", action="store_true",
                        help="Quarantine every row in bootstrap files, not only source_family==synthetic-bootstrap.")
    return parser.parse_args(argv)


def discover_files() -> list[Path]:
    files: list[Path] = []
    for root in {legacy_citation_bio_root(), engine_v2_citation_bio_root()}:
        processed = root / "processed"
        if processed.exists():
            files.extend(sorted(processed.glob("citation_bio_v1_bootstrap_*.jsonl")))
    return files


def is_synthetic(row: dict, force_all: bool) -> bool:
    if force_all:
        return True
    return row.get("source_family") == SYNTHETIC_FAMILY


def process_file(path: Path, *, apply: bool, restore: bool, force_all: bool) -> dict[str, int]:
    lines = path.read_text(encoding="utf-8").splitlines()
    changed = 0
    targeted = 0
    out: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line:
            out.append(raw)
            continue
        row = json.loads(line)
        if is_synthetic(row, force_all):
            targeted += 1
            if restore:
                if row.get("row_status") == "quarantined":
                    row.pop("row_status", None)
                    row.pop("quarantine_reason", None)
                    changed += 1
            else:
                if row.get("row_status") != "quarantined":
                    row["row_status"] = "quarantined"
                    row["quarantine_reason"] = QUARANTINE_REASON
                    changed += 1
        out.append(json.dumps(row, ensure_ascii=False))

    if apply and changed:
        path.write_text("\n".join(out) + "\n", encoding="utf-8")
    return {"rows": len(out), "targeted": targeted, "changed": changed}


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    files = discover_files()
    if not files:
        print("No bootstrap files found.", file=sys.stderr)
        return 1

    action = "RESTORE" if args.restore else "QUARANTINE"
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"\n=== {action} synthetic bootstrap  [{mode}] ===")
    total_changed = 0
    total_targeted = 0
    for path in files:
        stats = process_file(path, apply=args.apply, restore=args.restore, force_all=args.all_rows)
        total_changed += stats["changed"]
        total_targeted += stats["targeted"]
        rel = path.relative_to(ML_SERVICE_ROOT.parent) if ML_SERVICE_ROOT.parent in path.parents else path
        print(f"  {str(rel):<78} rows={stats['rows']:>5} targeted={stats['targeted']:>5} changed={stats['changed']:>5}")

    print(f"\n  files: {len(files)}   targeted rows: {total_targeted}   rows that would change: {total_changed}")
    if not args.apply:
        print("  DRY-RUN — no files written. Re-run with --apply to commit.")
    else:
        print(f"  APPLIED — {total_changed} rows rewritten.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
