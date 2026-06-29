from __future__ import annotations

import json
from pathlib import Path
from typing import Any, TypedDict

from app.dataset_paths import resolve_training_jsonl_path


TruthScalar = str | int | float | bool | None
TruthFieldValue = TruthScalar | list[TruthScalar]


class TrainingRow(TypedDict, total=False):
    raw_text: str
    expected_fields: dict[str, TruthFieldValue]
    expected_type: str | None
    expected_style: str | None
    dataset_split: str | None
    trust_level: str | None
    row_status: str | None
    input_hash: str | None
    provenance: str | None
    pipeline_major: int | None


def _normalize_string(value: str) -> str:
    return " ".join(value.strip().split())


def _normalize_scalar(value: TruthScalar) -> TruthScalar:
    if isinstance(value, str):
        return _normalize_string(value)
    return value


def _normalize_author_like(value: dict[str, Any]) -> str | None:
    literal = value.get("literal")
    if isinstance(literal, str) and literal.strip():
        return _normalize_string(literal)

    family = value.get("family")
    given = value.get("given")
    family_text = _normalize_string(family) if isinstance(family, str) else ""
    given_text = _normalize_string(given) if isinstance(given, str) else ""
    if family_text and given_text:
        return f"{family_text}, {given_text}"
    if family_text:
        return family_text
    if given_text:
        return given_text

    return None


def normalize_truth_field_value(field_name: str, value: Any) -> TruthFieldValue:
    if value is None or isinstance(value, (str, int, float, bool)):
        return _normalize_scalar(value)

    if isinstance(value, list):
        normalized: list[TruthScalar] = []
        for item in value:
            nested = normalize_truth_field_value(field_name, item)
            if isinstance(nested, list):
                raise ValueError(
                    f"expected_fields.{field_name} cannot contain nested arrays"
                )
            normalized.append(nested)
        return normalized

    if isinstance(value, dict):
        if "value" in value:
            return normalize_truth_field_value(field_name, value["value"])

        author = _normalize_author_like(value)
        if author is not None:
            return author

    raise ValueError(
        f"expected_fields.{field_name} must stay flat in training export v1"
    )


def normalize_truth_fields(fields: dict[str, Any]) -> dict[str, TruthFieldValue]:
    return {
        key: normalize_truth_field_value(key, value)
        for key, value in fields.items()
    }


def validate_training_row(raw: dict[str, Any], line_number: int) -> TrainingRow:
    raw_text = raw.get("raw_text")
    if not isinstance(raw_text, str) or not raw_text.strip():
        raise ValueError(f"line {line_number}: raw_text must be a non-empty string")

    expected_fields_raw = raw.get("expected_fields")
    if not isinstance(expected_fields_raw, dict):
        raise ValueError(f"line {line_number}: expected_fields must be an object")

    row: TrainingRow = {
        "raw_text": _normalize_string(raw_text),
        "expected_fields": normalize_truth_fields(expected_fields_raw),
    }

    for key in (
        "expected_type",
        "expected_style",
        "dataset_split",
        "trust_level",
        "row_status",
        "input_hash",
        "provenance",
    ):
        value = raw.get(key)
        if value is None:
            row[key] = None
        elif isinstance(value, str):
            row[key] = _normalize_string(value)
        else:
            raise ValueError(f"line {line_number}: {key} must be a string or null")

    pipeline_major = raw.get("pipeline_major")
    if pipeline_major is None:
        row["pipeline_major"] = None
    elif isinstance(pipeline_major, int):
        row["pipeline_major"] = pipeline_major
    else:
        raise ValueError(f"line {line_number}: pipeline_major must be an integer or null")

    return row


def is_primary_training_row(row: TrainingRow) -> bool:
    return row.get("row_status") != "quarantined" and row.get("trust_level") != "draft"


def load_training_jsonl(path: str | Path | None = None) -> list[TrainingRow]:
    rows: list[TrainingRow] = []
    with resolve_training_jsonl_path(path).open(encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise ValueError(f"line {line_number}: each JSONL row must be an object")
            rows.append(validate_training_row(payload, line_number))
    return rows
