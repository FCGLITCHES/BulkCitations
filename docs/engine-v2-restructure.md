# Citation Engine V2 Restructure

> **Status (2026-06-25): historical.** This document records the v2 dataset-restructure migration. Its core decisions are now the live structure: `datasets/engine-v2/gold/` exists (`style-core`, `citation-bio`, `authority`) and the v2-first-with-legacy-fallback resolver is implemented in `server/src/training/datasetPaths.ts`. The runtime engine has since grown to a 17-phase pipeline under `server/src/engine/phases/`. For current system status see `engine/system-assessment.md`.

This document records the implemented folder ownership and compatibility rules
for the v2 migration.

## Dataset Ownership

Active v2 gold datasets live under `datasets/engine-v2/gold`.

- Style core: `datasets/engine-v2/gold/style-core`
- Citation BIO: `datasets/engine-v2/gold/citation-bio`
- Authority: `datasets/engine-v2/gold/authority`

Legacy paths remain available as compatibility mirrors:

- `ml-service/training/style_gold.jsonl`
- `ml-service/training/gold-datasets/`
- `ml-service/datasets/citation-bio/`
- `style_core_gold_reference_pack_fields/`

Mirror files must be generated from v2 source files and must carry a sibling
`.manifest.json` file where the consumer path is a generated export.

## Resolver Rules

Server code should use `server/src/training/datasetPaths.ts`.

ML service code should use `ml-service/app/dataset_paths.py`.

Resolver behavior:

- Prefer v2 source-of-truth paths when present.
- Fall back to legacy paths only when the v2 path is missing.
- Emit a clear warning on legacy fallback.
- Do not silently mix v2 and legacy source datasets in one export.

## Test Preservation

Existing tests and benchmark scripts remain the v1 regression contract. They are
not deleted during cleanup.

Test grouping is logical first:

- v1 regression: existing server, ML service, admin training, benchmark, security, and smoke tests.
- v2 candidate: layout-token, BIO span, reference segmentation, parity, and shadow-diff tests.
- shared contract: resolver and export compatibility tests.
- benchmark: GROBID-style quality and performance gates.

Physical test movement is deferred until package scripts and CI labels can
reference the new groups without breaking local workflows.

## Cleanup Constraint

Old benchmark result files are not removed automatically. Archival is allowed
only after a replacement command exists, documentation is updated, validation
passes, and an archive manifest records old and replacement paths.
