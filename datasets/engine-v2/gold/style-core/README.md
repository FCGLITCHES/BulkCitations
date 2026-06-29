# Style Core Gold

Source-of-truth location for engine v2 style classification gold data.

## Subfolders

- `curated/`: reviewed gold dataset snapshots and freeze summaries.
- `quarantine/`: rows excluded from gold and awaiting review.
- `source-packs/`: source reference packs used to generate curated exports.
- `exports/`: model-ready exports such as `style_gold.jsonl`.

Compatibility mirrors are generated into legacy `ml-service` paths and include
manifest files linking each mirror back to its v2 source file.
