# Citation BIO Gold Dataset

This dataset is the standalone source for training citation field extraction using BIO tagging.

## Core principle

The source of truth is **raw citation text + character-span entities**. BIO labels are generated from spans and are never the canonical record.

## Dataset layers

1. **Canonical span gold** (`annotations/*.jsonl`)
   - `raw_reference`
   - `entities[]` with `field`, `start`, `end`, `text`
2. **Word-level BIO view** (`processed/*_bio.jsonl`)
   - `tokens`
   - `bio_tags`
3. **Model-token labels** (generated during training)
   - tokenizer-specific `input_ids`, `attention_mask`, `labels`

## Required scripts

- `scripts/validate_gold_dataset.py`: validates canonical span JSONL and optional BIO projection
- `scripts/convert_spans_to_bio.py`: deterministic span-to-token BIO conversion
- `scripts/generate_bootstrap_gold.py`: creates synthetic bootstrap span gold (default: 1200 rows)
- `scripts/split_dataset.py`: creates deduped train/validation/test splits with split metadata

## Typical flow

1. Annotate spans in `annotations/adjudicated.v1.jsonl`.
2. Validate canonical spans:
   ```bash
   python ml-service/datasets/citation-bio/scripts/validate_gold_dataset.py \
     --input ml-service/datasets/citation-bio/annotations/adjudicated.v1.jsonl
   ```
3. Convert spans to BIO:
   ```bash
   python ml-service/datasets/citation-bio/scripts/convert_spans_to_bio.py \
     --input ml-service/datasets/citation-bio/annotations/adjudicated.v1.jsonl \
     --labels ml-service/datasets/citation-bio/labels.v1.json \
     --output ml-service/datasets/citation-bio/processed/citation_bio_v1_all.jsonl
   ```
4. Split train/validation/test/challenge using a deterministic split script.
5. Train the BIO model using this BIO dataset track (separate from generic ML-system truth exports).

## Bootstrap generation (separate track)

To bootstrap annotation and training, generate a synthetic set (default 1200 rows):

```bash
python ml-service/datasets/citation-bio/scripts/generate_bootstrap_gold.py \
  --rows 1200 \
  --output ml-service/datasets/citation-bio/annotations/adjudicated.v1.bootstrap.synthetic.jsonl
```

Then validate + convert + split:

```bash
python ml-service/datasets/citation-bio/scripts/validate_gold_dataset.py \
  --input ml-service/datasets/citation-bio/annotations/adjudicated.v1.bootstrap.synthetic.jsonl \
  --labels ml-service/datasets/citation-bio/labels.v1.json

python ml-service/datasets/citation-bio/scripts/convert_spans_to_bio.py \
  --input ml-service/datasets/citation-bio/annotations/adjudicated.v1.bootstrap.synthetic.jsonl \
  --labels ml-service/datasets/citation-bio/labels.v1.json \
  --output ml-service/datasets/citation-bio/processed/citation_bio_v1_bootstrap_all.jsonl

python ml-service/datasets/citation-bio/scripts/split_dataset.py \
  --input ml-service/datasets/citation-bio/processed/citation_bio_v1_bootstrap_all.jsonl \
  --out-dir ml-service/datasets/citation-bio/processed \
  --prefix citation_bio_v1_bootstrap
```

For quality: use synthetic bootstrap for cold-start and tooling shakeout, then replace/augment with manually adjudicated real references before promotion.

## Notes

- Do not hand-edit tokenizer-aligned labels.
- If the tokenizer changes, regenerate model-token labels from the same span gold.
- Keep synthetic examples tagged with `source_family` so evaluation can report real vs synthetic behavior separately.
