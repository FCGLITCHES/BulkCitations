# Training export schema (v1)

Last verified on 2026-06-25.

There are two related JSONL contracts:

1. The **admin training-export** contract (`GET /internal/admin/training-export`) — flat canonical approved-truth rows used by offline trainers, the style/type lanes, and the in-repo robustness harness. Described first below.
2. The **BIO supervision** contract consumed by the Phase-4 extractor trainer (`ml-service/tools/train_bio_bundle.py` via `ml-service/app/bio_training_dataset.py`). It is a superset that adds token-level `bio_tokens` / `bio_tags`. Described in "BIO supervision record shape" below.

## Admin training-export

`GET /internal/admin/training-export` is the supported export surface for canonical approved-truth rows used by offline trainers and the in-repo robustness harness.

`GET /internal/admin/render-variant-export` is the separate internal export for linked six-style render variants. Those rows are augmentation-lane artifacts and are excluded from the canonical `style/core` export by default.

The response is newline-delimited JSON (`application/x-ndjson`). Each line is one flat record.

## Record shape

- `raw_text` (string): verbatim citation input after the repo’s truth normalization and dedupe rules.
- `expected_fields` (object): flat canonical targets only.
- `expected_type` (string | null): expected citation type when known.
- `expected_style` (string | null): style hint for the evaluator.
- `dataset_split` (string | null): `train`, `val`, `test`, `holdout`, or `null`.
- `trust_level` (string | null): `draft`, `reviewed`, or `gold`.
- `row_status` (string | null): `draft`, `reviewed`, or `quarantined`.
- `input_hash` (string | null): SHA-256 hash of normalized `raw_text`.
- `provenance` (string | null): optional governance/source marker.
- `pipeline_major` (number | null): optional pipeline version marker.
- `task` (string): export task scope, one of `style`, `field`, or `overlay_learning`.
- `truth_scope` (string): `core` or `overlay`.

## BIO supervision record shape

The Phase-4 extractor trainer reads BIO supervision JSONL (loader: `ml-service/app/bio_training_dataset.py`, `load_bio_gold_jsonl`). Each line is one flat record that extends the admin export with token-level supervision.

Required token-level fields:

- `raw_text` (string): citation input (the loader also accepts `raw_reference` as a fallback).
- `bio_tokens` (string array): the tokenization the tags align to (accepts `tokens` as a fallback). Must be non-empty.
- `bio_tags` (string array): one BIO tag per token, same length as `bio_tokens`. Tags are normalized to `O` or `<B|I>-<core>` over the 23 canonical cores (`author`, `editors`, `year`, `title`, `journal`, `conference_title`, `book_title`, `publisher`, `institution`, `edition`, `thesis_type`, `repository`, `article_number`, `accessed_date`, `site_name`, `database`, `report_number`, `volume`, `issue`, `pages`, `doi`, `url`, `place_of_publication`). A large alias map (e.g. `person`→`author`, `venue`→`journal`, `accessdate`→`accessed_date`) is applied; unknown cores raise by default.

Governance / split fields (same meaning as the admin export):

- `dataset_split` (string | null): `train`, `val`, `test`, `holdout`, or `null`. Unsplit rows are treated as `train`; `val`/`test`/`holdout` are excluded from training.
- `trust_level` (string | null): rows with `trust_level == "draft"` are skipped by the loader; `gold` / `reviewed` / `certified` are counted as certified in lineage.
- `row_status` (string | null): rows with `row_status == "quarantined"` are skipped (unless `include_quarantined`).
- `input_hash` (string): SHA-256 of normalized `raw_text`; computed if absent.
- `provenance`, `pipeline_major`, `task` (default `field`), `truth_scope` (default `core`): optional governance markers.

Optional derived / source fields:

- `expected_fields` (object): if absent, the loader derives it from `bio_tokens` + `bio_tags`.
- `expected_type`, `expected_style` (string | null).
- `source_dataset`, `source_config`, `source_split`, `source_row_id`: optional provenance back to an upstream dataset row.
- `entity_fields`, `entity_starts`, `entity_ends`, `entity_texts`: optional parallel entity arrays.

Validation: `bio_tokens` and `bio_tags` must be present, non-empty, all-string, and equal length, or the row raises. The bundle `metadata.json` records dataset lineage (row counts per split, dataset hashes, label distribution, train/val/test metrics).

## Render-variant export shape

`GET /internal/admin/render-variant-export` returns NDJSON with one linked render variant per line.

- `truth_row_id` (string): parent approved-truth row id.
- `raw_text` (string): canonical observed citation input from the parent row.
- `expected_fields` (object): canonical parent truth fields used to generate the render.
- `expected_type` (string | null): canonical parent type.
- `input_style_label` (string | null): the reviewed style label of the observed input citation.
- `render_style` (string): target rendered style (`apa7`, `harvard-ctr`, `chicago-notes-bib`, `vancouver`, `ieee`, `mla9`).
- `rendered_text` (string): current saved render variant text.
- `generated_text` (string): latest deterministic generated baseline for the same parent row and renderer version.
- `source_kind` (string): `generated` or `admin_authored`.
- `approval_status` (string): `draft`, `reviewed`, or `approved`.
- `quality_tier` (string): currently `gold`.
- `dataset_lane` (string): currently `augmentation`.
- `renderer_version` (string): deterministic renderer/rule version used for the baseline.
- `stale` (boolean): whether canonical parent truth changed after the variant was saved.
- `generated_at` (string): ISO timestamp of the current generated baseline.
- `approved_at` / `approved_by` (string | null): approval metadata when approved.
- parent governance fields such as `dataset_split`, `row_status`, `dataset_version`, `holdout_version`, `canonical_work_key`, and `near_dup_cluster_id`.

## `expected_fields` rules

`expected_fields` must stay flat in v1.

Allowed values per field:

- string
- number
- boolean
- null
- array of those scalar values

Disallowed values:

- nested objects
- arrays of objects
- arrays of arrays

At the admin boundary, engine-style values such as `{ "value": "Title" }` or author objects like `{ "family": "Smith", "given": "Jane" }` are normalized into flat export-safe values before storage.

Common flat identifier fields now include:

- `doi`
- `pmid`
- `arxiv`
- `isbn`
- `issn`
- `handle`
- `patent`

## Filters and delivery

- `trustLevel=<draft|reviewed|gold>` filters exported rows.
- `rowStatus=<draft|reviewed|quarantined>` filters by row-level status.
- `datasetSplit=<train|val|test|holdout>` filters exported rows.
- `expectedStyle=<style>` filters exported rows to a single reviewed style label.
- `goldKind=<style_clean|style_adversarial|style_noisy|field_span|authority_seed|overlay_accept>` filters by gold-data workflow kind.
- `adversarialPair=<pair_name>` filters to one reviewed adversarial pair.
- `task=<style|field|overlay_learning>` selects certification task filter.
- `truthScope=<core|overlay>` selects which truth scope is exported.
- `certifiedOnly=true` is the default.
- `excludeQuarantined=true` is the default.
- `holdoutVersion=<version>` filters to a specific sealed holdout generation.
- `excludeHoldout=true` is the default.
- `download=false` returns inline NDJSON without the attachment header.

Render-variant export filters:

- `renderStyle=<style>` filters to one target render style.
- `approvalStatus=<draft|reviewed|approved>` filters by variant approval status.
- `approvedOnly=true` is the default.
- `datasetLane=augmentation` is the current supported lane.
- `includeStale=false` is the default.
- `excludeQuarantined=true` is the default.
- `excludeHoldout=true` is the default.
- `datasetVersion=<id>` filters by the parent row dataset freeze/version.

## Admin workflow surfaces

The admin tab is the review home for gold/training data.

Related internal routes:

- `GET /internal/admin/training-status` returns reviewed/gold counts and local style-bundle status.
- authority-pack build workflows are retired and are no longer part of the supported training export surface.
- `POST /internal/admin/style-bundle/build` exports gold style rows and trains a staged local style bundle through `ml-service/tools/train_style_bundle.py`.
- `POST /internal/admin/style-bundle/promote` copies a staged style bundle into `ml-service/models/style-model/current/style_model.json`.
- `GET /internal/admin/render-variant-export` exports linked six-style render variants for renderer QA, augmentation experiments, or future render-specific training lanes.

## Contracts

- The admin UI, handwritten fixtures, and the Python harness must all use the same record shape.
- The BIO extractor, style, and type bundles are trained in-repo from this JSONL (the trainers consume the JSONL, produce ONNX/JSON bundles, and write them under `ml-service/models/`). Production-quality training may still be run externally; external trainers consume the same JSONL and drop a bundle into `MODEL_DIR` or `ml-service/models/`.
- Linked render variants are authoritative admin-reviewed artifacts, but they are not part of canonical `style/core` counts or default style-bundle training export.
