from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict

from app.dataset_paths import resolve_bio_gold_jsonl_path
from app.preprocessing import DEFAULT_PREPROCESSING_SPEC, normalize_inference_text

CanonicalBioCore = Literal[
    "author",
    "editors",
    "year",
    "title",
    "journal",
    "conference_title",
    "book_title",
    "publisher",
    "institution",
    "edition",
    "thesis_type",
    "repository",
    "article_number",
    "accessed_date",
    "site_name",
    "database",
    "report_number",
    "volume",
    "issue",
    "pages",
    "doi",
    "url",
    "place_of_publication",
]

CanonicalBioTag = Literal["O"] | str

FIELD_NAME_BY_BIO_CORE: dict[CanonicalBioCore, str] = {
    "author": "authors",
    "editors": "editors",
    "year": "year",
    "title": "title",
    "journal": "journal",
    "conference_title": "conferenceTitle",
    "book_title": "bookTitle",
    "publisher": "publisher",
    "institution": "institution",
    "edition": "edition",
    "thesis_type": "thesisType",
    "repository": "repository",
    "article_number": "articleNumber",
    "accessed_date": "accessedDate",
    "site_name": "siteName",
    "database": "database",
    "report_number": "reportNumber",
    "volume": "volume",
    "issue": "issue",
    "pages": "pages",
    "doi": "doi",
    "url": "url",
    "place_of_publication": "placeOfPublication",
}

BIO_CORE_ALIASES: dict[str, CanonicalBioCore] = {
    "author": "author",
    "authors": "author",
    "person": "author",
    "per": "author",
    "editor": "editors",
    "editors": "editors",
    "year": "year",
    "date": "year",
    "title": "title",
    "journal": "journal",
    "journal_title": "journal",
    "journaltitle": "journal",
    "journal_venue": "journal",
    "journalvenue": "journal",
    "venue": "journal",
    "conference": "conference_title",
    "conference_name": "conference_title",
    "conferencename": "conference_title",
    "conference_title": "conference_title",
    "conferencetitle": "conference_title",
    "book": "book_title",
    "book_title": "book_title",
    "booktitle": "book_title",
    "publisher": "publisher",
    "institution": "institution",
    "edition": "edition",
    "thesis_type": "thesis_type",
    "thesis": "thesis_type",
    "repository": "repository",
    "article_number": "article_number",
    "articlenumber": "article_number",
    "articleid": "article_number",
    "accessed_date": "accessed_date",
    "access_date": "accessed_date",
    "accessdate": "accessed_date",
    "accessed": "accessed_date",
    "site_name": "site_name",
    "sitename": "site_name",
    "database": "database",
    "report_number": "report_number",
    "reportnumber": "report_number",
    "reportno": "report_number",
    "place": "place_of_publication",
    "publication_place": "place_of_publication",
    "publicationplace": "place_of_publication",
    "place_of_publication": "place_of_publication",
    "placeofpublication": "place_of_publication",
    "volume": "volume",
    "issue": "issue",
    "pages": "pages",
    "page": "pages",
    "doi": "doi",
    "url": "url",
}

CANONICAL_BIO_LABELS: tuple[CanonicalBioCore, ...] = tuple(FIELD_NAME_BY_BIO_CORE.keys())

_PUNCT_NO_SPACE_BEFORE = re.compile(r"\s+([,.;:!?%])")
_PUNCT_NO_SPACE_AFTER_OPEN = re.compile(r"([([{])\s+")
_PUNCT_NO_SPACE_BEFORE_OPEN = re.compile(r"\s+([([{])")
_PUNCT_NO_SPACE_BEFORE_CLOSE = re.compile(r"\s+([)\]}])")
_SLASH_DASH_TIGHTEN = re.compile(r"\s*([/\-])\s*")
_YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")


class BioGoldRow(TypedDict):
    raw_text: str
    bio_tokens: list[str]
    bio_tags: list[str]
    expected_fields: dict[str, Any]
    expected_type: str | None
    expected_style: str | None
    dataset_split: str | None
    trust_level: str | None
    row_status: str | None
    input_hash: str
    provenance: str | None
    pipeline_major: int | None
    task: str
    truth_scope: str
    source_dataset: NotRequired[str]
    source_config: NotRequired[str | None]
    source_split: NotRequired[str | None]
    source_row_id: NotRequired[str | int | None]
    entity_fields: NotRequired[list[str]]
    entity_starts: NotRequired[list[int]]
    entity_ends: NotRequired[list[int]]
    entity_texts: NotRequired[list[str]]


def detokenize_tokens(tokens: list[str]) -> str:
    text = " ".join(token.strip() for token in tokens if token and token.strip())
    text = _PUNCT_NO_SPACE_BEFORE.sub(r"\1", text)
    text = _PUNCT_NO_SPACE_AFTER_OPEN.sub(r"\1", text)
    text = _PUNCT_NO_SPACE_BEFORE_OPEN.sub(r"\1", text)
    text = _PUNCT_NO_SPACE_BEFORE_CLOSE.sub(r"\1", text)
    text = _SLASH_DASH_TIGHTEN.sub(r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_bio_core(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def parse_bio_tag(
    raw_tag: str,
    alias_map: dict[str, CanonicalBioCore],
    unknown_policy: Literal["error", "drop"] = "error",
) -> CanonicalBioTag:
    tag = raw_tag.strip()
    if not tag:
        return "O"

    upper_tag = tag.upper()
    if upper_tag in {"O", "OUTSIDE"}:
        return "O"

    prefix = ""
    core = tag

    match = re.match(r"^(B|I)[\-_:](.+)$", tag, flags=re.IGNORECASE)
    if match:
        prefix = match.group(1).upper()
        core = match.group(2)
    else:
        match = re.match(r"^(.+)[\-_:](B|I)$", tag, flags=re.IGNORECASE)
        if match:
            prefix = match.group(2).upper()
            core = match.group(1)
        else:
            normalized = normalize_bio_core(tag)
            if normalized in {"o", "outside"}:
                return "O"
            prefix = "B"
            core = tag

    normalized_core = normalize_bio_core(core)
    canonical_core = alias_map.get(normalized_core)
    if canonical_core is None:
        if unknown_policy == "drop":
            return "O"
        raise ValueError(f"Unknown BIO core label: '{raw_tag}'")

    return f"{prefix}-{canonical_core}"


def normalize_bio_tags(
    raw_tags: list[str],
    alias_map: dict[str, CanonicalBioCore] | None = None,
    unknown_policy: Literal["error", "drop"] = "error",
) -> list[str]:
    mapping = alias_map or BIO_CORE_ALIASES
    normalized: list[str] = []
    for raw_tag in raw_tags:
        normalized.append(parse_bio_tag(str(raw_tag), mapping, unknown_policy=unknown_policy))
    return normalized


def _field_value_from_span(field_name: str, span_text: str) -> Any:
    text = span_text.strip()
    if not text:
        return None

    if field_name == "year":
        year_match = _YEAR_RE.search(text)
        return int(year_match.group(1)) if year_match else None

    if field_name == "url":
        return re.sub(r"\s+", "", text).rstrip(".,;:")

    if field_name in {"doi", "pages"}:
        return text.rstrip(".,;:")

    return text.strip(" \"'“”‘’").rstrip(".,;:")


def _merge_expected_field(expected_fields: dict[str, Any], field_name: str, value: Any) -> None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return

    if field_name in {"authors", "editors"}:
        existing = expected_fields.get(field_name)
        if isinstance(existing, list):
            existing.append(value)
            return
        if existing is None:
            expected_fields[field_name] = [value]
            return
        expected_fields[field_name] = [existing, value]
        return

    if field_name in expected_fields:
        existing_value = expected_fields[field_name]
        if isinstance(existing_value, str) and isinstance(value, str):
            expected_fields[field_name] = re.sub(
                r"\s+",
                " ",
                f"{existing_value} {value}",
            ).strip()
        return

    expected_fields[field_name] = value


def derive_expected_fields_from_bio(tokens: list[str], bio_tags: list[str]) -> dict[str, Any]:
    if len(tokens) != len(bio_tags):
        raise ValueError(
            f"BIO row token/tag length mismatch: {len(tokens)} tokens vs {len(bio_tags)} tags"
        )

    expected_fields: dict[str, Any] = {}
    span_tokens: list[str] = []
    current_core: CanonicalBioCore | None = None

    def flush_span() -> None:
        nonlocal span_tokens, current_core
        if current_core is None or not span_tokens:
            span_tokens = []
            current_core = None
            return

        field_name = FIELD_NAME_BY_BIO_CORE[current_core]
        span_text = detokenize_tokens(span_tokens)
        value = _field_value_from_span(field_name, span_text)
        _merge_expected_field(expected_fields, field_name, value)
        span_tokens = []
        current_core = None

    for token, tag in zip(tokens, bio_tags, strict=True):
        if tag == "O":
            flush_span()
            continue

        prefix, raw_core = tag.split("-", 1)
        core = raw_core  # canonical at this point

        if core not in FIELD_NAME_BY_BIO_CORE:
            flush_span()
            continue

        canonical_core = core  # type: ignore[assignment]
        if prefix == "B" or current_core != canonical_core:
            flush_span()
            current_core = canonical_core
            span_tokens = [token]
            continue

        span_tokens.append(token)

    flush_span()
    return expected_fields


def compute_input_hash(raw_text: str) -> str:
    normalized = normalize_inference_text(raw_text, DEFAULT_PREPROCESSING_SPEC)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def load_bio_gold_jsonl(path: str | Path, include_quarantined: bool = False) -> list[BioGoldRow]:
    rows: list[BioGoldRow] = []
    file_path = resolve_bio_gold_jsonl_path(path)

    with file_path.open(encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise ValueError(f"line {line_number}: expected JSON object")

            row_status = payload.get("row_status")
            trust_level = payload.get("trust_level")
            if (
                not include_quarantined
                and (
                    row_status == "quarantined"
                    or trust_level == "draft"
                )
            ):
                continue

            raw_text = payload.get("raw_text")
            if not isinstance(raw_text, str) or not raw_text.strip():
                raw_text = payload.get("raw_reference")
            if not isinstance(raw_text, str) or not raw_text.strip():
                raise ValueError(
                    f"line {line_number}: row must include non-empty raw_text or raw_reference"
                )

            tokens = payload.get("bio_tokens")
            if not isinstance(tokens, list):
                tokens = payload.get("tokens")
            if not isinstance(tokens, list) or not tokens or not all(isinstance(token, str) for token in tokens):
                raise ValueError(
                    f"line {line_number}: row must include non-empty bio_tokens or tokens string array"
                )

            tags = payload.get("bio_tags")
            if not isinstance(tags, list) or not tags or not all(isinstance(tag, str) for tag in tags):
                raise ValueError(f"line {line_number}: bio_tags must be a non-empty string array")

            if len(tokens) != len(tags):
                raise ValueError(
                    f"line {line_number}: bio_tokens ({len(tokens)}) and bio_tags ({len(tags)}) must match"
                )
            tags = normalize_bio_tags(tags)

            expected_fields = payload.get("expected_fields")
            if not isinstance(expected_fields, dict):
                expected_fields = derive_expected_fields_from_bio(tokens, tags)

            row: BioGoldRow = {
                "raw_text": raw_text,
                "bio_tokens": tokens,
                "bio_tags": tags,
                "expected_fields": expected_fields,
                "expected_type": payload.get("expected_type") if isinstance(payload.get("expected_type"), str) else None,
                "expected_style": payload.get("expected_style") if isinstance(payload.get("expected_style"), str) else None,
                "dataset_split": payload.get("dataset_split") if isinstance(payload.get("dataset_split"), str) else None,
                "trust_level": trust_level if isinstance(trust_level, str) else None,
                "row_status": row_status if isinstance(row_status, str) else None,
                "input_hash": payload.get("input_hash")
                if isinstance(payload.get("input_hash"), str) and payload.get("input_hash")
                else compute_input_hash(raw_text),
                "provenance": payload.get("provenance") if isinstance(payload.get("provenance"), str) else None,
                "pipeline_major": payload.get("pipeline_major") if isinstance(payload.get("pipeline_major"), int) else None,
                "task": payload.get("task") if isinstance(payload.get("task"), str) else "field",
                "truth_scope": payload.get("truth_scope") if isinstance(payload.get("truth_scope"), str) else "core",
            }

            if isinstance(payload.get("source_dataset"), str):
                row["source_dataset"] = payload["source_dataset"]
            if isinstance(payload.get("source_config"), str) or payload.get("source_config") is None:
                row["source_config"] = payload.get("source_config")
            if isinstance(payload.get("source_split"), str) or payload.get("source_split") is None:
                row["source_split"] = payload.get("source_split")
            if isinstance(payload.get("source_row_id"), (str, int)) or payload.get("source_row_id") is None:
                row["source_row_id"] = payload.get("source_row_id")
            if isinstance(payload.get("entity_fields"), list) and all(
                isinstance(item, str) for item in payload["entity_fields"]
            ):
                row["entity_fields"] = list(payload["entity_fields"])
            if isinstance(payload.get("entity_starts"), list) and all(
                isinstance(item, int) for item in payload["entity_starts"]
            ):
                row["entity_starts"] = list(payload["entity_starts"])
            if isinstance(payload.get("entity_ends"), list) and all(
                isinstance(item, int) for item in payload["entity_ends"]
            ):
                row["entity_ends"] = list(payload["entity_ends"])
            if isinstance(payload.get("entity_texts"), list) and all(
                isinstance(item, str) for item in payload["entity_texts"]
            ):
                row["entity_texts"] = list(payload["entity_texts"])

            rows.append(row)

    return rows
