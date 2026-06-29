# ADR 0002: Use FastAPI As The V1 Serving Layer

Status: Accepted  
Date: 2026-04-05  
Review trigger: Supersede if the repo adopts a dedicated model-serving platform.

## Decision

Use FastAPI as the v1 Python serving layer for the ONNX extraction service.

## Context

The service needs:
- strict request and response validation
- a small operational footprint
- simple local development
- warm startup and batch-serving support
- straightforward integration with the existing Node server

## Alternatives Considered

- Triton Inference Server
- custom ASGI service without a framework
- Flask
- direct in-process model hosting inside Node

## Consequences

- FastAPI provides a pragmatic middle ground between control and simplicity.
- The service can expose health, metrics, extract, and batch-extract endpoints without extra infrastructure.
- The system avoids introducing a heavyweight serving platform before v1 is stable.

## Why This Holds For V1

FastAPI is sufficient for a single-model ONNX extractor with validation, warmup, batching, and operational endpoints. More specialized serving layers remain a future option if v1 throughput or operational constraints justify them.

**Status (2026-06-25):** still in effect. `ml-service/app/main.py` is a FastAPI app (currently `version="1.2.0"`) with pydantic request/response models, a warmup lifespan hook, batch-extract (`MAX_BATCH_ITEMS=128`), and health/metrics endpoints.
