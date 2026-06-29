"""Promote a staged ONNX bundle into promoted/ and current/."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))


def _model_root() -> Path:
    return Path(os.environ.get("MODEL_DIR") or (ML_SERVICE_ROOT / "models"))


def _copy_bundle(src: Path, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("version", help="Model version directory name under staged/")
    parser.add_argument("--model-root", default=str(_model_root()))
    args = parser.parse_args()

    from app.bundle_validation import validate_bundle_dir

    model_root = Path(args.model_root)
    staged_dir = model_root / "staged" / args.version
    promoted_dir = model_root / "promoted" / args.version
    current_dir = model_root / "current"

    validation = validate_bundle_dir(staged_dir)
    if not validation["valid"]:
        print(json.dumps(validation, indent=2, sort_keys=True))
        return 1

    promoted_dir.parent.mkdir(parents=True, exist_ok=True)
    current_dir.parent.mkdir(parents=True, exist_ok=True)

    _copy_bundle(staged_dir, promoted_dir)
    _copy_bundle(promoted_dir, current_dir)

    print(
        json.dumps(
            {
                "promoted": True,
                "version": args.version,
                "stagedDir": str(staged_dir),
                "promotedDir": str(promoted_dir),
                "currentDir": str(current_dir),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
