from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("version", help="Staged type bundle version to promote")
    parser.add_argument("--model-root", default=str(Path(__file__).resolve().parents[1] / "models" / "type-model"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model_root = Path(args.model_root)
    source_dir = model_root / "staged" / args.version
    source = source_dir / "type_model.json"
    if not source.exists():
        raise FileNotFoundError(f"Type bundle not found: {source}")

    current_dir = model_root / "current"
    current_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, current_dir / "type_model.json")
    print(current_dir / "type_model.json")


if __name__ == "__main__":
    main()
