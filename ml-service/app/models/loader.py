from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.preprocessing import load_preprocessing_spec

logger = logging.getLogger(__name__)

MAX_MEMORY_BYTES = int(3.5 * 1024**3)  # 3.5 GB

_MODEL_CONFIGS: dict[str, dict[str, str]] = {
    "style_detector": {
        "type": "text-classification",
        "model_id": "bert-base-uncased",
    },
    "field_extractor": {
        "type": "token-classification",
        "model_id": "SIRIS-Lab/citation-parser-ENTITY",
    },
}


@dataclass
class LoadedOnnxExtractor:
    base_dir: Path
    onnx_path: Path
    session: Any
    tokenizer: Any
    id2label: dict[int, str]
    model_version: str | None
    feature_version: str | None
    bundle_class: str | None
    preprocessing_spec: dict[str, Any]
    optimization_manifest: dict[str, Any]
    metadata: dict[str, Any]
    memory_bytes: int
    last_used: float = field(default_factory=time.monotonic)


@dataclass
class _LoadedModel:
    name: str
    pipeline: Any
    memory_bytes: int
    last_used: float = field(default_factory=time.monotonic)


class ModelRegistry:
    """Lazy-loading registry for optional transformer helpers and ONNX artifacts."""

    def __init__(self) -> None:
        self._models: OrderedDict[str, _LoadedModel] = OrderedDict()
        self._extractor: LoadedOnnxExtractor | None = None
        self._extractor_key: str | None = None
        self._model_version_pin = os.environ.get("MODEL_VERSION_PIN") or None
        self._lock = threading.Lock()
        self._total_memory = 0

    def resolve_model_dir(self) -> Path:
        root = Path(
            os.environ.get(
                "MODEL_DIR",
                Path(__file__).resolve().parents[2] / "models",
            )
        )
        pin = self.get_model_version_pin()
        if pin:
            pinned_candidates = (
                root / "promoted" / pin,
                root / "staged" / pin,
                root / pin,
            )
            for candidate in pinned_candidates:
                if candidate.exists():
                    return candidate

        current_dir = root / "current"
        return current_dir if current_dir.exists() else root

    def get_model_version_pin(self) -> str | None:
        with self._lock:
            return self._model_version_pin

    def set_model_version_pin(self, value: str | None) -> str | None:
        normalized = value.strip() if isinstance(value, str) else None
        with self._lock:
            self._model_version_pin = normalized or None
        self._clear_extractor_cache()
        return self.get_model_version_pin()

    def get_model(self, name: str) -> Any | None:
        with self._lock:
            if name in self._models:
                entry = self._models[name]
                entry.last_used = time.monotonic()
                self._models.move_to_end(name)
                return entry.pipeline
        return self._load(name)

    def get_extractor_artifact(
        self, require_onnx: bool = False
    ) -> LoadedOnnxExtractor | None:
        base_dir = self.resolve_model_dir()
        cache_key = str(base_dir.resolve())

        with self._lock:
            if self._extractor is not None and self._extractor_key == cache_key:
                self._extractor.last_used = time.monotonic()
                return self._extractor

        artifact = self._load_extractor_artifact(base_dir, require_onnx=require_onnx)
        with self._lock:
            self._extractor = artifact
            self._extractor_key = cache_key if artifact is not None else None
        return artifact

    def clear_extractor_cache(self) -> None:
        self._clear_extractor_cache()

    def unload_lru(self) -> bool:
        with self._lock:
            if self._extractor is not None and not self._models:
                entry = self._extractor
                self._extractor = None
                self._extractor_key = None
                self._total_memory = max(0, self._total_memory - entry.memory_bytes)
                logger.info(
                    "Evicted ONNX extractor (freed %.1f MB)",
                    entry.memory_bytes / 1e6,
                )
                del entry.session
                del entry.tokenizer
                return True

            if not self._models:
                return False

            oldest_name = next(iter(self._models))
            entry = self._models.pop(oldest_name)
            self._total_memory -= entry.memory_bytes
            logger.info(
                "Evicted model %s (freed %.1f MB)",
                oldest_name,
                entry.memory_bytes / 1e6,
            )
            del entry.pipeline
            return True

    def health_status(self) -> dict[str, Any]:
        with self._lock:
            loaded = {name: "loaded" for name in self._models}
            extractor = self._extractor
            mem = self._total_memory
            pinned = self._model_version_pin

        all_names = set(_MODEL_CONFIGS.keys()) | set(loaded.keys())
        statuses: dict[str, str] = {}
        for name in sorted(all_names):
            if name in loaded:
                statuses[name] = "loaded"
            elif name in _MODEL_CONFIGS:
                statuses[name] = "available"
            else:
                statuses[name] = "unavailable"

        statuses["onnx_extractor"] = "loaded" if extractor is not None else "unavailable"

        return {
            "models": statuses,
            "total_memory_mb": round(mem / 1e6, 1),
            "max_memory_mb": round(MAX_MEMORY_BYTES / 1e6, 1),
            "model_dir": str(self.resolve_model_dir()),
            "pinned_model_version": pinned,
        }

    def _load(self, name: str) -> Any | None:
        cfg = _MODEL_CONFIGS.get(name)
        if cfg is None:
            logger.warning("No config for model '%s'", name)
            return None

        try:
            from transformers import pipeline as hf_pipeline

            pipe = hf_pipeline(cfg["type"], model=cfg["model_id"])
        except Exception:
            logger.warning(
                "Could not load model '%s' – heuristic fallback active",
                name,
                exc_info=True,
            )
            return None

        mem = self._estimate_memory(pipe)
        self._reserve_memory(mem)

        with self._lock:
            self._models[name] = _LoadedModel(
                name=name, pipeline=pipe, memory_bytes=mem
            )
            self._models.move_to_end(name)
            self._total_memory += mem

        logger.info("Loaded model '%s' (%.1f MB)", name, mem / 1e6)
        return pipe

    def _reserve_memory(self, memory_bytes: int) -> None:
        while self._total_memory + memory_bytes > MAX_MEMORY_BYTES:
            if not self.unload_lru():
                break

    def _load_extractor_artifact(
        self, base_dir: Path, require_onnx: bool = False
    ) -> LoadedOnnxExtractor | None:
        if not base_dir.exists():
            if require_onnx:
                logger.info("MODEL_DIR does not exist: %s", base_dir)
            return None

        onnx_path = self._find_onnx_path(base_dir)
        if onnx_path is None:
            if require_onnx:
                logger.info("No ONNX model found under %s", base_dir)
            return None

        try:
            import onnxruntime as ort
            from transformers import AutoConfig, AutoTokenizer
        except Exception:
            logger.warning(
                "Could not import ONNX runtime or tokenizer dependencies",
                exc_info=True,
            )
            return None

        try:
            metadata = self._read_json(base_dir / "metadata.json")
            feature_manifest = self._read_json(base_dir / "feature_manifest.json")
            preprocessing_spec = load_preprocessing_spec(base_dir)
            optimization_manifest = self._read_json(
                base_dir / "optimization_manifest.json"
            )
            config = AutoConfig.from_pretrained(str(base_dir), local_files_only=True)
            tokenizer = AutoTokenizer.from_pretrained(
                str(base_dir), local_files_only=True
            )
            session = ort.InferenceSession(
                str(onnx_path),
                providers=["CPUExecutionProvider"],
            )
        except Exception:
            logger.warning("Failed to load ONNX extractor from %s", base_dir, exc_info=True)
            return None

        id2label: dict[int, str] = {}
        raw_id2label = getattr(config, "id2label", None) or metadata.get("id2label")
        if isinstance(raw_id2label, dict):
            for key, label in raw_id2label.items():
                try:
                    id2label[int(key)] = str(label)
                except Exception:
                    continue

        if not id2label:
            logger.warning("ONNX extractor is missing id2label metadata: %s", base_dir)
            return None

        bundle_class = (
            str(metadata.get("bundleClass")).strip().lower()
            if metadata.get("bundleClass") is not None
            else "standard"
        )
        allow_bootstrap_bundle = os.environ.get("ML_ALLOW_BOOTSTRAP_BUNDLE", "").lower() in {
            "1",
            "true",
            "yes",
        }
        if (
            bundle_class == "bootstrap"
            and os.environ.get("NODE_ENV") == "production"
            and not allow_bootstrap_bundle
        ):
            logger.warning(
                "Refusing to load bootstrap ONNX bundle in production: %s",
                base_dir,
            )
            return None

        memory_bytes = onnx_path.stat().st_size
        self._reserve_memory(memory_bytes)

        artifact = LoadedOnnxExtractor(
            base_dir=base_dir,
            onnx_path=onnx_path,
            session=session,
            tokenizer=tokenizer,
            id2label=id2label,
            model_version=metadata.get("modelVersion"),
            feature_version=feature_manifest.get("featureVersion")
            or metadata.get("featureVersion"),
            bundle_class=bundle_class,
            preprocessing_spec=preprocessing_spec,
            optimization_manifest=optimization_manifest,
            metadata=metadata,
            memory_bytes=memory_bytes,
        )
        with self._lock:
            self._total_memory += memory_bytes

        logger.info("Loaded ONNX extractor from %s", onnx_path)
        return artifact

    @staticmethod
    def _find_onnx_path(base_dir: Path) -> Path | None:
        candidates = [
            base_dir / "extractor.onnx",
            base_dir / "model.onnx",
            base_dir / "field_extractor.onnx",
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate

        matches = sorted(base_dir.glob("*.onnx"))
        return matches[0] if matches else None

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Failed to read JSON metadata: %s", path, exc_info=True)
            return {}

    @staticmethod
    def _estimate_memory(pipe: Any) -> int:
        try:
            params = sum(
                p.nelement() * p.element_size() for p in pipe.model.parameters()
            )
            buffers = sum(
                b.nelement() * b.element_size() for b in pipe.model.buffers()
            )
            return params + buffers
        except Exception:
            return 500 * 1024 * 1024  # conservative 500 MB fallback

    def _clear_extractor_cache(self) -> None:
        with self._lock:
            extractor = self._extractor
            if extractor is not None:
                self._total_memory = max(0, self._total_memory - extractor.memory_bytes)
            self._extractor = None
            self._extractor_key = None


registry = ModelRegistry()
