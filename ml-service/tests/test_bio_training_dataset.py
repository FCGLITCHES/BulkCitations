from __future__ import annotations

import json

import pytest

from app.bio_training_dataset import (
    BIO_CORE_ALIASES,
    derive_expected_fields_from_bio,
    load_bio_gold_jsonl,
    normalize_bio_tags,
)


def test_normalize_bio_tags_maps_aliases() -> None:
    tags = ["B-PER", "I-PER", "O", "B-journalTitle", "I-conferenceName", "B-place", "I-accessDate"]
    normalized = normalize_bio_tags(tags, alias_map=BIO_CORE_ALIASES)
    assert normalized == [
        "B-author",
        "I-author",
        "O",
        "B-journal",
        "I-conference_title",
        "B-place_of_publication",
        "I-accessed_date",
    ]


def test_derive_expected_fields_from_bio_generates_core_fields() -> None:
    tokens = [
        "Smith",
        ",",
        "J.",
        "(",
        "2020",
        ")",
        ".",
        "A",
        "Study",
        "of",
        "Tests",
        ".",
        "Journal",
        "of",
        "Examples",
        ",",
        "12",
        "(",
        "3",
        ")",
        ",",
        "44-50",
        ".",
    ]
    tags = [
        "B-author",
        "I-author",
        "I-author",
        "O",
        "B-year",
        "O",
        "O",
        "B-title",
        "I-title",
        "I-title",
        "I-title",
        "O",
        "B-journal",
        "I-journal",
        "I-journal",
        "O",
        "B-volume",
        "O",
        "B-issue",
        "O",
        "O",
        "B-pages",
        "O",
    ]

    expected = derive_expected_fields_from_bio(tokens, tags)
    assert expected["authors"] == ["Smith, J"]
    assert expected["year"] == 2020
    assert expected["title"] == "A Study of Tests"
    assert expected["journal"] == "Journal of Examples"
    assert expected["volume"] == "12"
    assert expected["issue"] == "3"
    assert expected["pages"] == "44-50"


def test_load_bio_gold_jsonl_derives_fields_when_missing(tmp_path) -> None:
    input_path = tmp_path / "bio.jsonl"
    payload = {
        "raw_text": "Doe, A. (2022). Demo title.",
        "bio_tokens": ["Doe", ",", "A.", "(", "2022", ")", ".", "Demo", "title", "."],
        "bio_tags": ["B-author", "I-author", "I-author", "O", "B-year", "O", "O", "B-title", "I-title", "O"],
    }
    input_path.write_text(json.dumps(payload) + "\n", encoding="utf-8")

    rows = load_bio_gold_jsonl(input_path)
    assert len(rows) == 1
    row = rows[0]
    assert row["expected_fields"]["authors"] == ["Doe, A"]
    assert row["expected_fields"]["year"] == 2022
    assert row["expected_fields"]["title"] == "Demo title"
    assert row["task"] == "field"
    assert row["truth_scope"] == "core"


def test_load_bio_gold_jsonl_excludes_quarantined_and_draft_rows_by_default(tmp_path) -> None:
    input_path = tmp_path / "bio.jsonl"
    rows = [
        {
            "raw_text": "Good A. Kept title. Journal. 2020.",
            "bio_tokens": ["Good", "A", ".", "Kept", "title", "."],
            "bio_tags": ["B-author", "I-author", "O", "B-title", "I-title", "O"],
            "row_status": "reviewed",
            "trust_level": "gold",
        },
        {
            "raw_text": "Draft A. Draft title. Journal. 2020.",
            "bio_tokens": ["Draft", "A", ".", "Draft", "title", "."],
            "bio_tags": ["B-author", "I-author", "O", "B-title", "I-title", "O"],
            "row_status": "draft",
            "trust_level": "draft",
        },
        {
            "raw_text": "Bad A. Quarantined title. Journal. 2020.",
            "bio_tokens": ["Bad", "A", ".", "Quarantined", "title", "."],
            "bio_tags": ["B-author", "I-author", "O", "B-title", "I-title", "O"],
            "row_status": "quarantined",
            "trust_level": "gold",
        },
    ]
    input_path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

    loaded = load_bio_gold_jsonl(input_path)
    assert [row["raw_text"] for row in loaded] == ["Good A. Kept title. Journal. 2020."]

    with_quarantine = load_bio_gold_jsonl(input_path, include_quarantined=True)
    assert len(with_quarantine) == 3


def test_load_bio_gold_jsonl_rejects_mismatched_lengths(tmp_path) -> None:
    input_path = tmp_path / "bad.jsonl"
    payload = {
        "raw_text": "Mismatch",
        "bio_tokens": ["A", "B"],
        "bio_tags": ["O"],
        "expected_fields": {},
    }
    input_path.write_text(json.dumps(payload) + "\n", encoding="utf-8")

    with pytest.raises(ValueError, match="must match"):
        load_bio_gold_jsonl(input_path)


def test_load_bio_gold_jsonl_accepts_span_projection_keys(tmp_path) -> None:
    input_path = tmp_path / "projection.jsonl"
    payload = {
        "raw_reference": "Doe A. Demo title. Journal. 2022;5(1):1-3.",
        "tokens": ["Doe", "A", ".", "Demo", "title", ".", "Journal", ".", "2022"],
        "bio_tags": [
            "B-author",
            "I-author",
            "O",
            "B-title",
            "I-title",
            "O",
            "B-journal",
            "O",
            "B-year",
        ],
        "entity_fields": ["author", "title", "journal", "year"],
        "entity_starts": [0, 7, 19, 28],
        "entity_ends": [5, 17, 26, 32],
        "entity_texts": ["Doe A", "Demo title", "Journal", "2022"],
    }
    input_path.write_text(json.dumps(payload) + "\n", encoding="utf-8")

    rows = load_bio_gold_jsonl(input_path)
    assert len(rows) == 1
    row = rows[0]
    assert row["raw_text"] == payload["raw_reference"]
    assert row["bio_tokens"] == payload["tokens"]
    assert row["entity_fields"] == payload["entity_fields"]
