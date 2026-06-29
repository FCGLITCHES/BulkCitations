# ADR 0001: Use ONNX Runtime For V1 Extraction

Status: Accepted  
Date: 2026-04-05  
Review trigger: Supersede if the serving runtime or model artifact format changes.

## Decision

Use ONNX Runtime as the v1 model execution format for phase-4 extraction.

## Context

The repo needs a deployable model format that:
- can run efficiently on CPU
- can be loaded locally by the Python ML service
- supports immutable bundle promotion
- works cleanly with offline evaluation and rollback

## Alternatives Considered

- PyTorch checkpoints served directly
- TorchScript
- Triton-first deployment model
- hosted external inference service

## Consequences

- Model training stays external, but the promotion target is a portable ONNX bundle.
- Serving remains CPU-friendly and self-contained.
- Bundle validation and reproducibility become easier to standardize.
- The system accepts some export and optimization complexity in exchange for predictable deployment behavior.

## Why This Holds For V1

ONNX Runtime matches the repo’s current deployment needs better than a more heavyweight serving stack. It is good enough for single-model CPU inference while leaving room for future serving changes in later versions.

**Status (2026-06-25):** still in effect. The phase-4 BIO extractor is served via `onnxruntime` (`ort.InferenceSession`, `CPUExecutionProvider`) in `ml-service/app/models/loader.py` / `onnx_extractor.py`, loading an `extractor.onnx` bundle.
