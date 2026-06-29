from __future__ import annotations

from app.models.onnx_extractor import _merge_entities


def test_merge_entities_preserves_offsets_and_token_ranges() -> None:
    labels = ["O", "B-author", "I-author", "O", "B-title", "I-title"]
    confidences = [0.99, 0.90, 0.80, 0.99, 0.70, 0.60]
    tokens = ["[CLS]", "Smith", "J", ".", "Example", "Study"]
    offsets = [(0, 0), (0, 5), (6, 7), (7, 8), (9, 16), (17, 22)]

    entities, diagnostics = _merge_entities(labels, confidences, tokens, offsets)

    assert diagnostics == []
    assert entities[0]["field"] == "authors"
    assert entities[0]["tokenStart"] == 1
    assert entities[0]["tokenEnd"] == 3
    assert entities[0]["charStart"] == 0
    assert entities[0]["charEnd"] == 7
    assert entities[0]["confidence"] == 0.85
    assert entities[1]["field"] == "title"
    assert entities[1]["text"] == "Example Study"


def test_merge_entities_reports_unclosed_bio_sequence() -> None:
    labels = ["I-title", "I-title"]
    confidences = [0.70, 0.60]
    tokens = ["Example", "Study"]
    offsets = [(0, 7), (8, 13)]

    entities, diagnostics = _merge_entities(labels, confidences, tokens, offsets)

    assert entities[0]["field"] == "title"
    assert diagnostics[0]["code"] == "unclosed_bio_sequence"
    assert diagnostics[0]["severity"] == "review"
