from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

DEFAULT_PREPROCESSING_SPEC: dict[str, Any] = {
    "version": "plain-text-v1",
    "unicodeNormalization": "NFKC",
    "normalizeWhitespace": True,
    "replaceLigatures": True,
    "removeSoftHyphens": True,
    "collapseHyphenatedLineBreaks": True,
    "stripControlCharacters": True,
    "maxInputChars": 8192,
}

_LIGATURES = {
    "\u00c6": "AE",
    "\u00e6": "ae",
    "\u0152": "OE",
    "\u0153": "oe",
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "ft",
    "\ufb06": "st",
}


def load_preprocessing_spec(base_dir: Path | None) -> dict[str, Any]:
    if base_dir is None:
        return dict(DEFAULT_PREPROCESSING_SPEC)

    path = base_dir / "preprocessing.json"
    if not path.exists():
        return dict(DEFAULT_PREPROCESSING_SPEC)

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - defensive path
        raise ValueError(f"Failed to read preprocessing spec: {path}") from exc

    if not isinstance(payload, dict):
        raise ValueError("preprocessing.json must contain a JSON object")

    spec = dict(DEFAULT_PREPROCESSING_SPEC)
    spec.update(payload)
    validate_preprocessing_spec(spec)
    return spec


def validate_preprocessing_spec(spec: dict[str, Any]) -> None:
    version = spec.get("version")
    if not isinstance(version, str) or not version.strip():
        raise ValueError("preprocessing spec requires a non-empty version")

    normalization = spec.get("unicodeNormalization")
    if normalization not in {"NFC", "NFD", "NFKC", "NFKD"}:
        raise ValueError(
            "preprocessing spec unicodeNormalization must be NFC, NFD, NFKC, or NFKD"
        )

    max_input_chars = spec.get("maxInputChars")
    if not isinstance(max_input_chars, int) or max_input_chars < 128:
        raise ValueError("preprocessing spec maxInputChars must be an integer >= 128")


def normalize_inference_text(text: str, spec: dict[str, Any]) -> str:
    if not isinstance(text, str):
        raise ValueError("text must be a string")

    value = unicodedata.normalize(spec["unicodeNormalization"], text)

    if spec.get("replaceLigatures", True):
        value = "".join(_LIGATURES.get(char, char) for char in value)

    if spec.get("removeSoftHyphens", True):
        value = value.replace("\u00ad", "")

    if spec.get("collapseHyphenatedLineBreaks", True):
        value = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", value)

    if spec.get("stripControlCharacters", True):
        value = "".join(
            " " if unicodedata.category(char).startswith("C") and char not in "\n\t" else char
            for char in value
        )

    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"\n+", " ", value)

    if spec.get("normalizeWhitespace", True):
        value = re.sub(r"\s+", " ", value)

    value = value.strip()
    max_input_chars = int(spec["maxInputChars"])
    if len(value) > max_input_chars:
        value = value[:max_input_chars].rstrip()

    return value
