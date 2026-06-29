from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from app.training_dataset import TrainingRow, is_primary_training_row, load_training_jsonl
from app.type_classifier import (
    DEFAULT_TYPE_FEATURE_VERSION,
    SUPPORTED_TYPE_LABELS,
    extract_type_features,
    normalize_type_text,
)

DEFAULT_MODEL_VERSION = "type-gb-local-reviewed-v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("jsonl", help="Path to full gold supervision JSONL")
    parser.add_argument("--model-root", default=str(Path(__file__).resolve().parents[1] / "models" / "type-model"))
    parser.add_argument("--version", default=DEFAULT_MODEL_VERSION)
    parser.add_argument("--feature-version", default=DEFAULT_TYPE_FEATURE_VERSION)
    parser.add_argument("--epochs", type=int, default=700)
    parser.add_argument("--learning-rate", type=float, default=0.2)
    parser.add_argument("--l2", type=float, default=1e-4)
    return parser.parse_args()


def eligible_type_rows(rows: list[TrainingRow]) -> list[TrainingRow]:
    eligible: list[TrainingRow] = []
    for row in rows:
        if not is_primary_training_row(row):
            continue
        expected_type = row.get("expected_type")
        if expected_type in SUPPORTED_TYPE_LABELS:
            eligible.append(row)
    return eligible


def split_type_rows(rows: list[TrainingRow]) -> dict[str, list[TrainingRow]]:
    buckets = {"train": [], "val": [], "test": [], "holdout": []}
    for row in rows:
        split = row.get("dataset_split") or "train"
        if split not in buckets:
            split = "train"
        buckets[split].append(row)
    if not buckets["train"]:
        buckets["train"] = [row for row in rows if row.get("dataset_split") != "holdout"]
    return buckets


def feature_names_for_rows(rows: list[TrainingRow]) -> list[str]:
    names: set[str] = set()
    for row in rows:
        names.update(extract_type_features(normalize_type_text(row["raw_text"])).keys())
    return sorted(names)


def vectorize_rows(rows: list[TrainingRow], feature_names: list[str]) -> tuple[np.ndarray, np.ndarray]:
    X = np.zeros((len(rows), len(feature_names)), dtype=np.float64)
    y = np.zeros((len(rows),), dtype=np.int64)
    label_to_index = {label: index for index, label in enumerate(SUPPORTED_TYPE_LABELS)}
    for row_index, row in enumerate(rows):
        features = extract_type_features(normalize_type_text(row["raw_text"]))
        for feature_index, feature_name in enumerate(feature_names):
            X[row_index, feature_index] = float(features.get(feature_name, 0.0))
        y[row_index] = label_to_index[str(row["expected_type"])]
    return X, y


def train_softmax_bundle(
    rows: list[TrainingRow],
    feature_names: list[str],
    epochs: int,
    learning_rate: float,
    l2: float,
) -> tuple[np.ndarray, np.ndarray]:
    if not rows:
        raise ValueError("No eligible type rows were provided.")

    X, y = vectorize_rows(rows, feature_names)
    class_count = len(SUPPORTED_TYPE_LABELS)
    weights = np.zeros((len(feature_names), class_count), dtype=np.float64)
    bias = np.zeros((class_count,), dtype=np.float64)
    class_counts = Counter(int(label) for label in y.tolist())
    sample_weights = np.array(
        [1.0 / max(class_counts[int(label)], 1) for label in y],
        dtype=np.float64,
    )
    sample_weights *= len(sample_weights) / max(sample_weights.sum(), 1.0)
    y_onehot = np.eye(class_count, dtype=np.float64)[y]

    for _epoch in range(epochs):
        logits = X @ weights + bias
        logits -= logits.max(axis=1, keepdims=True)
        exp_logits = np.exp(logits)
        probs = exp_logits / np.maximum(exp_logits.sum(axis=1, keepdims=True), 1e-12)
        error = (probs - y_onehot) * sample_weights[:, None]
        grad_w = (X.T @ error) / max(sample_weights.sum(), 1.0) + (l2 * weights)
        grad_b = error.sum(axis=0) / max(sample_weights.sum(), 1.0)
        weights -= learning_rate * grad_w
        bias -= learning_rate * grad_b

    return weights, bias


def accuracy_for_rows(
    rows: list[TrainingRow],
    feature_names: list[str],
    weights: np.ndarray,
    bias: np.ndarray,
) -> float:
    if not rows:
        return 0.0
    X, y = vectorize_rows(rows, feature_names)
    predictions = np.argmax(X @ weights + bias, axis=1)
    return float((predictions == y).sum() / len(y))


def confusion_for_rows(
    rows: list[TrainingRow],
    feature_names: list[str],
    weights: np.ndarray,
    bias: np.ndarray,
) -> dict[str, dict[str, int]]:
    if not rows:
        return {}
    X, y = vectorize_rows(rows, feature_names)
    predictions = np.argmax(X @ weights + bias, axis=1)
    labels = list(SUPPORTED_TYPE_LABELS)
    confusion: dict[str, dict[str, int]] = {}
    for expected_index, predicted_index in zip(y.tolist(), predictions.tolist(), strict=True):
        expected = labels[int(expected_index)]
        predicted = labels[int(predicted_index)]
        confusion.setdefault(expected, {})
        confusion[expected][predicted] = confusion[expected].get(predicted, 0) + 1
    return confusion


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_type_dataset_lineage(
    rows: list[TrainingRow],
    eligible_rows: list[TrainingRow],
    splits: dict[str, list[TrainingRow]],
    feature_version: str,
    source_path: Path | None = None,
) -> dict[str, Any]:
    quarantined = sum(1 for row in rows if row.get("row_status") == "quarantined")
    draft = sum(1 for row in rows if row.get("trust_level") == "draft")
    unsupported_or_unlabeled = len(rows) - len(eligible_rows)
    input_hashes = sorted(
        str(row.get("input_hash") or sha256_text(row["raw_text"]))
        for row in eligible_rows
    )
    lineage: dict[str, Any] = {
        "sourceDatasetName": "citation-type-gold",
        "sourceDatasetVersion": "style-gold-supervision-jsonl",
        "sourceDatasetHash": sha256_file(source_path) if source_path else None,
        "rawGoldInputHashesHash": sha256_text("\n".join(input_hashes)),
        "rawGoldInputHashesSample": input_hashes[:25],
        "rawGoldRowsIncluded": True,
        "rawGoldRowsScanned": len(rows),
        "eligibleCertifiedRows": len(eligible_rows),
        "rowsUsedForTraining": len(splits["train"]),
        "trainRows": len(splits["train"]),
        "validationRows": len(splits["val"]),
        "testRows": len(splits["test"]),
        "holdoutRows": len(splits["holdout"]),
        "draftRowsExcluded": draft,
        "quarantinedRowsExcluded": quarantined,
        "unsupportedOrUnlabeledRowsExcluded": unsupported_or_unlabeled,
        "labelSchemaVersion": "reference-type-v1",
        "tokenizationVersion": feature_version,
        "exporterVersion": "type-supervision-export-v1",
        "trainingScriptVersion": "train_type_bundle-v2",
        "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "rawTextCorpusSha256": sha256_text("\n".join(row["raw_text"] for row in eligible_rows)),
    }
    if source_path:
        lineage["datasetSource"] = str(source_path)
    return lineage


def bundle_payload(
    rows: list[TrainingRow],
    version: str,
    feature_version: str,
    epochs: int,
    learning_rate: float,
    l2: float,
    source_path: Path | None = None,
) -> dict[str, Any]:
    eligible_rows = eligible_type_rows(rows)
    if not eligible_rows:
        raise ValueError("No reviewed/gold type rows with supported expected_type labels were found.")

    splits = split_type_rows(eligible_rows)
    dataset_lineage = build_type_dataset_lineage(
        rows,
        eligible_rows,
        splits,
        feature_version=feature_version,
        source_path=source_path,
    )
    feature_names = feature_names_for_rows(eligible_rows)
    weights, bias = train_softmax_bundle(
        splits["train"],
        feature_names,
        epochs=epochs,
        learning_rate=learning_rate,
        l2=l2,
    )

    train_accuracy = accuracy_for_rows(splits["train"], feature_names, weights, bias)
    val_accuracy = accuracy_for_rows(splits["val"], feature_names, weights, bias)
    test_accuracy = accuracy_for_rows(splits["test"], feature_names, weights, bias)

    return {
        "modelVersion": version,
        "featureVersion": feature_version,
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "labels": list(SUPPORTED_TYPE_LABELS),
        "featureNames": feature_names,
        "datasetLineage": dataset_lineage,
        "biases": {
            reference_type: round(float(bias[index]), 6)
            for index, reference_type in enumerate(SUPPORTED_TYPE_LABELS)
        },
        "weights": {
            reference_type: {
                feature_name: round(float(weights[feature_index, type_index]), 6)
                for feature_index, feature_name in enumerate(feature_names)
                if abs(float(weights[feature_index, type_index])) >= 1e-6
            }
            for type_index, reference_type in enumerate(SUPPORTED_TYPE_LABELS)
        },
        "metrics": {
            "train_accuracy": round(train_accuracy, 4),
            "val_accuracy": round(val_accuracy, 4),
            "test_accuracy": round(test_accuracy, 4),
            "test_confusion": confusion_for_rows(splits["test"], feature_names, weights, bias),
        },
        "rowCounts": {
            split: len(split_rows)
            for split, split_rows in splits.items()
        },
        "excludedRows": {
            "unsupported_or_unlabeled": len(rows) - len(eligible_rows),
            "quarantined_or_draft": sum(1 for row in rows if not is_primary_training_row(row)),
        },
    }


def write_type_bundle(payload: dict[str, Any], model_root: Path, version: str) -> Path:
    output_dir = model_root / "staged" / version
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "type_model.json"
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return output_path


def main() -> None:
    args = parse_args()
    rows = load_training_jsonl(args.jsonl)
    payload = bundle_payload(
        rows,
        version=args.version,
        feature_version=args.feature_version,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        l2=args.l2,
        source_path=Path(args.jsonl),
    )
    output_path = write_type_bundle(payload, Path(args.model_root), args.version)
    print(json.dumps({"ok": True, "outputPath": str(output_path), "metrics": payload["metrics"], "rowCounts": payload["rowCounts"]}))


if __name__ == "__main__":
    main()
