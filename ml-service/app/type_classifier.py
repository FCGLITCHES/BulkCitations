from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.style_classifier import extract_style_features, normalize_style_text

REFERENCE_TYPE_LABELS = (
    "article-journal",
    "book",
    "book-chapter",
    "thesis",
    "conference-paper",
    "webpage",
    "report",
    "patent",
    "dataset",
    "preprint",
    "unknown",
)

SUPPORTED_TYPE_LABELS = tuple(label for label in REFERENCE_TYPE_LABELS if label != "unknown")
DEFAULT_TYPE_FEATURE_VERSION = "type-features-v1"

_TYPE_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "type-model" / "current" / "type_model.json"
_YEAR_RE = re.compile(r"\b(?:1[6-9]|20)\d{2}\b")
_URL_RE = re.compile(r"\bhttps?://|www\.", re.IGNORECASE)
_DOI_RE = re.compile(r"\b10\.\d{4,9}/[^\s\"'<>]+", re.IGNORECASE)
_JOURNAL_LOCATOR_RE = re.compile(r"\b\d+\s*\(\d+\)\s*[:,]?\s*\d", re.IGNORECASE)
_PAGES_RE = re.compile(r"\b\d{1,6}\s*[-\u2013\u2014]\s*\d{1,6}\b")
_IN_EDITED_RE = re.compile(r"\bIn\b.+\bed(?:s)?\.?\b", re.IGNORECASE)
_VOL_NO_PP_RE = re.compile(r"\bvol\.?\s+\d+|\bno\.?\s+\d+|\bpp\.?\s+\d", re.IGNORECASE)


@dataclass(frozen=True)
class TypeModelBundle:
    model_version: str
    feature_version: str
    labels: tuple[str, ...]
    biases: dict[str, float]
    weights: dict[str, dict[str, float]]
    source: str


def normalize_type_text(text: str) -> str:
    return normalize_style_text(text)


def extract_type_features(text: str) -> dict[str, float]:
    normalized = normalize_type_text(text)
    low = normalized.lower()
    features: dict[str, float] = {}

    for key, value in extract_style_features(normalized).items():
        if value:
            features[f"style__{key}"] = float(value)

    def add(name: str, value: bool | int | float = True) -> None:
        numeric = float(value)
        if numeric:
            features[name] = numeric

    add("has_year", bool(_YEAR_RE.search(normalized)))
    add("has_url", bool(_URL_RE.search(normalized)))
    add("has_doi", bool(_DOI_RE.search(normalized)))
    add("has_pages", bool(_PAGES_RE.search(normalized)))
    add("journal_locator", bool(_JOURNAL_LOCATOR_RE.search(normalized)))
    add("vol_no_pp", bool(_VOL_NO_PP_RE.search(normalized)))
    add("in_edited_container", bool(_IN_EDITED_RE.search(normalized)))
    add("quoted_title", '"' in normalized or "“" in normalized or "”" in normalized)
    add("semicolon_year_locator", bool(re.search(r";\s*(?:1[6-9]|20)\d{2};?\d", normalized)))
    add("article_number", bool(re.search(r"\b(?:article|art\.?)\s*(?:no\.?)?\s*[A-Z]?\d{3,}\b", low)))

    keyword_groups: dict[str, tuple[str, ...]] = {
        "conference_terms": ("conference", "proceedings", "symposium", "workshop", "congress"),
        "thesis_terms": ("thesis", "dissertation", "doctoral", "master's", "masters"),
        "book_terms": ("isbn", "edition", "press", "publisher", "publishing", "springer", "routledge", "wiley"),
        "report_terms": ("report", "technical report", "working paper", "white paper", "standard"),
        "patent_terms": ("patent", "u.s. patent", "us patent", "patent application"),
        "dataset_terms": ("dataset", "data set", "database", "repository", "figshare", "zenodo"),
        "preprint_terms": ("preprint", "arxiv", "biorxiv", "medrxiv", "ssrn", "research square", "techrxiv"),
        "webpage_terms": ("retrieved", "accessed", "available at", "online", "website", "web page"),
        "journal_terms": ("journal", "nature", "science", "bmj", "cell", "methods", "biometrics"),
    }
    for feature_name, needles in keyword_groups.items():
        add(feature_name, any(needle in low for needle in needles))

    add("long_text", len(normalized) > 220)
    add("short_text", len(normalized) < 80)
    add("comma_dense", normalized.count(",") >= 5)
    add("period_dense", normalized.count(".") >= 4)
    return features


def _model_root_path() -> Path:
    override = Path(str(Path.cwd()))
    env_path = None
    try:
        import os

        env_path = os.getenv("TYPE_MODEL_PATH")
    except Exception:
        env_path = None
    if env_path:
        return Path(env_path)
    return _TYPE_MODEL_PATH


def load_type_bundle() -> TypeModelBundle:
    path = _model_root_path()
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        labels = tuple(
            label
            for label in payload.get("labels", REFERENCE_TYPE_LABELS)
            if isinstance(label, str) and label in REFERENCE_TYPE_LABELS
        )
        if not labels:
            labels = REFERENCE_TYPE_LABELS
        return TypeModelBundle(
            model_version=str(payload.get("modelVersion") or "type-model"),
            feature_version=str(payload.get("featureVersion") or DEFAULT_TYPE_FEATURE_VERSION),
            labels=labels,
            biases={
                label: float(value)
                for label, value in dict(payload.get("biases", {})).items()
                if isinstance(label, str) and isinstance(value, (int, float))
            },
            weights={
                label: {
                    feature: float(weight)
                    for feature, weight in dict(feature_weights).items()
                    if isinstance(feature, str) and isinstance(weight, (int, float))
                }
                for label, feature_weights in dict(payload.get("weights", {})).items()
                if isinstance(label, str) and isinstance(feature_weights, dict)
            },
            source=str(path),
        )

    return TypeModelBundle(
        model_version="heuristic-type-fallback",
        feature_version=DEFAULT_TYPE_FEATURE_VERSION,
        labels=REFERENCE_TYPE_LABELS,
        biases={},
        weights={},
        source="built-in",
    )


def _heuristic_type(text: str) -> tuple[str, float]:
    low = text.lower()
    if "patent" in low:
        return "patent", 0.92
    if any(term in low for term in ("thesis", "dissertation")):
        return "thesis", 0.90
    if any(term in low for term in ("preprint", "arxiv", "biorxiv", "medrxiv", "ssrn")):
        return "preprint", 0.84
    if any(term in low for term in ("dataset", "data set", "figshare", "zenodo")):
        return "dataset", 0.82
    if any(term in low for term in ("proceedings", "conference", "symposium", "workshop")):
        return "conference-paper", 0.82
    if _URL_RE.search(text) and any(term in low for term in ("retrieved", "accessed", "website", "online")):
        return "webpage", 0.82
    if _IN_EDITED_RE.search(text):
        return "book-chapter", 0.76
    if any(term in low for term in ("isbn", "edition", "press", "publisher", "publishing")):
        return "book", 0.78
    if any(term in low for term in ("report", "technical report", "working paper")):
        return "report", 0.78
    if _JOURNAL_LOCATOR_RE.search(text) or "journal" in low or (_PAGES_RE.search(text) and _YEAR_RE.search(text)):
        return "article-journal", 0.72
    return "unknown", 0.40


def _score_bundle(bundle: TypeModelBundle, features: dict[str, float]) -> list[tuple[str, float]]:
    logits: list[tuple[str, float]] = []
    for label in bundle.labels:
        score = float(bundle.biases.get(label, 0.0))
        weights = bundle.weights.get(label, {})
        for feature_name, value in features.items():
            score += float(weights.get(feature_name, 0.0)) * value
        logits.append((label, score))

    if not logits:
        return [("unknown", 1.0)]

    max_logit = max(score for _label, score in logits)
    exp_scores = [(label, math.exp(score - max_logit)) for label, score in logits]
    total = sum(score for _label, score in exp_scores) or 1.0
    return sorted(
        ((label, score / total) for label, score in exp_scores),
        key=lambda item: item[1],
        reverse=True,
    )


def predict_type_batch(texts: list[str]) -> list[dict[str, Any]]:
    bundle = load_type_bundle()
    predictions: list[dict[str, Any]] = []
    for text in texts:
        normalized = normalize_type_text(text)
        heuristic_label, heuristic_confidence = _heuristic_type(normalized)
        if bundle.source == "built-in":
            primary = {"type": heuristic_label, "confidence": round(heuristic_confidence, 4)}
            predictions.append({
                "type": heuristic_label,
                "confidence": round(heuristic_confidence, 4),
                "modelVersion": bundle.model_version,
                "featureVersion": bundle.feature_version,
                "bundleSource": bundle.source,
                "primary": primary,
                "secondary": None,
            })
            continue

        ranked = _score_bundle(bundle, extract_type_features(normalized))
        label, confidence = ranked[0]
        secondary = ranked[1] if len(ranked) > 1 else None
        if (
            heuristic_label in {"patent", "dataset", "preprint", "webpage"}
            and label != heuristic_label
            and heuristic_confidence >= 0.82
        ):
            label = heuristic_label
            confidence = max(float(confidence), heuristic_confidence * 0.85)
        elif confidence < 0.42 and heuristic_label != "unknown":
            label = heuristic_label
            confidence = max(float(confidence), heuristic_confidence * 0.85)

        predictions.append({
            "type": label,
            "confidence": round(float(confidence), 4),
            "modelVersion": bundle.model_version,
            "featureVersion": bundle.feature_version,
            "bundleSource": bundle.source,
            "primary": {"type": label, "confidence": round(float(confidence), 4)},
            "secondary": (
                {"type": secondary[0], "confidence": round(float(secondary[1]), 4)}
                if secondary
                else None
            ),
        })
    return predictions
