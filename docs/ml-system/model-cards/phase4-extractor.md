# Phase-4 Extractor Model Card

Last reviewed: 2026-06-25
Document owner: BulkReferences Extraction Platform Maintainers

This is the model card for the Phase-4 citation field extractor. Update it on every promoted model version. The Phase-4 **heuristic regex extractor is the primary path and the always-available fallback**; the ONNX model is an optional, selectively-applied augmentation that is OFF in the default (fast / `site_default`) lane.

## Architecture

- The served extractor is an **ONNX token-classification (BIO) model, NOT SciBERT/CRF and not a transformer encoder.**
- It is the `TinyTokenClassifier` defined in `ml-service/tools/train_bio_bundle.py`:
  - `nn.Embedding(vocab, 96)` → `nn.LSTM(96, 96, bidirectional=True)` (a **BiLSTM**) → `nn.Linear(192, num_labels)`.
  - Exported to `extractor.onnx` (opset 17, dynamic batch/sequence axes) and served by `onnxruntime` on `CPUExecutionProvider`.
  - A WordLevel tokenizer (whitespace + isolated-punctuation pre-tokenizer) is bundled with the model; there is no subword/SentencePiece vocabulary.
- A `BertConfig` is written into the bundle only to carry `id2label`/`label2id` and shape metadata for the ONNX runtime and `AutoConfig`/`AutoTokenizer` loading. It does **not** mean a BERT/SciBERT encoder is used.
- Note: `ml-service/app/models/loader.py` `_MODEL_CONFIGS` references Hugging Face pipelines (`bert-base-uncased`, `SIRIS-Lab/citation-parser-ENTITY`). Those are optional, lazily-loaded *helper* pipelines that are not wired into the Phase-4 serving path and are not the promoted extractor.

## Intended Use

- Extract structured citation fields from plain-text reference strings.
- Augment (via selective per-field patching) the Phase-4 heuristic extraction stage when ML routing is enabled.
- Provide field-level confidence/uncertainty and BIO span/diagnostic signals for review and monitoring.

## Serving Role And Default-Off Behavior

- Phase-4 always computes the heuristic extraction first.
- ML is attempted only when the execution policy sets `extractionML: 'routed'`. In the fast lane (`core_parse_fast`, used by `site_default` / browser site-default traffic) `extractionML` is `'off'`, so the model is never called.
- When ML is routed, `ML_PHASE4_MODE` selects `heuristic` (default), `shadow` (record diff only, heuristic output ships), or `primary` (apply selective ML field patches over heuristic output). Even `primary` is a **patch over the heuristic result**, never a wholesale replacement.
- Any ML failure, unavailable bundle, unsupported style, or detection-uncertainty bypass routes the carrier back to heuristic output.

## Supported Inputs In V1

- Plain-text citation strings only.
- Styles and reference shapes supported by the v1 Phase-4 routing and extraction path.
- Single-reference and batch inference through `/v1/ml/extract` and `/v1/ml/batch-extract` (max 128 items per batch).

## Non-Goals In V1

- PDF-native extraction or OCR of scanned/image-heavy pages.
- Multilingual extraction guarantees.
- Multi-model routing or ensemble extraction.
- Fully autonomous retraining or promotion.

## Current Active Version

The currently staged BIO extractor bundle (`ml-service/models/staged/GOLD-BIO-Tagging-Dataset`) reports:

- Model version: `GOLD-BIO-Tagging-Dataset`
- Feature version: `plain-text-bio-v1`
- Bundle class: `standard`; bundle type: `token-classification`; framework `pytorch`; runtime target `onnxruntime-cpu`.
- Label schema: BIO over 23 canonical field cores (`author`, `editors`, `year`, `title`, `journal`, `conference_title`, `book_title`, `publisher`, `institution`, `edition`, `thesis_type`, `repository`, `article_number`, `accessed_date`, `site_name`, `database`, `report_number`, `volume`, `issue`, `pages`, `doi`, `url`, `place_of_publication`) plus `O`.
- Dataset source: `real_train_v4.jsonl` (348 rows loaded, 332 train rows, 16 holdout; val/test split counts are 0 because the single-admin workflow uses manual Review as the holdout-eval gate).
- Reported `train_token_accuracy_peak ≈ 0.975`. Entity-level val/test F1 are `0.0` only because the val/test buckets are empty in this dataset — they are not measured quality regressions.

Confirm the promoted/active version with `GET /v1/ml/health` (`activeModelVersion`, `featureVersion`, `backend`) and `GET /admin/bio-training-status`. `backend: "heuristic"` means no ONNX bundle is loaded and Phase-4 is fully heuristic.

## Evaluation Datasets

Document the datasets used for the current promoted version:
- BIO gold training/eval JSONL (currently `real_train_v4.jsonl`) with its `train` / `val` / `test` / `holdout` `dataset_split` buckets.
- Engine benchmark / real-input corpus used for end-to-end quality.

Record the `sourceDatasetHash` / `rawTextCorpusSha256` from the bundle `metadata.json` `datasetLineage` for each promoted bundle.

## Protected-Field Expectations

The system treats these fields as promotion-sensitive:
- `title`
- `year`
- `doi`
- `authors`

Shadow disagreement or drift on these fields should be reviewed before primary rollout expansion.

## Confidence And Uncertainty Guidance

- Field-level confidence is the softmax max over the BIO label distribution, averaged across an entity's tokens — an operational signal, not a guarantee of correctness.
- `fieldUncertainty` is reported as `1 - confidence`; `uncertainFields` lists fields below the per-style uncertainty threshold.
- Low-confidence predictions should be eligible for review, especially on protected fields.
- Uncertainty should be interpreted alongside disagreement, source quality, and fallback behavior.

## Known Limitations And Likely Weak Areas In V1

- Trained on a small (~350-row) hand-verified gold set; coverage of rare fields (e.g. `place_of_publication`, `issue`) is thin per the label distribution.
- Highly irregular punctuation or malformed plain-text references.
- Very short references with missing structural cues.
- Unsupported styles or style-family edge cases.
- Non-English or mixed-script plain-text name patterns not yet well covered.
- PDF or OCR-derived artifacts outside the explicit v1 scope.
- Inputs whose tokenization or segmentation diverges from training assumptions (the WordLevel tokenizer maps unseen tokens to `[UNK]`).

## Review Notes

Update this card whenever:
- a new ONNX bundle is promoted (refresh model/feature version, dataset source, and metrics from the bundle `metadata.json`),
- evaluation sets or metrics change materially,
- known limitations change,
- confidence or uncertainty interpretation changes.
