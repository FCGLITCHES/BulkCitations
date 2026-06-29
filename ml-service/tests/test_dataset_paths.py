from __future__ import annotations

import json
import warnings
from pathlib import Path

from app.dataset_paths import resolve_bio_gold_jsonl_path, resolve_training_jsonl_path
from app.training_dataset import load_training_jsonl


def test_training_loader_prefers_engine_v2_default(
    monkeypatch, tmp_path: Path
) -> None:
    v2_path = tmp_path / "engine-v2" / "style_gold.jsonl"
    legacy_path = tmp_path / "legacy" / "style_gold.jsonl"
    v2_path.parent.mkdir(parents=True)
    legacy_path.parent.mkdir(parents=True)
    payload = {
        "raw_text": "Smith, J. (2020). Example article.",
        "expected_fields": {"title": "Example article"},
        "expected_style": "apa7",
    }
    v2_path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    legacy_path.write_text(json.dumps({**payload, "raw_text": "legacy"}) + "\n", encoding="utf-8")
    monkeypatch.setenv("BULKREFERENCES_ENGINE_V2_STYLE_GOLD_EXPORT_PATH", str(v2_path))
    monkeypatch.setenv("BULKREFERENCES_STYLE_GOLD_OUTPUT_PATH", str(legacy_path))

    rows = load_training_jsonl()

    assert rows[0]["raw_text"] == payload["raw_text"]


def test_training_resolver_warns_when_falling_back_to_legacy(
    monkeypatch, tmp_path: Path
) -> None:
    v2_path = tmp_path / "missing" / "style_gold.jsonl"
    legacy_path = tmp_path / "legacy" / "style_gold.jsonl"
    legacy_path.parent.mkdir(parents=True)
    legacy_path.write_text('{"raw_text":"legacy","expected_fields":{}}\n', encoding="utf-8")
    monkeypatch.setenv("BULKREFERENCES_ENGINE_V2_STYLE_GOLD_EXPORT_PATH", str(v2_path))
    monkeypatch.setenv("BULKREFERENCES_STYLE_GOLD_OUTPUT_PATH", str(legacy_path))

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        resolved = resolve_training_jsonl_path(None)

    assert resolved == legacy_path
    assert any("falling back to legacy path" in str(item.message) for item in caught)


def test_bio_resolver_maps_missing_legacy_path_to_v2_equivalent(
    monkeypatch, tmp_path: Path
) -> None:
    legacy_root = tmp_path / "legacy-bio"
    v2_root = tmp_path / "engine-v2-bio"
    requested = legacy_root / "processed" / "train.jsonl"
    v2_path = v2_root / "processed" / "train.jsonl"
    v2_path.parent.mkdir(parents=True)
    v2_path.write_text('{"raw_text":"bio"}\n', encoding="utf-8")
    monkeypatch.setenv("BULKREFERENCES_BIO_DATASET_ROOT", str(legacy_root))
    monkeypatch.setenv("BULKREFERENCES_ENGINE_V2_CITATION_BIO_ROOT", str(v2_root))

    assert resolve_bio_gold_jsonl_path(requested) == v2_path
