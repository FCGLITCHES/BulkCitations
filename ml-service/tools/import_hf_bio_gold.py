from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))

from app.bio_training_dataset import (
    BIO_CORE_ALIASES,
    compute_input_hash,
    derive_expected_fields_from_bio,
    detokenize_tokens,
    normalize_bio_tags,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, help="Hugging Face dataset id (namespace/name)")
    parser.add_argument("--config", default=None, help="Dataset config/subset")
    parser.add_argument("--split", default="train", help="Dataset split")
    parser.add_argument("--token-column", default="tokens", help="Token array column name")
    parser.add_argument("--label-column", default="ner_tags", help="BIO/NER label column name")
    parser.add_argument(
        "--text-column",
        default=None,
        help="Optional raw text column name. If omitted, text is reconstructed from tokens.",
    )
    parser.add_argument(
        "--label-map",
        default=None,
        help="Optional JSON file mapping source label aliases to canonical field cores.",
    )
    parser.add_argument(
        "--unknown-label-policy",
        choices=("error", "drop"),
        default="error",
        help="error=fail on unknown labels; drop=convert unknown labels to O",
    )
    parser.add_argument(
        "--max-rows",
        type=int,
        default=0,
        help="Limit rows imported (0 means all rows)",
    )
    parser.add_argument(
        "--trust-level",
        default="gold",
        choices=("draft", "reviewed", "gold"),
        help="Trust level for generated rows",
    )
    parser.add_argument(
        "--pipeline-major",
        type=int,
        default=1,
        help="Pipeline major marker stored in each row",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output NDJSON path. Defaults to ml-service/training/gold-datasets/<dataset>.<config>.<split>.bio.jsonl",
    )
    return parser.parse_args()


def load_label_alias_map(path: str | None) -> dict[str, str]:
    mapping = dict(BIO_CORE_ALIASES)
    if path is None:
        return mapping

    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("label-map JSON must be an object")

    for key, value in payload.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError("label-map entries must be string:string")
        mapping[key.strip().lower()] = value.strip().lower()

    return mapping


def derive_default_output_path(dataset: str, config: str | None, split: str) -> Path:
    safe_dataset = dataset.replace("/", "__")
    safe_config = config.replace("/", "__") if isinstance(config, str) and config.strip() else "default"
    return (
        Path(__file__).resolve().parents[1]
        / "training"
        / "gold-datasets"
        / f"{safe_dataset}.{safe_config}.{split}.bio.jsonl"
    )


def _resolve_label_name(raw_label: Any, label_names: list[str] | None) -> str:
    if isinstance(raw_label, str):
        return raw_label
    if isinstance(raw_label, int):
        if not label_names:
            raise ValueError(
                "label column contains integer IDs but split features do not expose ClassLabel names; "
                "pass a dataset with typed labels or convert label IDs to strings first."
            )
        if raw_label < 0 or raw_label >= len(label_names):
            raise ValueError(f"label id {raw_label} is out of range for ClassLabel size {len(label_names)}")
        return label_names[raw_label]
    raise ValueError(f"Unsupported label type: {type(raw_label).__name__}")


def import_dataset(args: argparse.Namespace) -> dict[str, Any]:
    from datasets import Sequence, load_dataset
    from datasets.features import ClassLabel

    alias_map = load_label_alias_map(args.label_map)

    dataset = load_dataset(args.dataset, args.config, split=args.split)
    if args.max_rows > 0:
        dataset = dataset.select(range(min(args.max_rows, len(dataset))))

    label_names: list[str] | None = None
    label_feature = dataset.features.get(args.label_column)
    if isinstance(label_feature, Sequence) and isinstance(label_feature.feature, ClassLabel):
        label_names = list(label_feature.feature.names)

    output_path = Path(args.output) if args.output else derive_default_output_path(
        args.dataset,
        args.config,
        args.split,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    dropped = 0
    with output_path.open("w", encoding="utf-8") as handle:
        for index, row in enumerate(dataset):
            tokens = row.get(args.token_column)
            if not isinstance(tokens, list) or not tokens or not all(isinstance(token, str) for token in tokens):
                dropped += 1
                continue

            raw_labels = row.get(args.label_column)
            if not isinstance(raw_labels, list) or len(raw_labels) != len(tokens):
                dropped += 1
                continue

            label_names_for_row = [
                _resolve_label_name(raw_label, label_names)
                for raw_label in raw_labels
            ]
            bio_tags = normalize_bio_tags(
                label_names_for_row,
                alias_map=alias_map,  # type: ignore[arg-type]
                unknown_policy=args.unknown_label_policy,
            )
            expected_fields = derive_expected_fields_from_bio(tokens, bio_tags)

            raw_text = row.get(args.text_column) if args.text_column else None
            if not isinstance(raw_text, str) or not raw_text.strip():
                raw_text = detokenize_tokens(tokens)

            payload = {
                "raw_text": raw_text,
                "bio_tokens": tokens,
                "bio_tags": bio_tags,
                "expected_fields": expected_fields,
                "expected_type": None,
                "expected_style": None,
                "dataset_split": args.split,
                "trust_level": args.trust_level,
                "input_hash": compute_input_hash(raw_text),
                "provenance": f"hf://{args.dataset}/{args.config or 'default'}/{args.split}",
                "pipeline_major": args.pipeline_major,
                "task": "field",
                "truth_scope": "core",
                "source_dataset": args.dataset,
                "source_config": args.config,
                "source_split": args.split,
                "source_row_id": row.get("id") if isinstance(row.get("id"), (str, int)) else index,
            }
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
            written += 1

    return {
        "ok": True,
        "dataset": args.dataset,
        "config": args.config,
        "split": args.split,
        "rows_written": written,
        "rows_dropped": dropped,
        "output_path": str(output_path),
    }


def main() -> None:
    args = parse_args()
    result = import_dataset(args)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
