"""Evaluate flat JSONL gold data against the local ONNX extractor path."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))


def _resolve_default_model_dir() -> str:
    return str(ML_SERVICE_ROOT / "models")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("jsonl", help="Path to NDJSON export")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--model-dir", default=os.environ.get("MODEL_DIR") or _resolve_default_model_dir())
    args = parser.parse_args()

    os.environ["MODEL_DIR"] = args.model_dir

    from app.main import _build_extract_result, _load_extractor_runtime
    from app.bundle_validation import validate_bundle_dir
    from app.metrics import summarize_predictions
    from app.training_dataset import load_training_jsonl

    rows = load_training_jsonl(args.jsonl)[: args.limit]
    if not rows:
        print("No rows in JSONL; exit 0")
        return 0

    runtime = _load_extractor_runtime(require_onnx=True)
    if runtime.get("backend") != "onnx" or not runtime.get("artifactsReady"):
        print(
            f"No ONNX extractor found in {args.model_dir}; skipping evaluation.",
            file=sys.stderr,
        )
        return 0

    active_model_dir = runtime.get("modelDir") or args.model_dir
    validation = validate_bundle_dir(active_model_dir)
    if not validation["valid"]:
        print(
            json.dumps(
                {
                    "model_dir": active_model_dir,
                    "errors": validation["errors"],
                    "warnings": validation["warnings"],
                },
                indent=2,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1

    predictions: list[dict[str, object]] = []
    for row in rows:
        result = _build_extract_result(
            row["raw_text"],
            row.get("expected_style") or "unknown",
            runtime,
            require_onnx=True,
        )
        predictions.append({"fields": result.fields})

    summary = summarize_predictions(rows, predictions)
    print(
        json.dumps(
            {
                "model_dir": active_model_dir,
                "model_version": runtime.get("activeModelVersion"),
                "feature_version": runtime.get("featureVersion"),
                **summary,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
