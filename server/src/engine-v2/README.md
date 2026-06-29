# Citation Engine V2

Engine v2 is a GROBID-compatible-plus architecture. The v1 engine remains in
place as the regression contract while v2 is built in parallel.

## Target Pipeline

1. PDF normalization to ordered layout tokens.
2. Bibliography and footnote zone detection.
3. Reference string segmentation.
4. Field-level BIO tagging.
5. Entity normalization and deterministic validation.
6. Citation-context linking.

## Compatibility Rules

- Do not remove v1 tests or benchmark scripts.
- Prefer v2 gold datasets through the resolver layer.
- Keep legacy dataset mirrors generated from v2 sources until all consumers are migrated.
- Report GROBID-style quality and performance gates before promoting v2.
