# Data And Decision Records

Last verified on 2026-06-25.

## Approved Truth And Training Governance

- `approved_truth` (Postgres) is the authoritative in-repo reviewed truth source. The governance, certification, and ML-metadata columns are defined across migrations `0007_approved_truth_governance`, `0010_approved_truth_ml_metadata`, `0011_approved_truth_certification`, `0014_approved_truth_editor_drafts`, and `0015_approved_truth_render_variants`.
- Certification logic lives in `server/src/training/truthCertification.ts`. A row carries a `rowStatus` (`draft` / `certified` / `quarantined`) and per-task, per-scope certification entries; only `certified` rows are treated as gold, and `quarantined` / `draft` rows are excluded from supervision exports (`server/src/training/bioSupervisionExport.ts`).
- Truth is split into core vs overlay scope (`truthScope`), with overlay-only fields blocked from core certification, plus a decision hash (`buildDecisionHash`) and split-leakage guard (`hasSplitLeakage`) for provenance and train/eval hygiene.
- The training export contract is documented in:
  - `../ml-system/training-export-schema.md`
  - `../ml-system/ml_system_plan.md`
- Imported external rows are not automatically trusted as final gold; they enter as draft and must be certified.

## Gold Datasets

- Engine gold datasets live under `datasets/engine-v2/gold/` (`style-core`, `citation-bio`, `authority`), resolved through `server/src/training/datasetPaths.ts` (v2-first, with a warned fallback to legacy paths). See `../engine-v2-restructure.md`.
- The active citation-BIO training corpus is in `ml-service/datasets/citation-bio/` — processed rows (`processed/real_train_v1.jsonl`, `processed/real_corpus_gold_v1.jsonl`), the review queue (`review/inbox.jsonl`, `verified.jsonl`, `rejected.jsonl`), the `labels.v1.json` label set, eval holdout templates, and the span/split/validate scripts.

## Architectural Decision Records

The current ADR set lives under `../shared/decisions/` and covers decisions such as:

- ONNX Runtime for v1
- FastAPI as the serving layer
- flat JSONL for the training contract
- heuristics as the primary fallback
- a single active model in v1

## Model Governance

- model-card material lives under `../ml-system/model-cards/`
- promoted bundles should update the relevant model card
- runbook changes belong in ML documentation, not in the model card itself

## Documentation Ownership Boundary

- `../README.md` is the root docs index
- domain README files are the maintained navigation layer
- generated benchmark and regression outputs remain in artifact folders rather than hand-maintained notes
