# Annotation Guide (v1)

## Scope

Annotate citation **field spans** over `raw_reference` using character offsets.

## Source of truth

- Canonical gold = `raw_reference` + `entities[]` with `field/start/end/text`
- BIO is generated programmatically and is not manually authored

## JSONL schema

```json
{
  "id": "ref_000001",
  "raw_reference": "Smith J, Doe A. Example Article. Journal of Testing. 2024;12(4):123-145. doi:10.1000/test",
  "reference_type": "article-journal",
  "source_family": "synthetic-targeted",
  "style_family": "vancouver-like",
  "entities": [
    {"field": "author", "start": 0, "end": 15, "text": "Smith J, Doe A"},
    {"field": "title", "start": 17, "end": 32, "text": "Example Article"}
  ],
  "notes": []
}
```

### What `start` and `end` mean

- `start` is the 0-based character index where the entity begins (inclusive).
- `end` is the character index where the entity stops (exclusive).
- `text` must always equal `raw_reference[start:end]` exactly.

Example:

- `raw_reference = "Smith J, Doe A. Example Article."`
- `author = {"start": 0, "end": 14, "text": "Smith J, Doe A"}`
- `title = {"start": 16, "end": 31, "text": "Example Article"}`

## Priority order for ambiguous spans

1. Identifiers: `doi`, `url`, `isbn`, `issn`
2. Dates: `publicationDate`, `year`, `accessDate`
3. Locators: `volume`, `issue`, `pages`, `articleNumber`, `reportNumber`, `edition`
4. Contributors: `author`, `editor`
5. Titles/containers: `title`, `journalTitle`, `containerTitle`, `bookTitle`, `websiteTitle`, `conferenceName`
6. Publication metadata: `publisher`, `place`, `institution`

## Rules

1. Annotate only field-pure spans.
2. Keep punctuation outside spans unless punctuation is semantically part of the field.
3. Keep prefixes like `doi:` / `Available at:` out of value spans.
4. Keep `et al.` inside the `author` span.
5. Corporate authors use `author`.
6. `issue` can exist without `volume`.
7. `articleNumber` is not `pages`.
8. `reportNumber` is distinct from `pages`, `issue`, and `articleNumber`.

## Quality gates

- `entities[].text` must exactly match `raw_reference[start:end]`
- no out-of-range offsets
- no overlapping spans
- no empty spans
- no duplicate IDs

## Double annotation

Double-annotate 10–20% and adjudicate disagreements before scaling.

## Versioning

Version annotation guide, labels, conversion script, split metadata, and dataset release together.
