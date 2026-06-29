from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

TOKEN_RE = re.compile(
    r"https?://\S+"
    r"|10\.\d{4,9}/\S+"
    r"|[A-Za-z]?\d+(?:-\d+)?"
    r"|[A-Za-z]+(?:'[A-Za-z]+)?"
    r"|[^\w\s]",
)


@dataclass(frozen=True)
class Span:
    field: str
    start: int
    end: int


@dataclass(frozen=True)
class Token:
    text: str
    start: int
    end: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert character-span citations to BIO JSONL.")
    parser.add_argument("--input", required=True, help="Path to adjudicated span JSONL")
    parser.add_argument("--labels", required=True, help="Path to labels JSON file")
    parser.add_argument("--output", required=True, help="Output BIO JSONL path")
    return parser.parse_args()


def load_label_set(path: Path) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    labels = payload.get("labels")
    if not isinstance(labels, list) or not all(isinstance(label, str) for label in labels):
        raise ValueError("labels file must include a string array at key 'labels'")
    return set(labels)


def tokenize_with_offsets(text: str) -> list[Token]:
    tokens: list[Token] = []
    for match in TOKEN_RE.finditer(text):
        tokens.append(Token(text=match.group(0), start=match.start(), end=match.end()))
    return tokens


def spans_from_row(row: dict[str, Any], line_number: int) -> list[Span]:
    entities = row.get("entities")
    raw_text = row.get("raw_reference")
    if not isinstance(raw_text, str):
        raise ValueError(f"line {line_number}: raw_reference must be a string")
    if not isinstance(entities, list):
        raise ValueError(f"line {line_number}: entities must be an array")

    spans: list[Span] = []
    for entity in entities:
        if not isinstance(entity, dict):
            raise ValueError(f"line {line_number}: entity must be an object")
        field = entity.get("field")
        start = entity.get("start")
        end = entity.get("end")
        text = entity.get("text")
        if not isinstance(field, str) or not isinstance(start, int) or not isinstance(end, int):
            raise ValueError(f"line {line_number}: each entity must include field/start/end")
        if start < 0 or end <= start or end > len(raw_text):
            raise ValueError(f"line {line_number}: invalid span range for field '{field}'")
        if isinstance(text, str) and text != raw_text[start:end]:
            raise ValueError(f"line {line_number}: entity text mismatch for field '{field}'")
        spans.append(Span(field=field, start=start, end=end))

    spans_sorted = sorted(spans, key=lambda item: (item.start, item.end))
    for prev, cur in zip(spans_sorted, spans_sorted[1:], strict=False):
        if cur.start < prev.end:
            raise ValueError(f"line {line_number}: overlapping spans are not allowed")

    return spans_sorted


def bio_tag_for_token(token: Token, spans: list[Span], prior_field: str | None) -> tuple[str, str | None]:
    for span in spans:
        if token.start >= span.start and token.end <= span.end:
            prefix = "B" if prior_field != span.field else "I"
            return f"{prefix}-{span.field}", span.field
    return "O", None


def convert_row(row: dict[str, Any], line_number: int, label_set: set[str]) -> dict[str, Any]:
    raw_text = row["raw_reference"]
    spans = spans_from_row(row, line_number)
    tokens = tokenize_with_offsets(raw_text)

    bio_tags: list[str] = []
    token_texts: list[str] = []
    current_field: str | None = None

    for token in tokens:
        tag, field = bio_tag_for_token(token, spans, current_field)
        if tag == "O":
            current_field = None
        else:
            current_field = field
        if tag not in label_set:
            raise ValueError(f"line {line_number}: tag '{tag}' missing from labels set")
        token_texts.append(token.text)
        bio_tags.append(tag)

    return {
        "id": row.get("id"),
        "raw_reference": raw_text,
        "reference_type": row.get("reference_type"),
        "source_family": row.get("source_family"),
        "style_family": row.get("style_family"),
        "tokens": token_texts,
        "bio_tags": bio_tags,
        "entity_fields": [span.field for span in spans],
        "entity_starts": [span.start for span in spans],
        "entity_ends": [span.end for span in spans],
        "entity_texts": [raw_text[span.start : span.end] for span in spans],
    }


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    label_set = load_label_set(Path(args.labels))

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with input_path.open(encoding="utf-8") as source, output_path.open("w", encoding="utf-8") as target:
        for line_number, raw_line in enumerate(source, start=1):
            line = raw_line.strip()
            if not line:
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"line {line_number}: expected JSON object")
            converted = convert_row(row, line_number, label_set)
            target.write(json.dumps(converted, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
