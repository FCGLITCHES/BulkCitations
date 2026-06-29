"""Unit tests for the pure two-tier BIO evaluation metrics."""

from __future__ import annotations

from app.bio_eval_metrics import (
    aggregate_product_metrics,
    bio_sequence_valid,
    bio_validity_rate,
    canonical_label,
    entity_charspan_metrics,
    field_row_metrics,
    levenshtein,
    normalize_value,
    similarity_ratio,
)


def test_canonical_label_maps_aliases():
    assert canonical_label("authors") == "author"
    assert canonical_label("journalTitle") == "journal"
    assert canonical_label("author") == "author"


def test_normalize_value_unifies_dashes_quotes_and_names():
    assert normalize_value("44–50") == "44-50"
    assert normalize_value("“Example”") == "example"
    assert normalize_value([{"family": "Smith", "given": "J."}]) == "smith j"


def test_levenshtein_and_ratio():
    assert levenshtein("abc", "abc") == 0
    assert levenshtein("abc", "abd") == 1
    assert similarity_ratio("kitten", "kitten") == 1.0
    assert 0.0 < similarity_ratio("kitten", "sitting") < 1.0


def test_entity_charspan_metrics_perfect_match():
    gold = [[("author", 0, 8), ("year", 10, 14)]]
    pred = [[("authors", 0, 8), ("year", 10, 14)]]  # alias normalizes to author
    metrics = entity_charspan_metrics(gold, pred)
    assert metrics["entity_exact_f1"] == 1.0
    assert metrics["per_label"]["author"]["f1"] == 1.0


def test_entity_charspan_metrics_partial():
    gold = [[("author", 0, 8), ("title", 10, 20)]]
    pred = [[("author", 0, 8)]]  # missed the title
    metrics = entity_charspan_metrics(gold, pred)
    assert metrics["entity_exact_recall"] == 0.5
    assert metrics["entity_exact_precision"] == 1.0


def test_bio_sequence_validity():
    assert bio_sequence_valid(["B-author", "I-author", "O", "B-year"]) is True
    assert bio_sequence_valid(["I-author", "O"]) is False  # I without B
    assert bio_validity_rate([["B-author", "I-author"], ["I-title"]]) == 0.5


def test_field_row_metrics_accept_and_confident_wrong():
    gold = {"authors": ["Smith J"], "title": "Example study", "year": "2020"}
    # Exact prediction => accepted, no confident-wrong.
    perfect = field_row_metrics(gold, dict(gold), {"authors": 0.9, "title": 0.9, "year": 0.99})
    assert perfect["accept_without_edit"] is True
    assert perfect["confident_wrong_fields"] == []

    # Wrong title at high confidence => not accepted, flagged confident-wrong.
    wrong = field_row_metrics(
        gold,
        {"authors": ["Smith J"], "title": "Totally different heading", "year": "2020"},
        {"title": 0.95},
    )
    assert wrong["accept_without_edit"] is False
    assert "title" in wrong["confident_wrong_fields"]


def test_field_row_metrics_confident_hallucination():
    gold = {"title": "A study"}
    # Predicts a DOI that is not in the gold at all, with high confidence.
    metrics = field_row_metrics(gold, {"title": "A study", "doi": "10.1/x"}, {"doi": 0.97})
    assert "doi" in metrics["confident_wrong_fields"]


def test_aggregate_product_metrics():
    rows = [
        {"accept_without_edit": True, "mean_similarity": 1.0, "edit_distance": 0, "confident_wrong_fields": []},
        {"accept_without_edit": False, "mean_similarity": 0.5, "edit_distance": 6, "confident_wrong_fields": ["title"]},
    ]
    agg = aggregate_product_metrics(rows)
    assert agg["accept_without_edit_rate"] == 0.5
    assert agg["confident_wrong_rate"] == 0.5
    assert agg["rows"] == 2
