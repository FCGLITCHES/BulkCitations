from __future__ import annotations

import re
from typing import Any

import numpy as np

from app.models.loader import LoadedOnnxExtractor, registry

_LABEL_MAP: dict[str, str] = {
    "author": "authors",
    "title": "title",
    "journal": "journal",
    "year": "year",
    "volume": "volume",
    "issue": "issue",
    "pages": "pages",
    "doi": "doi",
    "url": "url",
    "publisher": "publisher",
    "conference_title": "conferenceTitle",
    "conference": "conferenceTitle",
    "book_title": "bookTitle",
    "institution": "institution",
    "edition": "edition",
    "editors": "editors",
    "thesis_type": "thesisType",
    "repository": "repository",
    "article_number": "articleNumber",
    "accessed_date": "accessedDate",
    "site_name": "siteName",
    "database": "database",
    "report_number": "reportNumber",
    "place_of_publication": "placeOfPublication",
}


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits, axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / np.sum(exp, axis=-1, keepdims=True)


def _detokenize(tokens: list[str]) -> str:
    out: list[str] = []
    for token in tokens:
        if token.startswith("##"):
            if out:
                out[-1] += token[2:]
            else:
                out.append(token[2:])
            continue
        out.append(token)

    text = " ".join(out).strip()
    text = re.sub(r"\s+([,.;:!?%])", r"\1", text)
    text = re.sub(r"\s+([)\]}])", r"\1", text)
    text = re.sub(r"([([{])\s+", r"\1", text)
    text = re.sub(r"\s+([([{])", r"\1", text)
    text = re.sub(r"\s*([/\-])\s*", r"\1", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _normalize_span_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def _clean_field_text(field_name: str, value: str) -> str:
    text = _normalize_span_text(value)
    if field_name in {
        "title",
        "journal",
        "publisher",
        "conferenceTitle",
        "bookTitle",
        "institution",
        "edition",
        "thesisType",
        "repository",
        "articleNumber",
        "accessedDate",
        "siteName",
        "database",
        "reportNumber",
        "placeOfPublication",
    }:
        text = text.strip(" \"'“”‘’").rstrip(".,;:")

    if field_name == "volume":
        match = re.search(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?", text)
        return match.group(0) if match else text

    if field_name == "issue":
        match = re.search(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?", text.strip("()[]{}"))
        return match.group(0) if match else text.strip("()[]{}")

    if field_name == "url":
        return re.sub(r"\s+", "", text).rstrip(".,;:")

    if field_name in {"pages", "doi"}:
        return text.rstrip(".,;:")

    if field_name in {"authors", "editors"}:
        return text.strip(" ;")

    return text


def _labels_from_scores(
    artifact: LoadedOnnxExtractor, encoded: Any
) -> tuple[list[str], list[float], list[str], list[tuple[int, int]]]:
    feeds: dict[str, np.ndarray] = {}
    input_names = {input_meta.name for input_meta in artifact.session.get_inputs()}

    for key in ("input_ids", "attention_mask", "token_type_ids"):
        if key not in encoded:
            continue
        if key in input_names:
            feeds[key] = np.asarray(encoded[key], dtype=np.int64)

    if "token_type_ids" in input_names and "token_type_ids" not in feeds:
        feeds["token_type_ids"] = np.zeros_like(feeds["input_ids"], dtype=np.int64)

    outputs = artifact.session.run(None, feeds)
    logits = next(
        (
            np.asarray(output)
            for output in outputs
            if isinstance(output, np.ndarray) and output.ndim == 3
        ),
        None,
    )
    if logits is None:
        raise RuntimeError("ONNX extractor did not return token-classification logits.")

    probabilities = _softmax(logits[0])
    predicted_ids = np.argmax(probabilities, axis=-1)
    confidences = np.max(probabilities, axis=-1)
    tokens = artifact.tokenizer.convert_ids_to_tokens(encoded["input_ids"][0])
    offsets = [
        (int(start), int(end))
        for start, end in encoded["offset_mapping"][0].tolist()
    ]
    labels = [
        artifact.id2label.get(int(label_id), "O")
        for label_id in predicted_ids.tolist()
    ]
    return labels, confidences.tolist(), tokens, offsets


def _merge_entities(
    labels: list[str],
    confidences: list[float],
    tokens: list[str],
    offsets: list[tuple[int, int]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    entities: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    current_label = ""
    current_tokens: list[str] = []
    current_confidences: list[float] = []
    current_token_start = 0
    current_char_start = 0
    current_char_end = 0

    def flush(token_end: int) -> None:
        if not current_label or not current_tokens:
            return
        field_name = _LABEL_MAP.get(current_label.lower(), current_label.lower())
        char_end = max(current_char_end, current_char_start)
        valid = current_char_start >= 0 and char_end > current_char_start
        entities.append(
            {
                "label": current_label,
                "field": field_name,
                "text": _normalize_span_text(_detokenize(current_tokens)),
                "confidence": round(
                    sum(current_confidences) / max(len(current_confidences), 1), 4
                ),
                "tokenStart": current_token_start,
                "tokenEnd": token_end,
                "charStart": current_char_start,
                "charEnd": char_end,
                "valid": valid,
                "diagnostics": [] if valid else ["invalid_span_offsets"],
            }
        )

    occupied_token_indexes: set[int] = set()

    for idx, (label, confidence, token, offset) in enumerate(
        zip(labels, confidences, tokens, offsets, strict=False)
    ):
        start, end = offset
        if token in {"[CLS]", "[SEP]", "[PAD]"}:
            flush(idx)
            current_label = ""
            current_tokens = []
            current_confidences = []
            continue

        if label == "O":
            flush(idx)
            current_label = ""
            current_tokens = []
            current_confidences = []
            continue

        prefix = ""
        core = label
        if "-" in label:
            prefix, core = label.split("-", 1)

        if prefix == "B" or not current_label or core != current_label:
            if prefix == "I" and (not current_label or core != current_label):
                diagnostics.append(
                    {
                        "code": "unclosed_bio_sequence",
                        "severity": "review",
                        "label": core,
                        "tokenIndex": idx,
                        "message": f"I-{core} began without an open B-{core} span.",
                    }
                )
            flush(idx)
            current_label = core
            current_tokens = [token]
            current_confidences = [confidence]
            current_token_start = idx
            current_char_start = int(start)
            current_char_end = int(end)
            if idx in occupied_token_indexes:
                diagnostics.append(
                    {
                        "code": "overlapping_spans",
                        "severity": "review",
                        "label": core,
                        "tokenIndex": idx,
                        "message": "BIO entity reused a token already assigned to another span.",
                    }
                )
            occupied_token_indexes.add(idx)
            continue

        current_tokens.append(token)
        current_confidences.append(confidence)
        current_char_end = int(end)
        if idx in occupied_token_indexes:
            diagnostics.append(
                {
                    "code": "overlapping_spans",
                    "severity": "review",
                    "label": core,
                    "tokenIndex": idx,
                    "message": "BIO entity reused a token already assigned to another span.",
                }
            )
        occupied_token_indexes.add(idx)

    flush(len(tokens))
    return entities, diagnostics


def _build_bio_payload(
    artifact: LoadedOnnxExtractor,
    tokens: list[str],
    labels: list[str],
    offsets: list[tuple[int, int]],
    confidences: list[float],
    entities: list[dict[str, Any]],
    diagnostics: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "tokens": tokens,
        "labels": labels,
        "offsets": offsets,
        "labelConfidences": [round(float(confidence), 4) for confidence in confidences],
        "entities": entities,
        "diagnostics": diagnostics,
        "labelSchemaVersion": (
            artifact.metadata.get("labelSchemaVersion")
            or artifact.metadata.get("datasetTrack")
            or "citation-bio-v1"
        ),
        "featureVersion": artifact.feature_version,
        "modelVersion": artifact.model_version,
    }


def _fields_from_entities(entities: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, float]]:
    fields: dict[str, Any] = {}
    field_confidences: dict[str, float] = {}

    for entity in entities:
        label = str(entity["label"]).lower()
        text = str(entity["text"]).strip()
        confidence = float(entity["confidence"])
        if not text:
            continue

        field_name = _LABEL_MAP.get(label, label)
        if field_name == "year":
            year_match = re.search(r"\b((?:19|20)\d{2})\b", text)
            if year_match:
                fields[field_name] = int(year_match.group(1))
                field_confidences[field_name] = max(
                    field_confidences.get(field_name, 0.0), confidence
                )
            continue

        if field_name in {"authors", "editors"}:
            existing = fields.get(field_name, [])
            if not isinstance(existing, list):
                existing = [existing]
            cleaned = _clean_field_text(field_name, text)
            if not cleaned:
                continue
            existing.append(cleaned)
            fields[field_name] = existing
            field_confidences[field_name] = max(
                field_confidences.get(field_name, 0.0), confidence
            )
            continue

        cleaned = _clean_field_text(field_name, text)
        if not cleaned:
            continue

        if field_name in fields and isinstance(fields[field_name], str):
            fields[field_name] = _normalize_span_text(
                f"{fields[field_name]} {cleaned}"
            )
        else:
            fields[field_name] = cleaned
        field_confidences[field_name] = max(
            field_confidences.get(field_name, 0.0), confidence
        )

    return fields, field_confidences


def run_onnx_extraction(text: str) -> dict[str, Any] | None:
    artifact = registry.get_extractor_artifact(require_onnx=False)
    if artifact is None:
        return None

    encoded = artifact.tokenizer(
        text,
        return_tensors="np",
        truncation=True,
        max_length=min(
            int(getattr(artifact.tokenizer, "model_max_length", 256) or 256),
            512,
        ),
        return_offsets_mapping=True,
    )

    labels, confidences, tokens, offsets = _labels_from_scores(artifact, encoded)
    entities, diagnostics = _merge_entities(labels, confidences, tokens, offsets)
    fields, field_confidences = _fields_from_entities(entities)
    reference_confidence = round(
        sum(field_confidences.values()) / max(len(field_confidences), 1), 3
    )

    return {
        "fields": fields,
        "fieldConfidences": field_confidences,
        "warnings": [],
        "referenceConfidence": reference_confidence,
        "backend": "onnx",
        "bio": _build_bio_payload(
            artifact,
            tokens,
            labels,
            offsets,
            confidences,
            entities,
            diagnostics,
        ),
    }


def has_onnx_extractor() -> bool:
    return registry.get_extractor_artifact(require_onnx=False) is not None
