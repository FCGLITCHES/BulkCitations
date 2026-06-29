from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create deduped train/validation/test splits for BIO JSONL.")
    parser.add_argument("--input", required=True, help="Input BIO JSONL path")
    parser.add_argument("--out-dir", required=True, help="Output directory for split files")
    parser.add_argument("--prefix", default="citation_bio_v1", help="Output filename prefix")
    parser.add_argument("--seed", type=int, default=17, help="Random seed")
    parser.add_argument("--train-ratio", type=float, default=0.70)
    parser.add_argument("--validation-ratio", type=float, default=0.15)
    parser.add_argument("--test-ratio", type=float, default=0.15)
    return parser.parse_args()


def normalize_for_dedupe(text: str) -> str:
    lowered = text.lower()
    collapsed_ws = re.sub(r"\s+", " ", lowered).strip()
    collapsed_punct = re.sub(r"([\.,;:!?()\[\]{}\-])\1+", r"\1", collapsed_ws)
    return collapsed_punct


def load_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"line {line_number}: expected JSON object")
            raw_reference = row.get("raw_reference")
            if not isinstance(raw_reference, str) or not raw_reference.strip():
                raise ValueError(f"line {line_number}: raw_reference is required")
            rows.append(row)
    return rows


def assign_split(index: int, total: int, train_ratio: float, validation_ratio: float) -> str:
    if total <= 0:
        return "train"
    boundary_train = int(total * train_ratio)
    boundary_validation = boundary_train + int(total * validation_ratio)
    if index < boundary_train:
        return "train"
    if index < boundary_validation:
        return "validation"
    return "test"


def main() -> None:
    args = parse_args()
    if abs((args.train_ratio + args.validation_ratio + args.test_ratio) - 1.0) > 1e-9:
        raise ValueError("split ratios must add to 1.0")

    input_path = Path(args.input)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = load_rows(input_path)

    dedupe_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        normalized = normalize_for_dedupe(row["raw_reference"])
        key = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        dedupe_groups[key].append(row)

    grouped = list(dedupe_groups.values())
    rng = random.Random(args.seed)
    rng.shuffle(grouped)

    split_rows: dict[str, list[dict[str, Any]]] = {
        "train": [],
        "validation": [],
        "test": [],
    }

    for group_index, group in enumerate(grouped):
        split_name = assign_split(
            group_index,
            len(grouped),
            args.train_ratio,
            args.validation_ratio,
        )
        for row in group:
            projected = dict(row)
            projected["dataset_split"] = split_name
            split_rows[split_name].append(projected)

    split_paths = {
        split_name: out_dir / f"{args.prefix}_{split_name}.jsonl"
        for split_name in split_rows
    }
    for split_name, output_path in split_paths.items():
        with output_path.open("w", encoding="utf-8") as handle:
            for row in split_rows[split_name]:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    metadata = {
        "split_strategy": "deduped-stratified-v1",
        "created_at": str(date.today()),
        "label_set_version": "citation-bio-labels-v1",
        "guideline_version": "annotation-guide-v1",
        "seed": args.seed,
        "rows_total": len(rows),
        "groups_total": len(grouped),
        "split_counts": {key: len(value) for key, value in split_rows.items()},
        "input": str(input_path),
    }
    metadata_path = out_dir / f"{args.prefix}_split_metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8")

    print(json.dumps({"ok": True, "outputs": {k: str(v) for k, v in split_paths.items()}, "metadata": str(metadata_path)}, indent=2))


if __name__ == "__main__":
    main()
