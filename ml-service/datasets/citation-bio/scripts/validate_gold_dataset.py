from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

DOI_PATTERN = re.compile(r"10\.\d{4,9}/\S+", flags=re.IGNORECASE)
URL_PATTERN = re.compile(r"https?://\S+", flags=re.IGNORECASE)
LOCATOR_BLOCK_PATTERN = re.compile(r"\b\d{4}\s*;\s*\d+\s*(?:\(\d+\))?\s*[:,]\s*[A-Za-z]?\d+(?:-\d+)?\b")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate canonical citation span gold JSONL.")
    parser.add_argument("--input", required=True, help="Input JSONL path")
    parser.add_argument("--labels", default=None, help="Optional labels.v1.json path")
    return parser.parse_args()


def load_labels(path: str | None) -> set[str] | None:
    if path is None:
        return None
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    labels = payload.get("labels")
    if not isinstance(labels, list):
        raise ValueError("labels file must include 'labels' array")
    return {label[2:] for label in labels if isinstance(label, str) and label.startswith(("B-", "I-"))}


def validate_row(
    row: dict[str, Any],
    line_number: int,
    seen_ids: set[str],
    seen_raw: set[str],
    allowed_fields: set[str] | None,
) -> None:
    row_id = row.get("id")
    raw_reference = row.get("raw_reference")
    entities = row.get("entities")

    if not isinstance(row_id, str) or not row_id.strip():
        raise ValueError(f"line {line_number}: id must be a non-empty string")
    if row_id in seen_ids:
        raise ValueError(f"line {line_number}: duplicate id '{row_id}'")
    seen_ids.add(row_id)

    if not isinstance(raw_reference, str) or not raw_reference.strip():
        raise ValueError(f"line {line_number}: raw_reference must be a non-empty string")

    if raw_reference in seen_raw:
        raise ValueError(f"line {line_number}: duplicate raw_reference")
    seen_raw.add(raw_reference)

    if not isinstance(entities, list):
        raise ValueError(f"line {line_number}: entities must be an array")

    span_ranges: list[tuple[int, int, str]] = []
    for entity in entities:
        if not isinstance(entity, dict):
            raise ValueError(f"line {line_number}: entity must be an object")
        field = entity.get("field")
        start = entity.get("start")
        end = entity.get("end")
        text = entity.get("text")

        if not isinstance(field, str) or not isinstance(start, int) or not isinstance(end, int):
            raise ValueError(f"line {line_number}: entity missing field/start/end")
        if allowed_fields is not None and field not in allowed_fields:
            raise ValueError(f"line {line_number}: field '{field}' not present in label set")
        if start < 0 or end <= start or end > len(raw_reference):
            raise ValueError(f"line {line_number}: invalid range for field '{field}'")
        exact_text = raw_reference[start:end]
        if isinstance(text, str) and text != exact_text:
            raise ValueError(f"line {line_number}: text mismatch for field '{field}'")
        if DOI_PATTERN.search(exact_text) and field == "title":
            raise ValueError(f"line {line_number}: title span contains DOI")
        if URL_PATTERN.search(exact_text) and field == "title":
            raise ValueError(f"line {line_number}: title span contains URL")
        if LOCATOR_BLOCK_PATTERN.search(exact_text) and field == "title":
            raise ValueError(f"line {line_number}: title span contains locator block")
        if field == "journalTitle" and re.search(r"\b\d+(?:-\d+)?\b", exact_text):
            raise ValueError(f"line {line_number}: journalTitle appears contaminated with locator numbers")
        span_ranges.append((start, end, field))

    span_ranges.sort(key=lambda item: (item[0], item[1]))
    for (prev_start, prev_end, _), (start, _, field) in zip(span_ranges, span_ranges[1:], strict=False):
        if start < prev_end:
            raise ValueError(
                f"line {line_number}: overlapping spans between {prev_start}:{prev_end} and {start} for field '{field}'"
            )


def main() -> None:
    args = parse_args()
    allowed_fields = load_labels(args.labels)

    seen_ids: set[str] = set()
    seen_raw: set[str] = set()

    input_path = Path(args.input)
    with input_path.open(encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"line {line_number}: expected JSON object")
            validate_row(row, line_number, seen_ids, seen_raw, allowed_fields)

    print(
        json.dumps(
            {
                "ok": True,
                "rows": len(seen_ids),
                "path": str(input_path),
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
