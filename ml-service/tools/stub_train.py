"""Validate flat JSONL and report split stats for an external trainer handoff."""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))


def _default_jsonl() -> str:
    return str(ML_SERVICE_ROOT / "training" / "fixture_export.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("jsonl", nargs="?", default=_default_jsonl())
    parser.add_argument("--model-dir", default=os.environ.get("MODEL_DIR") or str(ML_SERVICE_ROOT / "models"))
    args = parser.parse_args()

    from app.training_dataset import load_training_jsonl

    rows = load_training_jsonl(args.jsonl)
    split_counts = Counter((row.get("dataset_split") or "unspecified") for row in rows)
    trust_counts = Counter((row.get("trust_level") or "unspecified") for row in rows)

    print(f"Validated JSONL: {args.jsonl}")
    print(f"Total rows: {len(rows)}")
    print("Dataset splits:")
    for split, count in sorted(split_counts.items()):
        print(f"  {split}: {count}")
    print("Trust levels:")
    for trust, count in sorted(trust_counts.items()):
        print(f"  {trust}: {count}")
    print(
        "External trainer hook: train outside this repo, export ONNX, then copy the model "
        f"bundle into {args.model_dir} before running eval_jsonl.py."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
