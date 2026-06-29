# Engine V2 Datasets

Engine v2 treats this folder as the dataset source of truth.

## Layout

- `gold/style-core/`: curated style labels, quarantined rows, source packs, and model-ready exports.
- `gold/citation-bio/`: BIO token annotation datasets, processed exports, reports, and schemas.
- `gold/authority/`: authority source data and generated lookup artifacts.
- `mirrors/`: generated compatibility outputs for older training and benchmark consumers.

Legacy paths are retained as generated mirrors while v1 scripts are still in
use. Use the resolver layer instead of hardcoding either the v2 or legacy path.
