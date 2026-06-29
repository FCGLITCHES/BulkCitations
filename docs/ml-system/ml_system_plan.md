# ML System Plan

Last reviewed: 2026-06-25

## Contents

- [Implemented Baseline](#implemented-baseline)
- [File Plan](#file-plan)
- [Future Planned Work](#future-planned-work)

## Implemented Baseline

- ML docs are centralized under `docs/ml-system`.
- Model cards are colocated under `docs/ml-system/model-cards`.
- Operations runbook and export schema docs live in this folder.
- A real Phase-4 extractor exists and is documented as an ONNX **BiLSTM** BIO token classifier (not SciBERT/CRF), built in-repo by `train_bio_bundle.py` and promoted into `models/current`.
- The serving docs now state the default-OFF behavior in the fast lane and the selective-patch (not replace) semantics of `ML_PHASE4_MODE=primary`.
- The open-set style decision policy (`supported_exact` / `family_only` / `known_unsupported_exact` / `unknown_or_ood` / `not_citation_like`) is documented in `architecture-and-serving.md`.
- The BIO supervision JSONL training contract is documented in `training-export-schema.md`.

## File Plan

| File | Implemented Today | Future Planned Work |
| --- | --- | --- |
| `README.md` | ML section structure, architecture one-liner, full doc index, and source-file mapping are documented. | Add explicit model artifact manifest contract and compatibility policy. |
| `architecture-and-serving.md` | Serving topology, runtime boundaries, endpoint list, ONNX BiLSTM extractor identity, Phase-4 call path with default-off/selective-patch behavior, and open-set style decisions are documented. | Add a formal train/serve parity checklist (tokenizer/feature-version pinning) and stronger bundle integrity enforcement (hash signing). |
| `training-and-promotion.md` | BIO extractor, style, and type bundle build/promote flows, the BIO promotion gate (blocking vs advisory), and the local bootstrap path are documented. | Add mandatory end-to-end engine-quality gates beyond token-accuracy/manual review. |
| `runbook.md` | Short quick-reference for health/rollout/rollback with concrete endpoints and env vars. | Keep in sync with `ml-ops-runbook.md`; add a canary progression checklist with rollback-drill requirements. |
| `ml-ops-runbook.md` | Detailed rollout/rollback/troubleshooting procedures, concrete health semantics (`status`/`backend`), and runtime-pin rollback are documented. | Add post-incident template and unsupported-style false-commit response flow. |
| `training-export-schema.md` | Admin export contract, BIO supervision contract, and style bundle endpoints are documented. | Add schema versioning and backward-compatibility examples. |
| `model-cards/phase4-extractor.md` | Real extractor model card (ONNX BiLSTM architecture, current `GOLD-BIO-Tagging-Dataset` version, metrics framing) is documented. | Add style classifier and type classifier model cards as they mature; refresh on every promotion. |
| `ml_system_plan.md` | File-level planning is tracked in-folder and reflects implemented-vs-pending. | Keep in sync with implemented vs planned milestones for all ML docs. |

## Future Planned Work

- Add confidence calibration requirements (ECE/Brier/reliability plots) and slice-level reporting.
- Add field-level fallback policy docs with evidence-grounded output constraints.
- Add a promotion matrix tying model rollout to end-to-end citation quality metrics (not just token accuracy / manual review).
- Add style and type classifier model cards.
- Add bundle integrity (hash/signature) enforcement and a train/serve parity check.

## Notes

- `ml-bio-engine-priority-plan-2026-04-30.md` in this folder is a dated priority plan kept for historical context; this file is the live documentation plan.
