# ML training and eval

## Export contract

Use the admin UI Training page or `GET /internal/admin/training-export` to download the governed JSONL export.

Schema: [docs/training-export-schema.md](../docs/training-export-schema.md)

The same flat JSONL shape is used for:

- admin downloads
- committed smoke fixtures
- local stub validation
- offline ONNX evaluation

## Bootstrap path in this repo

This repo now includes a minimal end-to-end bootstrap path for local development:

Before running any local ONNX bundle training or promotion flow, install the ML dependencies:

```bash
python -m pip install -r ml-service/requirements.txt
```

Then verify the local ML environment before training or promotion:

```bash
python -m pip check
python -m pip_audit -r ml-service/requirements.txt
cd ml-service && python -m pytest tests
```

1. Seed the committed fixture rows into `approved_truth`:

```bash
pnpm run training:seed-truth
```

2. Generate a tiny staged ONNX bundle from the same fixture:

```bash
pnpm run training:bootstrap-bundle
```

3. Promote the staged bundle into `ml-service/models/current`:

```bash
python ml-service/tools/promote_bundle.py bootstrap-fixture-onnx-v1
```

4. Run the offline evaluator against the promoted bundle:

```bash
pnpm run training:eval
```

This bootstrap bundle is only a local proving path for the serving, validation, and promotion workflow. Real model quality still depends on reviewed `approved_truth` exports and external training.

`pnpm run dev` now runs [`scripts/ensure-bootstrap-bundle.mjs`](../scripts/ensure-bootstrap-bundle.mjs) before the ML service starts. That script:

1. validates `ml-service/models/current`
2. does nothing if the current bundle is already valid
3. otherwise generates `bootstrap-fixture-onnx-v1`
4. promotes it into `ml-service/models/current`

This auto-generation path is development-only. The bootstrap bundle metadata is marked with `bundleClass = "bootstrap"`, and the ML loader refuses to serve bootstrap bundles when `NODE_ENV=production` unless `ML_ALLOW_BOOTSTRAP_BUNDLE=1` is set explicitly.

## External trainer handoff

Training stays outside this repo.

Workflow:

1. Export JSONL from `/internal/admin/training-export`.
2. Train in the external ML repo.
3. Export an ONNX bundle plus tokenizer/config metadata, `metadata.json`, `feature_manifest.json`, `preprocessing.json`, and `optimization_manifest.json`.
4. Validate the staged bundle:

```bash
python ml-service/tools/validate_bundle.py ml-service/models/staged/<modelVersion>
```

5. Promote the staged bundle into `promoted/` and refresh `current/`:

```bash
python ml-service/tools/promote_bundle.py <modelVersion>
```

6. Run the in-repo evaluator before enabling the model in rollout.

## Style bundle path

The local style classifier now has its own reviewed-gold export and promotion flow.

1. Export reviewed style gold from the admin-approved truth store:

```bash
pnpm run training:style-export
```

2. Train a local style bundle from that JSONL:

```bash
pnpm run training:style-bundle
```

3. Promote the staged style bundle into `ml-service/models/style-model/current`:

```bash
python ml-service/tools/promote_style_bundle.py style-gb-local-reviewed-v1
```

The style trainer is intentionally lightweight and local. It now produces:

- `style_model.json`
- `thresholds.json`
- `decision_policy.json`
- `reason_codes.json`

### Gold reference pack sync

When a curated pack is dropped into the repo root at `style_core_gold_reference_pack_fields/` (preferred) or `style_core_gold_reference_pack/` (legacy), sync it into the repo training artifacts and `approved_truth` with:

```bash
pnpm --dir server exec tsx scripts/sync-style-gold-reference-pack.ts --replace-dataset-version <old_dataset_version>
```

This sync writes:

- `ml-service/training/style_gold.jsonl`
- `ml-service/training/gold-datasets/<datasetVersion>.style-core.jsonl`
- `ml-service/training/gold-datasets/<datasetVersion>.json`
- `ml-service/training/gold-datasets/<datasetVersion>.summary.json`
- `ml-service/training/gold-datasets/<pack-folder-name>/`

Gold rows are imported as certified style/core truth with their pack governance fields preserved. Quarantined rows keep their pack review state and remain outside the training export until they are adjudicated.

## Hugging Face BIO gold path

Use this when you want token-level BIO supervision (B/I/O) to drive extraction quality directly.

### 1) Import a Hugging Face token dataset into local gold NDJSON

```bash
pnpm run training:hf-bio-import -- \
  --dataset <namespace/dataset> \
  --config <optional_config> \
  --split train \
  --token-column tokens \
  --label-column ner_tags \
  --unknown-label-policy error
```

Output defaults to:

`ml-service/training/gold-datasets/<dataset>.<config_or_default>.<split>.bio.jsonl`

Each row stores:

- `raw_text`
- `bio_tokens`
- `bio_tags` (normalized to canonical BIO labels)
- `expected_fields` (derived from BIO spans)
- governance fields (`dataset_split`, `trust_level`, `input_hash`, `provenance`, etc.)

If your source labels do not match canonical names, provide a custom mapping:

```bash
pnpm run training:hf-bio-import -- \
  --dataset <namespace/dataset> \
  --label-map path/to/label-map.json
```

### 2) Train an ONNX extraction bundle from BIO gold

Reviewed engine feedback can also be exported into the processed BIO dataset lane:

```bash
curl -X POST http://localhost:3001/admin/bio-dataset/export-supervision
```

That export writes `ml-service/datasets/citation-bio/processed/approved_truth_supervision.jsonl` from reviewed approved truth and processed, training-eligible learning-queue corrections.

```bash
pnpm run training:hf-bio-bundle -- \
  ml-service/training/gold-datasets/<file>.bio.jsonl \
  --version bio-gold-local-v1 \
  --feature-version plain-text-bio-v1
```

This writes a staged bundle at:

`ml-service/models/staged/<version>/`

with:

- `extractor.onnx`
- tokenizer assets
- `metadata.json` (BIO label map + dataset stats)
- `feature_manifest.json`
- `preprocessing.json`
- `optimization_manifest.json`

### 3) Promote the trained bundle into runtime

```bash
python ml-service/tools/promote_bundle.py <version>
```

Admin BIO promotion requires bundle validation, BIO token-classifier metadata, validation/test dataset rows, Phase 4 shadow history for the candidate version, and an available engine benchmark artifact before the bundle replaces `current`.

After promotion, Phase 4 extraction consumes the native BIO response through `extractionMeta.bio`, health evidence, and selective primary patches.

The style decision endpoint consumes these artifacts together so exact-style commit policy can be versioned independently from model weights.

The same flow is now available from the admin training surface:

- review and promote rows to `gold`
- build the generated authority pack
- build a staged style bundle
- promote the staged style bundle into `current`

Public or production deployments should never rely on the bootstrap generator. In public:

- training still happens outside this repo
- a reviewed export is used to produce a real staged ONNX bundle
- that staged bundle is validated and promoted
- the promoted bundle is then served by the Python service

The in-repo bootstrap generator exists only to keep local `pnpm run dev` functional when no bundle has been staged yet.

## Eval harness

Offline evaluation uses the same extraction path as `/ml/extract`, but requires a local ONNX bundle.

Stable API aliases also exist under `/v1/ml/*`.

```bash
python ml-service/tools/eval_jsonl.py ml-service/training/fixture_export.jsonl
```

Optional:

```bash
python ml-service/tools/eval_jsonl.py ml-service/training/fixture_export.jsonl --model-dir ml-service/models
```

Behavior:

- If no ONNX bundle is present in `MODEL_DIR`, the script prints a skip message and exits `0`.
- When an ONNX bundle is present, the script prints JSON metrics with per-field exact rates and row-level exact match rate.

## Stub train

`stub_train.py` validates the JSONL contract and prints split / trust-level counts for handoff tracking.

```bash
python ml-service/tools/stub_train.py
```

## Rollout

- Runtime env: `ML_PHASE4_MODE`
- Admin override: `GET/PUT /internal/admin/phase4-mode`

Recommended rollout order:

1. Validate the JSONL export.
2. Run ONNX eval on the fixture and a real export sample.
3. Drop the model into `MODEL_DIR`.
4. Keep runtime on heuristics until the offline eval is acceptable.
5. Use the admin phase-4 override for controlled canary checks.
