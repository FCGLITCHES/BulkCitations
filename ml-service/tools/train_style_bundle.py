from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from app.style_classifier import (
    DEFAULT_STYLE_PROFILE_THRESHOLDS,
    DEFAULT_STYLE_REASON_CODES,
    DEFAULT_STYLE_THRESHOLDS,
    STYLE_FAMILY_BY_STYLE,
    STYLE_LABELS,
    SUPPORTED_EXACT_STYLES,
    extract_style_features,
    normalize_style_text,
)
from app.training_dataset import TrainingRow, is_primary_training_row, load_training_jsonl

SUPPORTED_STYLE_LABELS = tuple(label for label in STYLE_LABELS if label != "unknown")
DEFAULT_MODEL_VERSION = "style-gb-local-reviewed-v1"
DEFAULT_FEATURE_VERSION = "style-features-v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("jsonl", help="Path to style gold JSONL")
    parser.add_argument("--model-root", default=str(Path(__file__).resolve().parents[1] / "models" / "style-model"))
    parser.add_argument("--version", default=DEFAULT_MODEL_VERSION)
    parser.add_argument("--feature-version", default=DEFAULT_FEATURE_VERSION)
    parser.add_argument("--epochs", type=int, default=600)
    parser.add_argument("--learning-rate", type=float, default=0.25)
    parser.add_argument("--l2", type=float, default=1e-4)
    return parser.parse_args()


def eligible_style_rows(rows: list[TrainingRow]) -> list[TrainingRow]:
    eligible: list[TrainingRow] = []
    for row in rows:
        if not is_primary_training_row(row):
            continue
        expected_style = row.get("expected_style")
        if expected_style in SUPPORTED_STYLE_LABELS:
            eligible.append(row)
    return eligible


def split_style_rows(rows: list[TrainingRow]) -> dict[str, list[TrainingRow]]:
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
        features = extract_style_features(normalize_style_text(row["raw_text"]))
        names.update(features.keys())
    return sorted(names)


def vectorize_rows(rows: list[TrainingRow], feature_names: list[str]) -> tuple[np.ndarray, np.ndarray]:
    X = np.zeros((len(rows), len(feature_names)), dtype=np.float64)
    y = np.zeros((len(rows),), dtype=np.int64)
    label_to_index = {label: index for index, label in enumerate(SUPPORTED_STYLE_LABELS)}
    for row_index, row in enumerate(rows):
        features = extract_style_features(normalize_style_text(row["raw_text"]))
        for feature_index, feature_name in enumerate(feature_names):
            X[row_index, feature_index] = float(features.get(feature_name, 0.0))
        y[row_index] = label_to_index[str(row["expected_style"])]
    return X, y


def train_softmax_bundle(
    rows: list[TrainingRow],
    feature_names: list[str],
    epochs: int,
    learning_rate: float,
    l2: float,
) -> tuple[np.ndarray, np.ndarray]:
    if not rows:
        raise ValueError("No eligible style rows were provided.")

    X, y = vectorize_rows(rows, feature_names)
    class_count = len(SUPPORTED_STYLE_LABELS)
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
    logits = X @ weights + bias
    predictions = np.argmax(logits, axis=1)
    return float((predictions == y).sum() / len(y))


def bundle_payload(
    rows: list[TrainingRow],
    version: str,
    feature_version: str,
    epochs: int,
    learning_rate: float,
    l2: float,
) -> dict[str, Any]:
    eligible_rows = eligible_style_rows(rows)
    if not eligible_rows:
        raise ValueError("No reviewed/gold style rows with supported expected_style labels were found.")

    splits = split_style_rows(eligible_rows)
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
        "labels": list(SUPPORTED_STYLE_LABELS),
        "featureNames": feature_names,
        "biases": {
            style: round(float(bias[index]), 6)
            for index, style in enumerate(SUPPORTED_STYLE_LABELS)
        },
        "weights": {
            style: {
                feature_name: round(float(weights[feature_index, style_index]), 6)
                for feature_index, feature_name in enumerate(feature_names)
                if abs(float(weights[feature_index, style_index])) >= 1e-6
            }
            for style_index, style in enumerate(SUPPORTED_STYLE_LABELS)
        },
        "metrics": {
            "train_accuracy": round(train_accuracy, 4),
            "val_accuracy": round(val_accuracy, 4),
            "test_accuracy": round(test_accuracy, 4),
        },
        "rowCounts": {
            split: len(split_rows)
            for split, split_rows in splits.items()
        },
    }


def write_style_bundle(payload: dict[str, Any], model_root: Path, version: str) -> Path:
    output_dir = model_root / "staged" / version
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "style_model.json"
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    thresholds_path = output_dir / "thresholds.json"
    thresholds_path.write_text(
        json.dumps(
            {
                "thresholdSetVersion": "policy-1",
                "global": dict(DEFAULT_STYLE_THRESHOLDS),
                "profileThresholds": {
                    profile: dict(values)
                    for profile, values in DEFAULT_STYLE_PROFILE_THRESHOLDS.items()
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    decision_policy_path = output_dir / "decision_policy.json"
    decision_policy_path.write_text(
        json.dumps(
            {
                "thresholdSetVersion": "policy-1",
                "supportedExactStyles": sorted(SUPPORTED_EXACT_STYLES),
                "knownUnsupportedExactStyles": [
                    "ama",
                    "acs",
                    "chicago-author-date",
                ],
                "familyByStyle": dict(STYLE_FAMILY_BY_STYLE),
                "operatingMode": "shadow",
                "requireCalibrationForPrimary": True,
                "abstainOnMissingPrimaryCalibration": True,
                "calibration": {
                    "available": False,
                    "source": None,
                    "notes": "Set available=true with calibration artifact before primary promotion.",
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    reason_codes_path = output_dir / "reason_codes.json"
    reason_codes_path.write_text(
        json.dumps(dict(DEFAULT_STYLE_REASON_CODES), indent=2) + "\n",
        encoding="utf-8",
    )
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
    )
    output_path = write_style_bundle(payload, Path(args.model_root), args.version)
    print(
        json.dumps(
            {
                "ok": True,
                "outputPath": str(output_path),
                "modelVersion": payload["modelVersion"],
                "featureVersion": payload["featureVersion"],
                "metrics": payload["metrics"],
                "rowCounts": payload["rowCounts"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
