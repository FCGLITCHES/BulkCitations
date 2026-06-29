from __future__ import annotations

import os
import warnings
from pathlib import Path


ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = ML_SERVICE_ROOT.parent


def _read_override(name: str) -> Path | None:
    value = os.environ.get(name, "").strip()
    return Path(value).expanduser().resolve() if value else None


def _warn_legacy_fallback(description: str, path: Path) -> None:
    warnings.warn(
        f"[dataset-paths] {description} is falling back to legacy path: {path}",
        RuntimeWarning,
        stacklevel=2,
    )


def engine_v2_style_gold_export_path() -> Path:
    return _read_override("BULKREFERENCES_ENGINE_V2_STYLE_GOLD_EXPORT_PATH") or (
        REPOSITORY_ROOT
        / "datasets"
        / "engine-v2"
        / "gold"
        / "style-core"
        / "exports"
        / "style_gold.jsonl"
    )


def legacy_style_gold_export_path() -> Path:
    return _read_override("BULKREFERENCES_STYLE_GOLD_OUTPUT_PATH") or (
        ML_SERVICE_ROOT / "training" / "style_gold.jsonl"
    )


def engine_v2_citation_bio_root() -> Path:
    return _read_override("BULKREFERENCES_ENGINE_V2_CITATION_BIO_ROOT") or (
        REPOSITORY_ROOT / "datasets" / "engine-v2" / "gold" / "citation-bio"
    )


def legacy_citation_bio_root() -> Path:
    return _read_override("BULKREFERENCES_BIO_DATASET_ROOT") or (
        ML_SERVICE_ROOT / "datasets" / "citation-bio"
    )


def resolve_training_jsonl_path(path: str | Path | None) -> Path:
    if path is None:
        v2_path = engine_v2_style_gold_export_path()
        if v2_path.exists():
            return v2_path
        legacy_path = legacy_style_gold_export_path()
        if legacy_path.exists():
            _warn_legacy_fallback("style gold export", legacy_path)
            return legacy_path
        return v2_path

    requested_path = Path(path)
    if requested_path.exists():
        return requested_path

    legacy_path = legacy_style_gold_export_path()
    if requested_path.resolve() == legacy_path.resolve():
        v2_path = engine_v2_style_gold_export_path()
        if v2_path.exists():
            return v2_path

    return requested_path


def resolve_bio_gold_jsonl_path(path: str | Path) -> Path:
    requested_path = Path(path)
    if requested_path.exists():
        return requested_path

    legacy_root = legacy_citation_bio_root().resolve()
    try:
        relative_path = requested_path.resolve().relative_to(legacy_root)
    except ValueError:
        return requested_path

    v2_path = engine_v2_citation_bio_root() / relative_path
    if v2_path.exists():
        return v2_path

    return requested_path
