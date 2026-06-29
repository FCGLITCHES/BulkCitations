# Governance Plan

Last reviewed: 2026-06-25

## Contents

- [Implemented Baseline](#implemented-baseline)
- [File Plan](#file-plan)
- [Future Planned Work](#future-planned-work)

## Implemented Baseline

- Governance docs are isolated under `docs/governance`.
- Decision record and truth-governance references now point to the new shared/ml-system locations.
- The approved-truth certification model is implemented in code (`server/src/training/truthCertification.ts`): `draft` / `certified` / `quarantined` row status, core-vs-overlay scope, decision hash, and split-leakage guards. `data-and-decision-records.md` now documents this against the live code and gold-dataset locations.

## File Plan

| File | Implemented Today | Future Planned Work |
| --- | --- | --- |
| `README.md` | Governance section purpose and entrypoint are documented. | Add explicit ownership matrix (engineering, ML, operations, admin review). |
| `data-and-decision-records.md` | Approved truth, ADR, and model governance boundaries are documented with corrected paths; certification statuses and gold-dataset locations now verified against code. | Add hard gate checklist for gold export, promotion approvals, and audit provenance. |
| `governance_plan.md` | File-level planning is now tracked in one place. | Add policy versioning and change-control cadence. |

## Future Planned Work

- Add a formal "core truth vs overlay truth" policy section with examples.
- Document required audit reason taxonomy and review provenance storage guarantees.
- Add governance incident process for parity regressions and unsupported false-commit spikes.
