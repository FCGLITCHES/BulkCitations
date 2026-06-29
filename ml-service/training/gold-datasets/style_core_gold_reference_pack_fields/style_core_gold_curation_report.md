# Style Core Gold Reference Pack v2 — fields filled

Input: `style-core-freeze-2026-04-13T22-43-05-056Z.precert-pool.ndjson`  
Dataset version: `style-core-gold-auto-curated-v2-fields`

## Files

- `style_core_all_full_audit.ndjson` — all 20,250 input rows with `expected_fields`, original labels, detected labels, decisions, and source metadata.
- `style_core_gold_full_audit.ndjson` — accepted gold rows only, with complete required fields.
- `style_core_quarantine_review.ndjson` — rows kept for review because a label or required field could not be safely certified.
- `style_core_gold_import_flat.jsonl` — direct import rows for `server/scripts/seed-approved-truth-from-jsonl.ts`.
- `style_core_gold_train.jsonl`, `style_core_gold_val.jsonl`, `style_core_gold_test.jsonl` — direct-import gold rows split with `val`, not `validation`.
- `style_core_gold_curation_report.json` — machine-readable validation report.

## Counts

| Bucket | Rows |
|---|---:|
| Input rows preserved in audit | 20,250 |
| Accepted gold-reference rows | 7,197 |
| Quarantine review rows | 13,053 |
| Direct import rows | 7,197 |

## Gold import split counts

| Split | Rows |
|---|---:|
| train | 5,060 |
| val | 1,076 |
| test | 1,061 |

## Validation

- Raw text preserved from input: **yes**.
- Direct import uses `val`, not `validation`: **yes**.
- Duplicate raw_text in direct import: **0**.
- Required-field failures in direct import: **0**.
- JSONL parse validation: **passed** for all pack files.

Rows that lacked enough field evidence were not forced into gold; they are in the quarantine file with `expected_fields` populated as far as the citation text supports.
