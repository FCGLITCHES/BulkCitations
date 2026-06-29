from __future__ import annotations

from contextlib import asynccontextmanager
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field

from app.bundle_validation import validate_bundle_dir
from app.models.loader import registry
from app.models.onnx_extractor import run_onnx_extraction
from app.parsers.docx_parser import extract_text_from_docx
from app.parsers.pdf_parser import extract_text_from_pdf
from app.preprocessing import DEFAULT_PREPROCESSING_SPEC, normalize_inference_text
from app.service_metrics import service_metrics
from app.style_classifier import (
    load_style_bundle,
    load_style_decision_policy,
    predict_style_batch,
)
from app.type_classifier import load_type_bundle, predict_type_batch

logger = logging.getLogger(__name__)

ML_ERROR_CODES = {
    "INFERENCE_TIMEOUT",
    "MODEL_UNAVAILABLE",
    "INTERNAL_ERROR",
    "STYLE_UNSUPPORTED",
    "BAD_REQUEST",
    "CIRCUIT_OPEN",
    "QUEUE_FULL",
}
MAX_BATCH_ITEMS = 128
UNCERTAINTY_THRESHOLDS = {
    "apa": 0.70,
    "mla": 0.70,
    "vancouver": 0.72,
    "ieee": 0.72,
    "harvard": 0.70,
    "chicago": 0.70,
    "unknown": 0.75,
}
STYLE_NORMALIZATION = {
    "apa7": "apa",
    "mla9": "mla",
    "harvard-ctr": "harvard",
    "chicago-author-date": "chicago",
    "chicago-notes-bib": "chicago",
    "vancouver": "vancouver",
    "ieee": "ieee",
    "unknown": "unknown",
}
ARTIFACTS_ROOT = Path(__file__).resolve().parents[1] / "artifacts" / "extractor"
_LAST_SUCCESSFUL_INFERENCE_AT: str | None = None
_WARMUP_READY = False
_WARMUP_ERROR: str | None = None
ML_INGEST_MAX_BYTES = int(os.getenv("ML_INGEST_MAX_BYTES", "2000000"))
ML_ADMIN_SECRET = os.getenv("ML_ADMIN_SECRET", "").strip()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _refresh_runtime_metrics()
    _warm_service()
    yield


app = FastAPI(
    title="BulkReferences ML Service",
    version="1.2.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
#  Request / Response schemas
# ---------------------------------------------------------------------------


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StyleHit(StrictBaseModel):
    style: str
    confidence: float


class StylePrediction(StrictBaseModel):
    decision: Literal[
        "supported_exact",
        "family_only",
        "known_unsupported_exact",
        "unknown_or_ood",
        "not_citation_like",
    ] = "unknown_or_ood"
    family: str = "unknown"
    exactStyle: str | None = None
    knownUnsupportedExact: str | None = None
    supportedExact: bool = False
    abstain: bool = True
    confidence: float = 0.0
    margin: float = 0.0
    oodScore: float = 0.0
    reasonCodes: list[str] = Field(default_factory=list)
    inputProfile: str = "clean-structured"
    heuristicAgreement: bool | None = None
    modelVersion: str | None = None
    featureVersion: str | None = None
    thresholdSetVersion: str | None = None
    policyMode: str | None = None
    calibrationRequiredForPrimary: bool | None = None
    calibrationAvailable: bool | None = None
    primary: StyleHit
    secondary: StyleHit | None = None


class DetectStyleRequest(StrictBaseModel):
    texts: list[str] = Field(default_factory=list)


class ExtractRequest(StrictBaseModel):
    texts: list[str] = Field(default_factory=list)
    styles: list[str] = Field(default_factory=list)


class AuthorRequest(StrictBaseModel):
    authorTexts: list[str] = Field(default_factory=list)


class ClassifyTypeRequest(StrictBaseModel):
    texts: list[str] = Field(default_factory=list)


class ExtractSpan(StrictBaseModel):
    field: str
    tokenStart: int
    tokenEnd: int
    text: str
    confidence: float
    valid: bool


class BioEntityPayload(StrictBaseModel):
    label: str
    field: str
    tokenStart: int
    tokenEnd: int
    charStart: int
    charEnd: int
    text: str
    confidence: float
    valid: bool
    diagnostics: list[str] = Field(default_factory=list)


class BioDiagnosticPayload(StrictBaseModel):
    code: str
    severity: Literal["info", "review", "action"] = "review"
    label: str | None = None
    field: str | None = None
    tokenIndex: int | None = None
    message: str | None = None


class BioPayload(StrictBaseModel):
    tokens: list[str]
    labels: list[str]
    offsets: list[tuple[int, int]]
    labelConfidences: list[float]
    entities: list[BioEntityPayload] = Field(default_factory=list)
    diagnostics: list[BioDiagnosticPayload] = Field(default_factory=list)
    labelSchemaVersion: str
    featureVersion: str | None
    modelVersion: str | None


class ExtractResultPayload(StrictBaseModel):
    fields: dict[str, Any]
    fieldConfidences: dict[str, float]
    fieldUncertainty: dict[str, float] = Field(default_factory=dict)
    overallConfidence: float
    modelVersion: str | None
    featureVersion: str | None
    styleUsed: str
    uncertainFields: list[str]
    entities: list[ExtractSpan] = Field(default_factory=list)
    bio: BioPayload | None = None


class HealthResponse(StrictBaseModel):
    status: Literal["ok", "degraded", "unavailable"]
    activeModelVersion: str | None
    featureVersion: str | None
    bundleClass: str | None = None
    bootstrapBundle: bool = False
    artifactsReady: bool
    lastSuccessfulInferenceAt: str | None
    backend: str
    modelDir: str
    pinnedModelVersion: str | None = None
    styleModelVersion: str | None = None
    styleFeatureVersion: str | None = None
    styleBundleSource: str | None = None
    styleThresholdSetVersion: str | None = None
    stylePolicySource: str | None = None
    typeModelVersion: str | None = None
    typeFeatureVersion: str | None = None
    typeBundleSource: str | None = None
    warmupReady: bool
    warmupError: str | None = None
    bundleValidationErrors: list[str] = Field(default_factory=list)
    bundleValidationWarnings: list[str] = Field(default_factory=list)


class ExtractBatchResponse(StrictBaseModel):
    results: list[ExtractResultPayload | None]
    errors: list[dict[str, Any]] = Field(default_factory=list)


class RuntimeAdminRequest(StrictBaseModel):
    modelVersionPin: str | None = None


class RuntimeAdminResponse(StrictBaseModel):
    modelVersionPin: str | None
    modelDir: str
    health: HealthResponse


def _warm_service() -> None:
    global _WARMUP_READY, _WARMUP_ERROR

    try:
        runtime = _load_extractor_runtime(require_onnx=False)
        _build_extract_result(
            "Smith, J. (2020). Warmup example. Example Journal, 1(1), 1-2.",
            "apa7",
            runtime,
            require_onnx=False,
        )
        _WARMUP_READY = True
        _WARMUP_ERROR = None
    except Exception as exc:  # pragma: no cover - defensive startup path
        logger.exception("ML service warmup failed")
        _WARMUP_READY = False
        _WARMUP_ERROR = str(exc)
    finally:
        _refresh_runtime_metrics()


def _refresh_runtime_metrics() -> None:
    runtime = _load_extractor_runtime(require_onnx=False)
    service_metrics.set_runtime_state(
        backend=runtime["backend"],
        model_version=runtime["activeModelVersion"],
        feature_version=runtime["featureVersion"],
        pinned_model_version=registry.get_model_version_pin(),
        warmup_ready=_WARMUP_READY,
    )


def _runtime_health_response(require_onnx: bool = False) -> HealthResponse:
    runtime = _load_extractor_runtime(require_onnx=require_onnx)
    style_bundle = load_style_bundle()
    style_policy = load_style_decision_policy()
    type_bundle = load_type_bundle()
    validation = validate_bundle_dir(runtime["modelDir"])
    return HealthResponse(
        status=runtime["status"],
        activeModelVersion=runtime["activeModelVersion"],
        featureVersion=runtime["featureVersion"],
        bundleClass=runtime.get("bundleClass"),
        bootstrapBundle=bool(runtime.get("bootstrapBundle")),
        artifactsReady=runtime["artifactsReady"],
        lastSuccessfulInferenceAt=_LAST_SUCCESSFUL_INFERENCE_AT,
        backend=runtime["backend"],
        modelDir=runtime["modelDir"],
        pinnedModelVersion=registry.get_model_version_pin(),
        styleModelVersion=style_bundle.model_version,
        styleFeatureVersion=style_bundle.feature_version,
        styleBundleSource=style_bundle.source,
        styleThresholdSetVersion=style_policy.threshold_set_version,
        stylePolicySource=style_policy.source,
        typeModelVersion=type_bundle.model_version,
        typeFeatureVersion=type_bundle.feature_version,
        typeBundleSource=type_bundle.source,
        warmupReady=_WARMUP_READY,
        warmupError=_WARMUP_ERROR,
        bundleValidationErrors=validation.get("errors", []),
        bundleValidationWarnings=validation.get("warnings", []),
    )


# ---------------------------------------------------------------------------
#  GET /ml/health
# ---------------------------------------------------------------------------


@app.get("/v1/ml/health", response_model=HealthResponse)
@app.get("/ml/health", response_model=HealthResponse)
def health() -> HealthResponse:
    _refresh_runtime_metrics()
    return _runtime_health_response()


# ---------------------------------------------------------------------------
#  POST /ml/detect-style
# ---------------------------------------------------------------------------


@app.post("/v1/ml/detect-style", response_model=list[StylePrediction])
@app.post("/ml/detect-style", response_model=list[StylePrediction])
def detect_style(payload: DetectStyleRequest) -> list[StylePrediction]:
    predictions = predict_style_batch(payload.texts)
    return [StylePrediction.model_validate(prediction) for prediction in predictions]


# ---------------------------------------------------------------------------
#  POST /ml/extract
# ---------------------------------------------------------------------------


def _extract_impl(payload: ExtractRequest, endpoint: str) -> JSONResponse:
    if len(payload.texts) != len(payload.styles):
        raise HTTPException(
            status_code=400,
            detail="texts and styles must have the same length",
        )
    if len(payload.texts) > MAX_BATCH_ITEMS:
        raise HTTPException(
            status_code=400,
            detail=f"maxBatchItems exceeded ({MAX_BATCH_ITEMS})",
        )

    started_at = time.perf_counter()
    cpu_started_at = time.process_time()
    runtime = _load_extractor_runtime()
    results: list[ExtractResultPayload | None] = []
    errors: list[dict[str, Any]] = []
    fallback_used = False

    for index, text in enumerate(payload.texts):
        requested_style = payload.styles[index] if index < len(payload.styles) else "unknown"
        try:
            result = _build_extract_result(text, requested_style, runtime)
            if runtime["backend"] != "onnx" or not runtime["artifactsReady"]:
                fallback_used = True
            results.append(result)
        except Exception as exc:
            logger.exception("extract failed for index %s", index)
            results.append(None)
            errors.append(
                {
                    "index": index,
                    "code": "INTERNAL_ERROR",
                    "message": str(exc),
                }
            )

    global _LAST_SUCCESSFUL_INFERENCE_AT
    if any(result is not None for result in results):
        _LAST_SUCCESSFUL_INFERENCE_AT = datetime.now(timezone.utc).isoformat()

    status_code = 207 if errors else 200
    payload_body = ExtractBatchResponse(results=results, errors=errors)
    service_metrics.observe_request(
        endpoint=endpoint,
        status="error" if errors else "ok",
        latency_seconds=time.perf_counter() - started_at,
        cpu_seconds=time.process_time() - cpu_started_at,
        batch_size=len(payload.texts),
        error_code=errors[0]["code"] if errors else None,
        fallback_reason="heuristic_runtime" if fallback_used else None,
    )
    _refresh_runtime_metrics()
    return JSONResponse(status_code=status_code, content=payload_body.model_dump())


@app.post("/v1/ml/extract", response_model=ExtractBatchResponse)
@app.post("/ml/extract", response_model=ExtractBatchResponse)
def extract(payload: ExtractRequest) -> JSONResponse:
    return _extract_impl(payload, "/v1/ml/extract")


@app.post("/v1/ml/batch-extract", response_model=ExtractBatchResponse)
@app.post("/ml/batch-extract", response_model=ExtractBatchResponse)
def batch_extract(payload: ExtractRequest) -> JSONResponse:
    return _extract_impl(payload, "/v1/ml/batch-extract")


# ---------------------------------------------------------------------------
#  POST /ml/author-ner
# ---------------------------------------------------------------------------


@app.post("/v1/ml/author-ner")
@app.post("/ml/author-ner")
def author_ner(payload: AuthorRequest) -> list[dict[str, Any]]:
    return [_parse_authors(text) for text in payload.authorTexts]


# ---------------------------------------------------------------------------
#  POST /ml/classify-type
# ---------------------------------------------------------------------------


@app.post("/v1/ml/classify-type")
@app.post("/ml/classify-type")
def classify_type(payload: ClassifyTypeRequest) -> list[dict[str, Any]]:
    return predict_type_batch(payload.texts)


# ---------------------------------------------------------------------------
#  POST /ml/ingest-pdf
# ---------------------------------------------------------------------------


@app.post("/v1/ml/ingest-pdf")
@app.post("/ml/ingest-pdf")
async def ingest_pdf(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await _read_bounded_upload(file, "PDF")
    return _run_ingest_parser(data, "PDF", extract_text_from_pdf)


# ---------------------------------------------------------------------------
#  POST /ml/ingest-docx
# ---------------------------------------------------------------------------


@app.post("/v1/ml/ingest-docx")
@app.post("/ml/ingest-docx")
async def ingest_docx(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await _read_bounded_upload(file, "DOCX")
    return _run_ingest_parser(data, "DOCX", extract_text_from_docx)


@app.get("/metrics", response_class=PlainTextResponse)
def metrics() -> PlainTextResponse:
    _refresh_runtime_metrics()
    return PlainTextResponse(
        service_metrics.render_prometheus(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


@app.get("/v1/ml/admin/runtime", response_model=RuntimeAdminResponse)
@app.get("/ml/admin/runtime", response_model=RuntimeAdminResponse)
def get_runtime_admin(
    x_ml_admin_secret: str | None = Header(default=None),
) -> RuntimeAdminResponse:
    require_runtime_admin_secret(x_ml_admin_secret)
    _refresh_runtime_metrics()
    health_response = _runtime_health_response()
    return RuntimeAdminResponse(
        modelVersionPin=registry.get_model_version_pin(),
        modelDir=health_response.modelDir,
        health=health_response,
    )


@app.put("/v1/ml/admin/runtime", response_model=RuntimeAdminResponse)
@app.put("/ml/admin/runtime", response_model=RuntimeAdminResponse)
def put_runtime_admin(
    payload: RuntimeAdminRequest,
    x_ml_admin_secret: str | None = Header(default=None),
) -> RuntimeAdminResponse:
    require_runtime_admin_secret(x_ml_admin_secret)
    registry.set_model_version_pin(payload.modelVersionPin)
    _warm_service()
    health_response = _runtime_health_response()
    return RuntimeAdminResponse(
        modelVersionPin=registry.get_model_version_pin(),
        modelDir=health_response.modelDir,
        health=health_response,
    )


# ===================================================================
#  Heuristic helpers
# ===================================================================


def _load_extractor_runtime(require_onnx: bool = False) -> dict[str, Any]:
    artifact = registry.get_extractor_artifact(require_onnx=require_onnx)
    if artifact is not None:
        return {
            "status": "ok",
            "activeModelVersion": artifact.model_version or "onnx-extractor",
            "featureVersion": artifact.feature_version or "onnx-features",
            "bundleClass": artifact.bundle_class or "standard",
            "bootstrapBundle": artifact.bundle_class == "bootstrap",
            "artifactsReady": True,
            "backend": "onnx",
            "modelDir": str(artifact.base_dir),
            "preprocessingSpec": artifact.preprocessing_spec,
            "optimizationManifest": artifact.optimization_manifest,
        }

    if require_onnx:
        return {
            "status": "degraded",
            "activeModelVersion": None,
            "featureVersion": None,
            "bundleClass": None,
            "bootstrapBundle": False,
            "artifactsReady": False,
            "backend": "missing",
            "modelDir": str(registry.resolve_model_dir()),
            "preprocessingSpec": dict(DEFAULT_PREPROCESSING_SPEC),
            "optimizationManifest": {},
        }

    current_dir = ARTIFACTS_ROOT / "current"
    metadata_path = current_dir / "metadata.json"
    feature_path = current_dir / "feature_manifest.json"

    if metadata_path.exists():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            feature_manifest = (
                json.loads(feature_path.read_text(encoding="utf-8"))
                if feature_path.exists()
                else {}
            )
            feature_version = (
                feature_manifest.get("featureVersion")
                or metadata.get("featureVersion")
            )
            return {
                "status": "degraded",
                "activeModelVersion": metadata.get("modelVersion") or "heuristic-v2",
                "featureVersion": feature_version or "heuristic-features-v2",
                "bundleClass": metadata.get("bundleClass"),
                "bootstrapBundle": metadata.get("bundleClass") == "bootstrap",
                "artifactsReady": False,
                "backend": "heuristic",
                "modelDir": str(registry.resolve_model_dir()),
                "preprocessingSpec": dict(DEFAULT_PREPROCESSING_SPEC),
                "optimizationManifest": {},
            }
        except Exception:
            logger.exception("failed to load extractor runtime metadata")

    return {
        "status": "ok",
        "activeModelVersion": "heuristic-v2",
        "featureVersion": "heuristic-features-v2",
        "bundleClass": None,
        "bootstrapBundle": False,
        "artifactsReady": False,
        "backend": "heuristic",
        "modelDir": str(registry.resolve_model_dir()),
        "preprocessingSpec": dict(DEFAULT_PREPROCESSING_SPEC),
        "optimizationManifest": {},
    }


def _normalize_requested_style(style: str) -> str:
    return STYLE_NORMALIZATION.get(style, "unknown")


def _uncertainty_threshold(style_used: str) -> float:
    return UNCERTAINTY_THRESHOLDS.get(style_used, UNCERTAINTY_THRESHOLDS["unknown"])


def require_runtime_admin_secret(provided_secret: str | None) -> None:
    if not ML_ADMIN_SECRET:
        raise HTTPException(
            status_code=503,
            detail="ML runtime admin controls are disabled until ML_ADMIN_SECRET is configured.",
        )

    if provided_secret == ML_ADMIN_SECRET:
        return

    raise HTTPException(status_code=403, detail="ML runtime admin secret was invalid.")


async def _read_bounded_upload(file: UploadFile, label: str) -> bytes:
    data = await file.read(ML_INGEST_MAX_BYTES + 1)
    if len(data) > ML_INGEST_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Uploaded {label} exceeded the {ML_INGEST_MAX_BYTES}-byte limit",
        )
    return data


def _run_ingest_parser(
    data: bytes,
    label: str,
    parser: Callable[[bytes], dict[str, Any]],
) -> dict[str, Any]:
    try:
        return parser(data)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Rejected invalid %s upload", label, exc_info=exc)
        raise HTTPException(
            status_code=400,
            detail=f"Uploaded {label} could not be parsed.",
        ) from exc

# -- Style detection ---------------------------------------------------

_STYLE_PATTERNS: list[tuple[str, re.Pattern[str], float, str | None, float | None]] = [
    ("vancouver", re.compile(r"^\s*\[\d+\]"), 0.90, "ieee", 0.78),
    ("ieee", re.compile(r"^\s*\d+[.)\]]"), 0.88, "vancouver", 0.73),
    (
        "apa7",
        re.compile(
            r"\([A-Z][a-z]+(?:\s+(?:&|and)\s+[A-Z][a-z]+)*,?\s*\d{4}[a-z]?\)"
        ),
        0.92,
        "harvard-ctr",
        0.65,
    ),
    ("apa7", re.compile(r"\(\d{4}[a-z]?\)"), 0.85, "harvard-ctr", 0.61),
    ("acs", re.compile(r"^\s*\(\d+\)\s"), 0.83, "apa7", 0.55),
    ("mla9", re.compile(r"[\u201c\u201d\u0022].+?[\u201c\u201d\u0022]"), 0.80, "chicago-notes-bib", 0.55),
    ("chicago-notes-bib", re.compile(r"^\s*\d+\.\s"), 0.78, "chicago-author-date", 0.60),
    ("harvard-ctr", re.compile(r"\([A-Z][a-z]+ \d{4}\)"), 0.82, "apa7", 0.70),
    ("ama", re.compile(r"^\s*\d+\.\s+[A-Z].*\d{4};\d+"), 0.84, "vancouver", 0.60),
]


def _heuristic_style(text: str) -> StylePrediction:
    for style, pattern, conf, sec_style, sec_conf in _STYLE_PATTERNS:
        if pattern.search(text):
            secondary = (
                StyleHit(style=sec_style, confidence=sec_conf) if sec_style else None
            )
            return StylePrediction(
                primary=StyleHit(style=style, confidence=conf),
                secondary=secondary,
            )
    return StylePrediction(primary=StyleHit(style="unknown", confidence=0.40))


# -- Field extraction --------------------------------------------------

_DOI_RE = re.compile(r"10\.\d{4,9}/[^\s\"'<>\]]+")
_URL_RE = re.compile(r"https?://[^\s\"'<>\]]+")
_YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
_PAGES_RE = re.compile(r"\b(\d{1,5})\s*[-\u2013\u2014]\s*(\d{1,5})\b")
_VOL_ISSUE_RE = re.compile(r"\b(\d+)\s*\((\d+(?:-\d+)?)\)")
_VOL_ONLY_RE = re.compile(r"(?:vol(?:ume)?\.?\s*)(\d+)", re.IGNORECASE)
_JOURNAL_VOL_ISSUE_NO_PAGES_RE = re.compile(
    r"(?P<journal>.+?),\s*(?:vol\.?\s*)?(?P<volume>\d+)(?:\s*\((?P<issue_paren>[^)]+)\)|,\s*no\.?\s*(?P<issue_word>[^,.]+))\.?$",
    re.IGNORECASE,
)


def _heuristic_extract(text: str) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    field_confidences: dict[str, float] = {}
    warnings: list[str] = []

    doi = _DOI_RE.search(text)
    if doi:
        fields["doi"] = doi.group(0).rstrip(".")
        field_confidences["doi"] = 0.95

    url = _URL_RE.search(text)
    if url and not doi:
        fields["url"] = url.group(0).rstrip(".")
        field_confidences["url"] = 0.90

    year_m = _YEAR_RE.search(text)
    if year_m:
        fields["year"] = int(year_m.group(1))
        field_confidences["year"] = 0.92

    pages = _PAGES_RE.search(text)
    if pages:
        fields["pages"] = f"{pages.group(1)}-{pages.group(2)}"
        field_confidences["pages"] = 0.88

    vi = _VOL_ISSUE_RE.search(text)
    if vi:
        fields["volume"] = vi.group(1)
        fields["issue"] = vi.group(2)
        field_confidences["volume"] = 0.87
        field_confidences["issue"] = 0.84
    else:
        vol = _VOL_ONLY_RE.search(text)
        if vol:
            fields["volume"] = vol.group(1)
            field_confidences["volume"] = 0.80

    at = _extract_authors_title(text, year_m)
    if at:
        if at.get("authors"):
            fields["authors"] = _parse_authors(at["authors"])["authors"]
            field_confidences["authors"] = 0.70
            if not _is_valid_author_span_text(at["authors"]):
                warnings.append("invalid_author_span")
        if at.get("title"):
            fields["title"] = at["title"]
            field_confidences["title"] = 0.72
        if at.get("journal"):
            fields["journal"] = at["journal"]
            field_confidences["journal"] = 0.68

    if "journal" not in fields:
        missing_pages_journal = _JOURNAL_VOL_ISSUE_NO_PAGES_RE.search(text)
        if missing_pages_journal:
            journal = missing_pages_journal.group("journal").strip().rstrip(".")
            if journal:
                fields["journal"] = journal
                field_confidences["journal"] = max(field_confidences.get("journal", 0.0), 0.68)
            if "volume" not in fields and missing_pages_journal.group("volume"):
                fields["volume"] = missing_pages_journal.group("volume")
                field_confidences["volume"] = max(field_confidences.get("volume", 0.0), 0.80)
            issue = missing_pages_journal.group("issue_paren") or missing_pages_journal.group("issue_word")
            if "issue" not in fields and issue:
                fields["issue"] = issue.strip()
                field_confidences["issue"] = max(field_confidences.get("issue", 0.0), 0.76)

    conf_parts = list(field_confidences.values())
    avg = sum(conf_parts) / len(conf_parts) if conf_parts else 0.40
    return {
        "fields": fields,
        "fieldConfidences": field_confidences,
        "warnings": warnings,
        "referenceConfidence": round(avg, 3),
    }


def _extract_authors_title(
    text: str, year_match: re.Match[str] | None
) -> dict[str, str] | None:
    if not year_match:
        return None
    result: dict[str, str] = {}

    before = text[: year_match.start()].strip().rstrip("(").strip()
    after = text[year_match.end() :].strip().lstrip(")").lstrip(".").strip()

    if before:
        before = re.sub(r"^(?:\[\d+\]|\d+[.)\]])\s*", "", before).strip()
        if before:
            result["authors"] = before.rstrip(",").strip()

    if after:
        segments = re.split(r"\.\s+", after, maxsplit=2)
        if segments:
            result["title"] = segments[0].strip().rstrip(".")
        if len(segments) > 1:
            result["journal"] = segments[1].split(",")[0].strip().rstrip(".")

    return result or None


def _build_extract_result(
    text: str,
    requested_style: str,
    runtime: dict[str, Any],
    require_onnx: bool = False,
) -> ExtractResultPayload:
    style_used = _normalize_requested_style(requested_style)
    preprocessed_text = normalize_inference_text(
        text,
        runtime.get("preprocessingSpec") or DEFAULT_PREPROCESSING_SPEC,
    )
    if not preprocessed_text:
        raise ValueError("reference text is empty after preprocessing")

    evidence = run_onnx_extraction(preprocessed_text)
    if evidence is None:
        if require_onnx:
            raise RuntimeError("ONNX extractor is not available.")
        evidence = _heuristic_extract(preprocessed_text)
    bio = evidence.get("bio") if isinstance(evidence.get("bio"), dict) else None
    if bio:
        entities = _build_spans_from_bio(bio)
    else:
        tokens, token_ranges = _tokenize_with_offsets(preprocessed_text)
        entities = _build_spans_from_fields(
            preprocessed_text,
            tokens,
            token_ranges,
            evidence["fields"],
            evidence["fieldConfidences"],
            evidence["warnings"],
        )
    threshold = _uncertainty_threshold(style_used)
    uncertain_fields = sorted(
        field
        for field, confidence in evidence["fieldConfidences"].items()
        if confidence < threshold
    )

    return ExtractResultPayload(
        fields=evidence["fields"],
        fieldConfidences=evidence["fieldConfidences"],
        fieldUncertainty={
            field: round(max(0.0, 1 - confidence), 4)
            for field, confidence in evidence["fieldConfidences"].items()
        },
        overallConfidence=evidence["referenceConfidence"],
        modelVersion=runtime["activeModelVersion"],
        featureVersion=runtime["featureVersion"],
        styleUsed=style_used,
        uncertainFields=uncertain_fields,
        entities=entities,
        bio=BioPayload.model_validate(bio) if bio else None,
    )


def _tokenize_with_offsets(text: str) -> tuple[list[str], list[tuple[int, int]]]:
    tokens: list[str] = []
    offsets: list[tuple[int, int]] = []
    for match in re.finditer(r"\S+", text):
        tokens.append(match.group(0))
        offsets.append((match.start(), match.end()))
    return tokens, offsets


def _build_spans_from_fields(
    text: str,
    tokens: list[str],
    offsets: list[tuple[int, int]],
    fields: dict[str, Any],
    field_confidences: dict[str, float],
    warnings: list[str],
) -> list[ExtractSpan]:
    occupied: set[int] = set()
    spans: list[ExtractSpan] = []

    for field, value in fields.items():
        span_text = _field_span_text(field, value)
        if not span_text:
            continue
        window = _find_token_window(
            text,
            tokens,
            offsets,
            span_text,
            occupied,
            allow_overlap=field in {"volume", "issue"},
        )
        if window is None:
            continue
        token_start, token_end = window
        for idx in range(token_start, token_end):
            occupied.add(idx)
        valid = field != "authors" or "invalid_author_span" not in warnings
        spans.append(
            ExtractSpan(
                field=field,
                tokenStart=token_start,
                tokenEnd=token_end,
                text=text[offsets[token_start][0] : offsets[token_end - 1][1]],
                confidence=field_confidences.get(field, 0.5),
                valid=valid,
            )
        )

    return spans


def _build_spans_from_bio(bio: dict[str, Any]) -> list[ExtractSpan]:
    spans: list[ExtractSpan] = []
    for entity in bio.get("entities", []):
        if not isinstance(entity, dict):
            continue
        spans.append(
            ExtractSpan(
                field=str(entity.get("field") or entity.get("label") or ""),
                tokenStart=int(entity.get("tokenStart") or 0),
                tokenEnd=int(entity.get("tokenEnd") or 0),
                text=str(entity.get("text") or ""),
                confidence=float(entity.get("confidence") or 0.0),
                valid=bool(entity.get("valid", True)),
            )
        )
    return spans


def _field_span_text(field: str, value: Any) -> str | None:
    if field in {"authors", "editors"}:
        if not isinstance(value, list) or not value:
            return None
        pieces: list[str] = []
        for author in value:
            if not isinstance(author, dict):
                continue
            literal = str(author.get("literal", "") or "").strip()
            if literal:
                pieces.append(literal)
                continue
            family = str(author.get("family", "") or "").strip()
            given = str(author.get("given", "") or "").strip()
            if family and given:
                pieces.append(f"{family}, {given}")
            elif family:
                pieces.append(family)
        return "; ".join(pieces) if pieces else None

    if field == "year":
        return str(value) if value is not None else None

    if isinstance(value, str):
        return value.strip() or None

    return None


def _find_token_window(
    text: str,
    tokens: list[str],
    offsets: list[tuple[int, int]],
    span_text: str,
    occupied: set[int],
    allow_overlap: bool = False,
) -> tuple[int, int] | None:
    needle = _normalize_lookup(span_text)
    if not needle:
        return None

    for start in range(len(tokens)):
        if start in occupied:
            continue
        candidate = ""
        for end in range(start, len(tokens)):
            if end in occupied:
                break
            candidate = _normalize_lookup(" ".join(tokens[start : end + 1]))
            if candidate == needle:
                return start, end + 1
            if len(candidate) > len(needle) + 4:
                break

    escaped = re.escape(span_text.strip())
    if not escaped:
        return None

    for match in re.finditer(escaped, text, flags=re.IGNORECASE):
        token_window = _token_window_from_offsets(offsets, match.start(), match.end())
        if token_window is None:
            continue
        if not allow_overlap and any(idx in occupied for idx in range(token_window[0], token_window[1])):
            continue
        return token_window

    return None


def _token_window_from_offsets(
    offsets: list[tuple[int, int]], start_offset: int, end_offset: int
) -> tuple[int, int] | None:
    token_start = -1
    token_end = -1

    for idx, (start, end) in enumerate(offsets):
        if token_start == -1 and end > start_offset:
            token_start = idx
        if start < end_offset:
            token_end = idx + 1

    if token_start == -1 or token_end == -1 or token_start >= token_end:
        return None

    return token_start, token_end


def _normalize_lookup(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^0-9a-z]+", " ", value.lower())).strip()


def _is_valid_author_span_text(value: str) -> bool:
    normalized = value.strip().rstrip(".;,")
    if not normalized:
        return False
    if "," in normalized or re.search(r"\s+(and|&)\s+", normalized, re.IGNORECASE):
        return True
    words = [w for w in normalized.split() if w]
    if len(words) >= 2:
        return True
    if len(words) == 1 and (re.fullmatch(r"[A-Z]{2,}", words[0]) or re.fullmatch(r"[A-Z][a-z]{2,}", words[0])):
        return True
    return False


# -- Transformer entity → field mapping --------------------------------

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
}


def _entities_to_fields(entities: list[dict[str, Any]]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    current_label = ""
    current_tokens: list[str] = []

    for ent in entities:
        label = ent.get("entity", ent.get("entity_group", "O"))
        word = ent.get("word", "")
        bio = label[:2] if len(label) > 2 else ""
        core = label[2:] if bio in ("B-", "I-") else label

        if bio == "B-" or core != current_label:
            if current_label and current_tokens:
                _merge_field(fields, current_label, current_tokens)
            current_label = core
            current_tokens = [word]
        else:
            current_tokens.append(word)

    if current_label and current_tokens:
        _merge_field(fields, current_label, current_tokens)
    return fields


def _merge_field(
    fields: dict[str, Any], label: str, tokens: list[str]
) -> None:
    key = _LABEL_MAP.get(label.lower(), label.lower())
    text = _detokenize(tokens)
    if key == "year":
        m = re.search(r"\d{4}", text)
        if m:
            fields[key] = int(m.group())
        return
    if key in fields:
        existing = fields[key]
        fields[key] = f"{existing}; {text}" if isinstance(existing, str) else text
    else:
        fields[key] = text


def _detokenize(tokens: list[str]) -> str:
    out: list[str] = []
    for tok in tokens:
        if tok.startswith("##"):
            if out:
                out[-1] += tok[2:]
            else:
                out.append(tok[2:])
        else:
            out.append(tok)
    return " ".join(out)


# -- Author parsing ----------------------------------------------------

_CORPORATE_HINTS = frozenset(
    [
        "organization",
        "organisation",
        "association",
        "university",
        "agency",
        "institute",
        "ministry",
        "department",
        "commission",
        "committee",
        "foundation",
        "corporation",
        "company",
        "group",
        "council",
        "society",
        "board",
        "center",
        "centre",
        "bureau",
    ]
)

_CJK_RANGES = (
    ("\u4e00", "\u9fff"),
    ("\u3400", "\u4dbf"),
    ("\uac00", "\ud7af"),
    ("\u3040", "\u309f"),
    ("\u30a0", "\u30ff"),
)


def _is_cjk(char: str) -> bool:
    return any(lo <= char <= hi for lo, hi in _CJK_RANGES)


def _has_cjk(text: str) -> bool:
    return any(_is_cjk(c) for c in text)


def _looks_like_given(text: str) -> bool:
    """Return True when *text* looks like a given-name or initials fragment."""
    text = text.strip().rstrip(".")
    if not text:
        return False
    if re.match(r"^[A-Z]\.?(\s+[A-Z]\.?)*$", text):
        return True
    words = text.split()
    return len(words) <= 2 and all(len(w) <= 12 for w in words) and text[0].isupper()


def _parse_single_author(raw: str) -> dict[str, Any]:
    raw = raw.strip().rstrip(".")
    if not raw:
        return {
            "family": "",
            "given": None,
            "isCorporate": False,
        }

    lowered = raw.lower()
    if any(hint in lowered for hint in _CORPORATE_HINTS):
        return {
            "family": raw,
            "given": None,
            "literal": raw,
            "isCorporate": True,
        }

    if _has_cjk(raw):
        chars = [c for c in raw if not c.isspace()]
        family = chars[0] if chars else raw
        given = "".join(chars[1:]) if len(chars) > 1 else None
        return {
            "family": family,
            "given": given,
            "isCorporate": False,
        }

    if "," in raw:
        parts = [p.strip() for p in raw.split(",", 1)]
        family = parts[0]
        given = parts[1] if len(parts) > 1 and parts[1] else None
    else:
        bits = raw.split()
        if len(bits) == 1:
            return {
                "family": bits[0],
                "given": None,
                "isCorporate": False,
            }
        family = bits[-1]
        given = " ".join(bits[:-1])

    return {
        "family": family,
        "given": given,
        "isCorporate": False,
    }


def _parse_authors(text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        return {"authors": [], "confidence": 0.0}

    has_et_al = False
    cleaned = text
    if re.search(r"\bet\s+al\.?", cleaned, re.IGNORECASE):
        has_et_al = True
        cleaned = re.sub(
            r",?\s*\bet\s+al\.?", "", cleaned, flags=re.IGNORECASE
        ).strip()

    authors_raw: list[str] = _split_author_string(cleaned)
    authors = [_parse_single_author(a) for a in authors_raw if a]

    if has_et_al and authors:
        authors.append(
            {
                "family": "et al.",
                "given": None,
                "isCorporate": False,
                "isEtAl": True,
            }
        )

    confidence = 0.82 if len(authors) <= 3 else 0.72
    return {"authors": authors, "confidence": confidence}


def _split_author_string(text: str) -> list[str]:
    if ";" in text:
        return [a.strip() for a in text.split(";") if a.strip()]

    if re.search(r"\s+(?:and|&)\s+", text):
        chunks = re.split(r"\s+(?:and|&)\s+", text)
        out: list[str] = []
        for chunk in chunks:
            out.extend(_split_comma_chunk(chunk))
        return out

    if "," in text:
        return _split_comma_chunk(text)

    return [text]


def _split_comma_chunk(chunk: str) -> list[str]:
    """Split a comma-separated chunk, pairing 'Last, Given' when possible."""
    sub = [s.strip() for s in chunk.split(",")]
    if len(sub) == 2:
        return [chunk.strip()]
    result: list[str] = []
    i = 0
    while i < len(sub):
        if i + 1 < len(sub) and _looks_like_given(sub[i + 1]):
            result.append(f"{sub[i]}, {sub[i + 1]}")
            i += 2
        else:
            result.append(sub[i])
            i += 1
    return result


# -- Type classification -----------------------------------------------


def _heuristic_classify(text: str) -> dict[str, Any]:
    low = text.lower()
    scores: dict[str, float] = {}

    if "http://" in low or "https://" in low or "www." in low:
        scores["webpage"] = 0.85
        if "retrieved" in low or "accessed" in low:
            scores["webpage"] = min(scores["webpage"] + 0.05, 0.98)

    if re.search(r"\b\d+\s*\(\d+\)", text):
        scores["article-journal"] = 0.80
    if re.search(r"(?i)\bjournal\b", text):
        scores["article-journal"] = max(scores.get("article-journal", 0.0), 0.75)
    if re.search(r"\b\d+[-\u2013]\d+\b", text) and re.search(r"\b\d{4}\b", text):
        scores["article-journal"] = max(scores.get("article-journal", 0.0), 0.65)

    if any(kw in low for kw in ("press", "publisher", "publishing", "edition", "eds.")):
        scores["book"] = 0.78
    if re.search(r"(?i)\bISBN\b", text):
        scores["book"] = max(scores.get("book", 0.0), 0.88)

    if any(kw in low for kw in ("proceedings", "conference", "symposium", "workshop")):
        scores["conference-paper"] = 0.82

    if any(kw in low for kw in ("thesis", "dissertation")):
        scores["thesis"] = 0.90

    if re.search(r"(?i)\bIn\b.*\bed(?:s)?\.?\b", text):
        scores["book-chapter"] = 0.76

    if any(kw in low for kw in ("report", "technical report", "working paper")):
        scores["report"] = 0.80

    if "patent" in low:
        scores["patent"] = 0.92

    if any(kw in low for kw in ("newspaper", "times", "post", "herald", "guardian")):
        scores["newspaper-article"] = max(
            scores.get("newspaper-article", 0.0), 0.65
        )

    if not scores:
        return {"type": "unknown", "confidence": 0.40}

    best = max(scores, key=lambda k: scores[k])
    return {"type": best, "confidence": round(min(scores[best], 0.98), 2)}
