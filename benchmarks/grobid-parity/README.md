# GROBID-Parity Benchmarks

This folder is reserved for engine v2 parity gates against GROBID-style
benchmarks.

## Required Evaluation Levels

- Intrinsic reference parsing: gold reference string to structured fields.
- Extraction plus parsing: PDF bibliography section to structured references.
- End-to-end: PDF to references, parsed fields, and citation-context linking.

## Required Metrics

- Field precision, recall, and F1.
- Exact and soft field match.
- Reference splitting accuracy.
- Citation-linking F1.
- Documents per second, references per second, p50 latency, and p95 latency.
- Memory per worker and GPU utilization when applicable.

Keep the existing v1 benchmark scripts in place. Engine v2 gates should reuse
v1 fixtures where API behavior remains compatible and add v2-only fixtures for
layout tokens, BIO spans, reference segmentation, and shadow diffs.
