# Citation BIO — held-out eval set (P0)

This directory holds the **held-out, real, human-labeled** evaluation set for the
BIO tagging model. It is the single source of truth for whether a model change
actually helped. It is **never used for training**.

> Why it exists: the current reported entity-F1 (~0.74) is measured against
> synthetic / substring-projected data drawn from the same distribution that
> produced the model — so it is optimistic. Until a real held-out set exists,
> every metric is suspect. This is P0 of the BIO improvement plan.

## Files

| File | Purpose |
| --- | --- |
| `strata.json` | The 11 strata, their per-stratum targets (350 total), and the labelling rules. |
| `holdout.template.jsonl` | Two worked examples showing the exact row schema (provenance marked `EXAMPLE`). |
| `holdout.jsonl` | **You create this.** The real labeled rows. Not committed until populated. |

## Row schema

One JSON object per line:

```jsonc
{
  "raw_text": "Smith, J. A., & Doe, R. (2019). Deep learning...",
  "stratum": "doi_heavy",                  // must be a key in strata.json
  "expected_type": "article-journal",
  "entity_fields":  ["author", "year", "title", ...],   // canonical BIO cores
  "entity_starts":  [0, 25, 32, ...],       // char offsets into raw_text
  "entity_ends":    [12, 29, 66, ...],       // raw_text[start:end] == entity_text
  "entity_texts":   ["Smith, J. A.", "2019", ...],
  "expected_fields": { "authors": [...], "year": 2019, ... }, // for the product tier
  "dataset_split": "holdout",
  "trust_level": "gold",
  "provenance": "human-labeled"
}
```

Labels use the **canonical BIO cores** (not camelCase field names):
`author, editors, year, title, journal, conference_title, book_title, publisher,
institution, edition, thesis_type, repository, article_number, accessed_date,
site_name, database, report_number, place_of_publication, volume, issue, pages,
doi, url`.

## Workflow

1. Collect **real** references stratified per `strata.json` (no synthetic text).
2. Label spans with exact char offsets (`raw_text[start:end] == entity_text`).
3. Validate:

   ```bash
   python tools/validate_eval_set.py --gold datasets/citation-bio/eval/holdout.jsonl
   ```

   The validator enforces offset correctness, the canonical label space,
   stratum coverage, and the **held-out guarantee** (no row's `input_hash`
   collides with any training-track row).

4. Score a model against it:

   ```bash
   python tools/eval_bio_model.py --gold datasets/citation-bio/eval/holdout.jsonl \
          --bundle models/current --baseline models/reports/baseline_v1_eval.json
   ```

   The harness reports the two-tier benchmarks and a PASS/FAIL promotion gate.

## Hard rules

- **Real only.** Synthetic/templated text invalidates the set's purpose.
- **Held-out forever.** Never feed these rows into training. The validator fails
  if a row also appears in the training data.
- **Exact offsets.** The validator rejects any `entity_text` that does not match
  its `raw_text[start:end]` slice.
