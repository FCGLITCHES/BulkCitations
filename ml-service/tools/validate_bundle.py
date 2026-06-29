"""Validate an ONNX bundle directory before promotion."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))


def _default_bundle_dir() -> str:
    return os.environ.get("MODEL_DIR") or str(ML_SERVICE_ROOT / "models" / "current")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle_dir", nargs="?", default=_default_bundle_dir())
    args = parser.parse_args()

    from app.bundle_validation import validate_bundle_dir

    result = validate_bundle_dir(args.bundle_dir)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
