from __future__ import annotations

import math
import threading
import time
from collections import defaultdict
from typing import Any


def _escape_label_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _render_labels(labels: dict[str, str]) -> str:
    if not labels:
        return ""
    parts = [f'{key}="{_escape_label_value(value)}"' for key, value in labels.items()]
    return "{" + ",".join(parts) + "}"


def _process_memory_bytes() -> int:
    try:
        import psutil  # type: ignore

        return int(psutil.Process().memory_info().rss)
    except Exception:
        pass

    try:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF)
        rss = int(getattr(usage, "ru_maxrss", 0))
        if rss <= 0:
            return 0
        if rss < 10_000_000:
            return rss * 1024
        return rss
    except Exception:
        return 0


class ServiceMetrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._request_total: dict[tuple[str, str], int] = defaultdict(int)
        self._request_errors_total: dict[tuple[str, str], int] = defaultdict(int)
        self._latency_bucket_total: dict[tuple[str, str], int] = defaultdict(int)
        self._latency_sum: dict[str, float] = defaultdict(float)
        self._latency_count: dict[str, int] = defaultdict(int)
        self._batch_bucket_total: dict[tuple[str, str], int] = defaultdict(int)
        self._batch_sum: dict[str, int] = defaultdict(int)
        self._batch_count: dict[str, int] = defaultdict(int)
        self._fallback_total: dict[str, int] = defaultdict(int)
        self._cpu_seconds_total = 0.0
        self._warmup_ready = False
        self._backend = "unknown"
        self._model_version = "unknown"
        self._feature_version = "unknown"
        self._pinned_model_version = "none"
        self._memory_bytes = 0
        self._latency_buckets = (0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, math.inf)
        self._batch_buckets = (1, 4, 8, 16, 32, 64, 128, math.inf)

    def observe_request(
        self,
        endpoint: str,
        status: str,
        latency_seconds: float,
        cpu_seconds: float,
        batch_size: int,
        error_code: str | None = None,
        fallback_reason: str | None = None,
    ) -> None:
        with self._lock:
            self._request_total[(endpoint, status)] += 1
            if error_code:
                self._request_errors_total[(endpoint, error_code)] += 1
            if fallback_reason:
                self._fallback_total[fallback_reason] += 1
            self._cpu_seconds_total += max(cpu_seconds, 0.0)
            self._memory_bytes = _process_memory_bytes()

            self._latency_sum[endpoint] += max(latency_seconds, 0.0)
            self._latency_count[endpoint] += 1
            for bucket in self._latency_buckets:
                if latency_seconds <= bucket:
                    key = (endpoint, "+Inf" if math.isinf(bucket) else f"{bucket:g}")
                    self._latency_bucket_total[key] += 1

            self._batch_sum[endpoint] += batch_size
            self._batch_count[endpoint] += 1
            for bucket in self._batch_buckets:
                if batch_size <= bucket:
                    key = (endpoint, "+Inf" if math.isinf(bucket) else str(int(bucket)))
                    self._batch_bucket_total[key] += 1

    def set_runtime_state(
        self,
        *,
        backend: str,
        model_version: str | None,
        feature_version: str | None,
        pinned_model_version: str | None,
        warmup_ready: bool,
    ) -> None:
        with self._lock:
            self._backend = backend or "unknown"
            self._model_version = model_version or "unknown"
            self._feature_version = feature_version or "unknown"
            self._pinned_model_version = pinned_model_version or "none"
            self._warmup_ready = warmup_ready
            self._memory_bytes = _process_memory_bytes()

    def render_prometheus(self) -> str:
        with self._lock:
            lines = [
                "# HELP ml_service_requests_total Total requests handled by the ML service.",
                "# TYPE ml_service_requests_total counter",
            ]
            for (endpoint, status), value in sorted(self._request_total.items()):
                lines.append(
                    f"ml_service_requests_total{_render_labels({'endpoint': endpoint, 'status': status})} {value}"
                )

            lines.extend(
                [
                    "# HELP ml_service_request_errors_total Total ML service request errors by code.",
                    "# TYPE ml_service_request_errors_total counter",
                ]
            )
            for (endpoint, code), value in sorted(self._request_errors_total.items()):
                lines.append(
                    f"ml_service_request_errors_total{_render_labels({'endpoint': endpoint, 'code': code})} {value}"
                )

            lines.extend(
                [
                    "# HELP ml_service_request_latency_seconds Request latency histogram in seconds.",
                    "# TYPE ml_service_request_latency_seconds histogram",
                ]
            )
            for endpoint in sorted(self._latency_count):
                cumulative = 0
                for bucket in self._latency_buckets:
                    bucket_key = "+Inf" if math.isinf(bucket) else f"{bucket:g}"
                    cumulative = self._latency_bucket_total.get((endpoint, bucket_key), cumulative)
                    lines.append(
                        f"ml_service_request_latency_seconds_bucket{_render_labels({'endpoint': endpoint, 'le': bucket_key})} {cumulative}"
                    )
                lines.append(
                    f"ml_service_request_latency_seconds_sum{_render_labels({'endpoint': endpoint})} {self._latency_sum[endpoint]}"
                )
                lines.append(
                    f"ml_service_request_latency_seconds_count{_render_labels({'endpoint': endpoint})} {self._latency_count[endpoint]}"
                )

            lines.extend(
                [
                    "# HELP ml_service_batch_size Batch-size histogram for extract endpoints.",
                    "# TYPE ml_service_batch_size histogram",
                ]
            )
            for endpoint in sorted(self._batch_count):
                cumulative = 0
                for bucket in self._batch_buckets:
                    bucket_key = "+Inf" if math.isinf(bucket) else str(int(bucket))
                    cumulative = self._batch_bucket_total.get((endpoint, bucket_key), cumulative)
                    lines.append(
                        f"ml_service_batch_size_bucket{_render_labels({'endpoint': endpoint, 'le': bucket_key})} {cumulative}"
                    )
                lines.append(
                    f"ml_service_batch_size_sum{_render_labels({'endpoint': endpoint})} {self._batch_sum[endpoint]}"
                )
                lines.append(
                    f"ml_service_batch_size_count{_render_labels({'endpoint': endpoint})} {self._batch_count[endpoint]}"
                )

            lines.extend(
                [
                    "# HELP ml_service_fallbacks_total Total fallback events by reason.",
                    "# TYPE ml_service_fallbacks_total counter",
                ]
            )
            for reason, value in sorted(self._fallback_total.items()):
                lines.append(
                    f"ml_service_fallbacks_total{_render_labels({'reason': reason})} {value}"
                )

            lines.extend(
                [
                    "# HELP ml_service_cpu_seconds_total CPU time consumed by ML requests.",
                    "# TYPE ml_service_cpu_seconds_total counter",
                    f"ml_service_cpu_seconds_total {self._cpu_seconds_total}",
                    "# HELP ml_service_process_memory_bytes Best-effort process memory usage in bytes.",
                    "# TYPE ml_service_process_memory_bytes gauge",
                    f"ml_service_process_memory_bytes {self._memory_bytes}",
                    "# HELP ml_service_warmup_ready Whether the ML service completed startup warmup.",
                    "# TYPE ml_service_warmup_ready gauge",
                    f"ml_service_warmup_ready {1 if self._warmup_ready else 0}",
                    "# HELP ml_service_runtime_info Current runtime metadata for the active ML service.",
                    "# TYPE ml_service_runtime_info gauge",
                    f"ml_service_runtime_info{_render_labels({'backend': self._backend, 'model_version': self._model_version, 'feature_version': self._feature_version, 'pinned_model_version': self._pinned_model_version})} 1",
                ]
            )

            return "\n".join(lines) + "\n"


service_metrics = ServiceMetrics()
