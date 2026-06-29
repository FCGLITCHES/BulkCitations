"""Two-tier evaluation metrics for the BIO tagging model.

Tier 1 (internal model health): character-span entity precision/recall/F1,
per-label breakdown, and BIO sequence validity.

Tier 2 (product / acceptance): per-field edit-distance similarity, the
accept-without-edit rate, and the confident-wrong rate — the metric the plan
calls the unforgivable case.

This module is deliberately free of torch / onnxruntime so it can be unit-tested
on plain data structures. Model loading lives in the harness that calls it.
"""

from __future__ import annotations

import re
from typing import Any

from app.bio_training_dataset import BIO_CORE_ALIASES, normalize_bio_core

CharSpan = tuple[str, int, int]  # (canonical label, char_start, char_end)

_DASH = re.compile(r"[‐-―−]")
_SQUOTE = re.compile(r"[‘’‚‛′´`]")
_DQUOTE = re.compile(r"[“”„‟″]")
_WS = re.compile(r"\s+")


def canonical_label(label: str) -> str:
    """Map any field/label alias to its canonical BIO core (e.g. authors -> author)."""
    normalized = normalize_bio_core(label)
    return BIO_CORE_ALIASES.get(normalized, normalized)


def normalize_value(value: Any) -> str:
    """Normalize a field value (string / number / list / name object) for comparison."""
    text = _flatten_value(value)
    text = _DASH.sub("-", text)
    text = _SQUOTE.sub("'", text)
    text = _DQUOTE.sub('"', text)
    text = _WS.sub(" ", text).strip().lower()
    return text.strip(" .,;:\"'")


def _flatten_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float)):
        return str(value)
    if isinstance(value, list):
        return "; ".join(_flatten_value(item) for item in value if item not in (None, ""))
    if isinstance(value, dict):
        if "literal" in value and value["literal"]:
            return str(value["literal"])
        family = str(value.get("family", "")).strip()
        given = str(value.get("given", "")).strip()
        if family and given:
            return f"{family} {given}"
        return family or given or str(value.get("value", ""))
    return str(value)


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost))
        previous = current
    return previous[-1]


def similarity_ratio(a: str, b: str) -> float:
    """1.0 == identical, 0.0 == fully different (normalized Levenshtein)."""
    if not a and not b:
        return 1.0
    longest = max(len(a), len(b))
    if longest == 0:
        return 1.0
    return 1.0 - (levenshtein(a, b) / longest)


# --------------------------------------------------------------------------- #
# Tier 1 — internal model health
# --------------------------------------------------------------------------- #

def entity_charspan_metrics(
    gold_rows: list[list[CharSpan]],
    pred_rows: list[list[CharSpan]],
) -> dict[str, Any]:
    """Exact character-span entity P/R/F1, robust to tokenizer mismatch.

    Each row is a list of (label, char_start, char_end). Labels are canonicalized
    so the gold and predicted label vocabularies always align.
    """
    if len(gold_rows) != len(pred_rows):
        raise ValueError("gold_rows and pred_rows must be the same length")

    gold_set: set[tuple[int, str, int, int]] = set()
    pred_set: set[tuple[int, str, int, int]] = set()
    for index, spans in enumerate(gold_rows):
        for label, start, end in spans:
            gold_set.add((index, canonical_label(label), start, end))
    for index, spans in enumerate(pred_rows):
        for label, start, end in spans:
            pred_set.add((index, canonical_label(label), start, end))

    correct = gold_set & pred_set
    precision = len(correct) / len(pred_set) if pred_set else 0.0
    recall = len(correct) / len(gold_set) if gold_set else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if precision + recall else 0.0

    labels = sorted({entity[1] for entity in gold_set | pred_set})
    per_label: dict[str, dict[str, Any]] = {}
    for label in labels:
        gold_label = {entity for entity in gold_set if entity[1] == label}
        pred_label = {entity for entity in pred_set if entity[1] == label}
        correct_label = gold_label & pred_label
        lp = len(correct_label) / len(pred_label) if pred_label else 0.0
        lr = len(correct_label) / len(gold_label) if gold_label else 0.0
        lf = (2 * lp * lr / (lp + lr)) if lp + lr else 0.0
        per_label[label] = {
            "precision": round(lp, 4),
            "recall": round(lr, 4),
            "f1": round(lf, 4),
            "true": len(gold_label),
            "predicted": len(pred_label),
            "correct": len(correct_label),
        }

    return {
        "entity_exact_precision": round(precision, 4),
        "entity_exact_recall": round(recall, 4),
        "entity_exact_f1": round(f1, 4),
        "entity_true": len(gold_set),
        "entity_predicted": len(pred_set),
        "entity_correct": len(correct),
        "per_label": per_label,
    }


def bio_sequence_valid(labels: list[str]) -> bool:
    """True when no I-x tag opens without a matching B-x/I-x of the same core."""
    current: str | None = None
    for tag in labels:
        if tag == "O" or "-" not in tag:
            current = None
            continue
        prefix, core = tag.split("-", 1)
        if prefix == "B":
            current = core
        elif prefix == "I":
            if current != core:
                return False
        else:
            current = None
    return True


def bio_validity_rate(label_rows: list[list[str]]) -> float:
    if not label_rows:
        return 1.0
    valid = sum(1 for row in label_rows if bio_sequence_valid(row))
    return round(valid / len(label_rows), 4)


# --------------------------------------------------------------------------- #
# Tier 2 — product / acceptance
# --------------------------------------------------------------------------- #

def field_row_metrics(
    gold_fields: dict[str, Any],
    pred_fields: dict[str, Any],
    pred_confidences: dict[str, float] | None = None,
    accept_tol: float = 0.97,
    wrong_tol: float = 0.6,
    conf_threshold: float = 0.85,
) -> dict[str, Any]:
    """Per-reference product metrics: field similarities, accept, confident-wrong."""
    confidences = pred_confidences or {}
    similarities: dict[str, float] = {}
    edit_chars = 0
    accept = True

    for field, gold_value in gold_fields.items():
        gold_norm = normalize_value(gold_value)
        if not gold_norm:
            continue
        pred_norm = normalize_value(pred_fields.get(field))
        ratio = similarity_ratio(gold_norm, pred_norm)
        similarities[field] = round(ratio, 4)
        edit_chars += levenshtein(gold_norm, pred_norm)
        if ratio < accept_tol:
            accept = False

    confident_wrong: list[str] = []
    gold_keys = {k for k, v in gold_fields.items() if normalize_value(v)}
    for field, pred_value in pred_fields.items():
        pred_norm = normalize_value(pred_value)
        if not pred_norm:
            continue
        confidence = float(confidences.get(field, 0.0))
        if confidence < conf_threshold:
            continue
        if field not in gold_keys:
            confident_wrong.append(field)  # confident hallucination of a field
            continue
        if similarity_ratio(normalize_value(gold_fields[field]), pred_norm) < wrong_tol:
            confident_wrong.append(field)

    return {
        "field_similarities": similarities,
        "mean_similarity": round(sum(similarities.values()) / len(similarities), 4) if similarities else 1.0,
        "edit_distance": edit_chars,
        "accept_without_edit": accept,
        "confident_wrong_fields": confident_wrong,
    }


def aggregate_product_metrics(row_metrics: list[dict[str, Any]]) -> dict[str, Any]:
    if not row_metrics:
        return {
            "accept_without_edit_rate": 0.0,
            "mean_field_similarity": 0.0,
            "mean_edit_distance": 0.0,
            "confident_wrong_rate": 0.0,
            "rows": 0,
        }
    total = len(row_metrics)
    accepted = sum(1 for row in row_metrics if row["accept_without_edit"])
    confident_wrong = sum(1 for row in row_metrics if row["confident_wrong_fields"])
    return {
        "accept_without_edit_rate": round(accepted / total, 4),
        "mean_field_similarity": round(sum(row["mean_similarity"] for row in row_metrics) / total, 4),
        "mean_edit_distance": round(sum(row["edit_distance"] for row in row_metrics) / total, 4),
        "confident_wrong_rate": round(confident_wrong / total, 4),
        "rows": total,
    }
