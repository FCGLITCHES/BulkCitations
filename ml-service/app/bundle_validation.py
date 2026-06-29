from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.preprocessing import validate_preprocessing_spec

REQUIRED_METADATA_FILE = "metadata.json"
REQUIRED_FEATURE_MANIFEST_FILE = "feature_manifest.json"
REQUIRED_PREPROCESSING_FILE = "preprocessing.json"
REQUIRED_OPTIMIZATION_MANIFEST_FILE = "optimization_manifest.json"

_TOKENIZER_FILES = (
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.txt",
    "merges.txt",
    "spiece.model",
    "sentencepiece.bpe.model",
    "special_tokens_map.json",
)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"Failed to parse JSON file: {path.name}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return payload


def _find_onnx_path(base_dir: Path) -> Path | None:
    candidates = (
        base_dir / "extractor.onnx",
        base_dir / "model.onnx",
        base_dir / "field_extractor.onnx",
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate

    matches = sorted(base_dir.glob("*.onnx"))
    return matches[0] if matches else None


def validate_bundle_dir(base_dir: str | Path) -> dict[str, Any]:
    path = Path(base_dir)
    errors: list[str] = []
    warnings: list[str] = []
    metadata: dict[str, Any] = {}
    feature_manifest: dict[str, Any] = {}
    preprocessing_spec: dict[str, Any] = {}
    optimization_manifest: dict[str, Any] = {}

    if not path.exists():
        errors.append(f"bundle path does not exist: {path}")
        return {
            "valid": False,
            "errors": errors,
            "warnings": warnings,
            "baseDir": str(path),
        }

    onnx_path = _find_onnx_path(path)
    if onnx_path is None:
        errors.append("missing ONNX model file")

    config_payload: dict[str, Any] = {}
    config_path = path / "config.json"
    if not config_path.exists():
        errors.append("missing config.json")
    else:
        try:
            config_payload = _read_json(config_path)
        except ValueError as exc:
            errors.append(str(exc))
    tokenizer_files = [name for name in _TOKENIZER_FILES if (path / name).exists()]
    if not tokenizer_files:
        errors.append("missing tokenizer assets")

    metadata_path = path / REQUIRED_METADATA_FILE
    if not metadata_path.exists():
        errors.append(f"missing {REQUIRED_METADATA_FILE}")
    else:
        try:
            metadata = _read_json(metadata_path)
        except ValueError as exc:
            errors.append(str(exc))

    feature_manifest_path = path / REQUIRED_FEATURE_MANIFEST_FILE
    if not feature_manifest_path.exists():
        errors.append(f"missing {REQUIRED_FEATURE_MANIFEST_FILE}")
    else:
        try:
            feature_manifest = _read_json(feature_manifest_path)
        except ValueError as exc:
            errors.append(str(exc))

    preprocessing_path = path / REQUIRED_PREPROCESSING_FILE
    if not preprocessing_path.exists():
        errors.append(f"missing {REQUIRED_PREPROCESSING_FILE}")
    else:
        try:
            preprocessing_spec = _read_json(preprocessing_path)
            validate_preprocessing_spec(preprocessing_spec)
        except ValueError as exc:
            errors.append(str(exc))

    optimization_manifest_path = path / REQUIRED_OPTIMIZATION_MANIFEST_FILE
    if not optimization_manifest_path.exists():
        errors.append(f"missing {REQUIRED_OPTIMIZATION_MANIFEST_FILE}")
    else:
        try:
            optimization_manifest = _read_json(optimization_manifest_path)
        except ValueError as exc:
            errors.append(str(exc))

    model_version = metadata.get("modelVersion")
    if not isinstance(model_version, str) or not model_version.strip():
        errors.append("metadata.json must define modelVersion")

    feature_version = feature_manifest.get("featureVersion") or metadata.get(
        "featureVersion"
    )
    if not isinstance(feature_version, str) or not feature_version.strip():
        errors.append("feature manifest must define featureVersion")

    raw_id2label = metadata.get("id2label")
    if config_payload:
        raw_id2label = config_payload.get("id2label", raw_id2label)

    if not isinstance(raw_id2label, dict) or not raw_id2label:
        errors.append("bundle must define id2label in config.json or metadata.json")

    if onnx_path is not None and onnx_path.stat().st_size <= 0:
        errors.append("ONNX model file is empty")

    if not optimization_manifest:
        warnings.append("optimization manifest is empty")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "baseDir": str(path),
        "onnxPath": str(onnx_path) if onnx_path else None,
        "modelVersion": model_version if isinstance(model_version, str) else None,
        "featureVersion": feature_version if isinstance(feature_version, str) else None,
        "preprocessingVersion": preprocessing_spec.get("version")
        if isinstance(preprocessing_spec, dict)
        else None,
        "tokenizerFiles": tokenizer_files,
    }
