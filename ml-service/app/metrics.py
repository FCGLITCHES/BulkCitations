from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.training_dataset import (
    TruthFieldValue,
    normalize_truth_field_value,
    normalize_truth_fields,
)


def _normalize_for_compare(field_name: str, value: Any) -> TruthFieldValue:
    return normalize_truth_field_value(field_name, value)


def compare_field_values(field_name: str, expected: Any, predicted: Any) -> bool:
    return _normalize_for_compare(field_name, expected) == _normalize_for_compare(
        field_name, predicted
    )


def summarize_predictions(
    expected_rows: list[dict[str, Any]], predicted_rows: list[dict[str, Any]]
) -> dict[str, Any]:
    by_field: dict[str, dict[str, int]] = defaultdict(
        lambda: {"matched": 0, "compared": 0}
    )
    exact_rows = 0

    for expected_row, predicted_row in zip(expected_rows, predicted_rows, strict=False):
        expected_fields = normalize_truth_fields(
            expected_row.get("expected_fields", {}) or {}
        )
        predicted_fields = normalize_truth_fields(predicted_row.get("fields", {}) or {})

        row_exact = True
        for field_name, expected_value in expected_fields.items():
            by_field[field_name]["compared"] += 1
            if field_name in predicted_fields and compare_field_values(
                field_name, expected_value, predicted_fields[field_name]
            ):
                by_field[field_name]["matched"] += 1
                continue
            row_exact = False

        if row_exact and expected_fields:
            exact_rows += 1

    total_rows = len(expected_rows)
    per_field = {
        field_name: {
            **counts,
            "exact_rate": round(
                counts["matched"] / counts["compared"], 4
            )
            if counts["compared"]
            else 0.0,
        }
        for field_name, counts in sorted(by_field.items())
    }

    total_compared = sum(counts["compared"] for counts in by_field.values())
    total_matched = sum(counts["matched"] for counts in by_field.values())

    return {
        "rows": total_rows,
        "exact_rows": exact_rows,
        "row_exact_rate": round(exact_rows / total_rows, 4) if total_rows else 0.0,
        "total_compared_fields": total_compared,
        "total_matched_fields": total_matched,
        "field_exact_rate": round(total_matched / total_compared, 4)
        if total_compared
        else 0.0,
        "per_field": per_field,
    }
