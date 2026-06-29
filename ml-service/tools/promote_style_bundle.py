from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("version", help="Staged style bundle version to promote")
    parser.add_argument("--model-root", default=str(Path(__file__).resolve().parents[1] / "models" / "style-model"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model_root = Path(args.model_root)
    source_dir = model_root / "staged" / args.version
    source = source_dir / "style_model.json"
    if not source.exists():
        raise FileNotFoundError(f"Style bundle not found: {source}")

    current_dir = model_root / "current"
    current_dir.mkdir(parents=True, exist_ok=True)
    for filename in (
        "style_model.json",
        "thresholds.json",
        "decision_policy.json",
        "reason_codes.json",
    ):
        candidate = source_dir / filename
        if not candidate.exists():
            continue
        shutil.copy2(candidate, current_dir / filename)
    print(current_dir / "style_model.json")


if __name__ == "__main__":
    main()
