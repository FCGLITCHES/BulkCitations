# Grobid-Style Benchmark Summary

- Generated At: 2026-04-20T16:47:06.612Z
- Mode: full
- Profile: current-runtime
- Parse Profile: core_parse_fast
- Source Type: text
- Hardware Profile: benchmark_5600h
- Benchmark Variant: grobid_compare
- Semantic Output Hash: sha256:e1b677601083bc97cd925fbc5e6606fe8472a4d0f13410a80315fb9dac2f3746
- Slice Rows: 3001-3400 (400 rows)
- Scoring Spec: grobid-soft-v3
- Target Status: pass

## Contract Sanity

- Hard Failures: 2
- Warnings: 0

## Metric Legend

- `tp` (true positives): expected field matches that the engine got right.
- `fp` (false positives): field values the engine predicted but that did not match the expected field.
- `fn` (false negatives): expected field values the engine missed or failed to match.
- `precision`: of the values predicted for a field, how many were correct.
- `recall`: of the values expected for a field, how many were recovered.
- `f1`: harmonic mean of precision and recall; use this as the main per-field score.

## Clean

- Macro Soft F1: 0.9232
- Instance Soft F1: 0.9116
- Type Accuracy: 0.9834 (356/362)
- Style Accuracy: 0.9779 (354/362)
- Style Family Accuracy: 1 (362/362)
- Throughput (refs/sec): 45.74
- Normalized Citation Exact-Match Rate: 0 (362 compared)
- Required-Field Completeness: 0.9948
- False-Fill Rate: 0.0023
- Accepted-Without-Edit Rate: 0.6961
- Mean Normalized Edit Distance: 0.2554 (362 compared)
- Unsupported False-Commit Rate: 0 (0 compared)
- Abstain Precision: 0.1789 (95 compared)
- Abstain Coverage: 0.5313 (32 required)

### Clean Adversarial Pair Accuracy

| Pair | Styles | Accuracy | Correct | Compared |
| --- | --- | --- | --- | --- |
| apa7_vs_harvard-ctr | apa7 vs harvard-ctr | 1 | 122 | 122 |
| mla9_vs_chicago-notes-bib | mla9 vs chicago-notes-bib | 0.9333 | 112 | 120 |
| vancouver_vs_ieee | vancouver vs ieee | 1 | 120 | 120 |

### Clean Soft Field Metrics

| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |
| --- | --- | --- | --- | --- | --- | --- |
| authors | 327 | 35 | 0 | 0.9033 | 1 | 0.9492 |
| bookTitle | 42 | 0 | 6 | 1 | 0.875 | 0.9333 |
| doi | 362 | 0 | 0 | 1 | 1 | 1 |
| firstAuthor | 351 | 11 | 0 | 0.9696 | 1 | 0.9846 |
| isbn | 6 | 36 | 6 | 0.1429 | 0.5 | 0.2222 |
| journal/venue | 356 | 0 | 6 | 1 | 0.9834 | 0.9916 |
| pages | 48 | 0 | 0 | 1 | 1 | 1 |
| publisher | 48 | 0 | 0 | 1 | 1 | 1 |
| repository | 314 | 0 | 0 | 1 | 1 | 1 |
| title | 360 | 2 | 0 | 0.9945 | 1 | 0.9972 |
| url | 362 | 0 | 0 | 1 | 1 | 1 |
| year | 362 | 0 | 0 | 1 | 1 | 1 |

### Clean Field Contract

| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| authors | 1 | 0.9492 | 0.9492 | 0.9033 | 0.9033 | 362 | 362 |
| doi | 1 | 1 | 1 | 1 | 1 | 362 | 362 |
| firstAuthor | 1 | 0.9846 | 0.9846 | 0.9696 | 0.9696 | 362 | 362 |
| journal/venue | 0.9834 | 0.9916 | 0.9916 | 1 | 1 | 362 | 356 |
| title | 1 | 0.9972 | 0.9972 | 0.9945 | 0.9945 | 362 | 362 |
| url | 1 | 1 | 1 | 1 | 1 | 362 | 362 |
| year | 1 | 1 | 1 | 1 | 1 | 362 | 362 |
| repository | 1 | 1 | 1 | 1 | 1 | 314 | 314 |
| bookTitle | 0.875 | 0.9333 | 0.9333 | 1 | 1 | 48 | 42 |
| isbn | 0.875 | 0.2222 | 0.2222 | 0.1429 | 0.1429 | 48 | 42 |
| pages | 1 | 0 | 1 | 0 | 1 | 48 | 48 |
| publisher | 1 | 1 | 1 | 1 | 1 | 48 | 48 |

### Clean Citation Field Exactness

| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |
| --- | --- | --- | --- | --- | --- | --- |
| author | 0.9033 | 327 | 362 | 0 | 0 | 0 |
| title | 0.9945 | 360 | 362 | 0 | 0 | 0 |
| year | 1 | 362 | 362 | 0 | 0 | 0 |
| source | 1 | 362 | 362 | 0 | 0 | 0 |
| link | 1 | 362 | 362 | 0 | 0 | 0 |

### Clean Input Profiles

| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| doi_list | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_clean | 362 | 0.9116 | 0.7376 | 0.2072 | 0.0552 | 0.0165 | 0.9948 | 0.0023 | 0.6961 | 0 |
| structured_noisy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pasted_pdf_copy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| multiline_numbered | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ocr_like | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Clean Move-Level Repairs

| Phase | Reason | Total Repairs | Successful Repairs | Precision |
| --- | --- | --- | --- | --- |
| none | none | 0 | 0 | 0 |

## Noisy

- Macro Soft F1: 0.8017
- Instance Soft F1: 0.6579
- Type Accuracy: 0.8158 (31/38)
- Style Accuracy: 0.6316 (24/38)
- Style Family Accuracy: 0.7368 (28/38)
- Normalized Citation Exact-Match Rate: 0.0263 (38 compared)
- Required-Field Completeness: 0.961
- False-Fill Rate: 0.0152
- Accepted-Without-Edit Rate: 0.3421
- Mean Normalized Edit Distance: 0.2226 (38 compared)
- Unsupported False-Commit Rate: 0 (0 compared)
- Abstain Precision: 0.3684 (19 compared)
- Abstain Coverage: 0.5385 (13 required)

### Noisy Soft Field Metrics

| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |
| --- | --- | --- | --- | --- | --- | --- |
| authors | 22 | 15 | 1 | 0.5946 | 0.9565 | 0.7333 |
| bookTitle | 11 | 1 | 0 | 0.9167 | 1 | 0.9565 |
| doi | 22 | 0 | 16 | 1 | 0.5789 | 0.7333 |
| firstAuthor | 28 | 9 | 1 | 0.7568 | 0.9655 | 0.8485 |
| isbn | 0 | 3 | 9 | 0 | 0 | 0 |
| journal/venue | 34 | 1 | 3 | 0.9714 | 0.9189 | 0.9444 |
| pages | 12 | 0 | 0 | 1 | 1 | 1 |
| publisher | 10 | 2 | 0 | 0.8333 | 1 | 0.9091 |
| repository | 19 | 0 | 7 | 1 | 0.7308 | 0.8444 |
| title | 34 | 4 | 0 | 0.8947 | 1 | 0.9444 |
| url | 22 | 12 | 4 | 0.6471 | 0.8462 | 0.7333 |
| year | 36 | 0 | 2 | 1 | 0.9474 | 0.973 |

### Noisy Field Contract

| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| authors | 0.9737 | 0.7333 | 0.7333 | 0.5946 | 0.5946 | 38 | 37 |
| doi | 0.5789 | 0.7333 | 0.7333 | 1 | 1 | 38 | 22 |
| firstAuthor | 0.9737 | 0.8485 | 0.8485 | 0.7568 | 0.7568 | 38 | 37 |
| journal/venue | 0.9211 | 0.9444 | 0.9444 | 0.9714 | 0.9714 | 38 | 35 |
| title | 1 | 0.9444 | 0.9444 | 0.8947 | 0.8947 | 38 | 38 |
| url | 0.8947 | 0.7333 | 0.7333 | 0.6471 | 0.6471 | 38 | 34 |
| year | 0.9474 | 0.973 | 0.973 | 1 | 1 | 38 | 36 |
| repository | 0.7308 | 0.8444 | 0.8444 | 1 | 1 | 26 | 19 |
| bookTitle | 1 | 0.9565 | 0.9565 | 0.9167 | 0.9167 | 12 | 12 |
| isbn | 0.25 | 0 | 0 | 0 | 0 | 12 | 3 |
| pages | 1 | 0 | 1 | 0 | 1 | 12 | 12 |
| publisher | 1 | 0.9091 | 0.9091 | 0.8333 | 0.8333 | 12 | 12 |

### Noisy Citation Field Exactness

| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |
| --- | --- | --- | --- | --- | --- | --- |
| author | 0.5789 | 22 | 38 | 0 | 0 | 0 |
| title | 0.8947 | 34 | 38 | 0 | 0 | 0 |
| year | 0.9474 | 36 | 38 | 0 | 0 | 0 |
| source | 0.9211 | 35 | 38 | 0 | 0 | 0 |
| link | 0.5789 | 22 | 38 | 0 | 0 | 0 |

### Noisy Input Profiles

| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| doi_list | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_clean | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_noisy | 38 | 0.6579 | 0.5 | 0.2368 | 0.2632 | 0.0732 | 0.961 | 0.0152 | 0.3421 | 0.0263 |
| pasted_pdf_copy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| multiline_numbered | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ocr_like | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Noisy Move-Level Repairs

| Phase | Reason | Total Repairs | Successful Repairs | Precision |
| --- | --- | --- | --- | --- |
| normalization | normalization_field_mutation | 7 | 6 | 0.8571 |

## Cells Below Threshold

| Style | Type | Soft Instance F1 | Compared |
| --- | --- | --- | --- |
| apa7 | article-journal | 0 | 0 |
| apa7 | conference-paper | 0 | 0 |
| apa7 | book | 0 | 0 |
| apa7 | thesis | 0 | 0 |
| apa7 | report | 0 | 0 |
| apa7 | patent | 0 | 0 |
| apa7 | webpage | 0 | 0 |
| harvard-ctr | article-journal | 0 | 0 |
| harvard-ctr | conference-paper | 0 | 0 |
| harvard-ctr | book | 0 | 0 |
| harvard-ctr | thesis | 0 | 0 |
| harvard-ctr | report | 0 | 0 |
| harvard-ctr | patent | 0 | 0 |
| harvard-ctr | webpage | 0 | 0 |
| chicago-notes-bib | article-journal | 0 | 0 |
| chicago-notes-bib | conference-paper | 0 | 0 |
| chicago-notes-bib | book | 0 | 0 |
| chicago-notes-bib | thesis | 0 | 0 |
| chicago-notes-bib | report | 0 | 0 |
| chicago-notes-bib | patent | 0 | 0 |
| chicago-notes-bib | webpage | 0 | 0 |
| vancouver | article-journal | 0 | 0 |
| vancouver | conference-paper | 0 | 0 |
| vancouver | book | 0 | 0 |
| vancouver | thesis | 0 | 0 |
| vancouver | report | 0 | 0 |
| vancouver | patent | 0 | 0 |
| vancouver | webpage | 0 | 0 |
| ieee | article-journal | 0 | 0 |
| ieee | conference-paper | 0 | 0 |
| ieee | book | 0 | 0 |
| ieee | thesis | 0 | 0 |
| ieee | report | 0 | 0 |
| ieee | patent | 0 | 0 |
| ieee | webpage | 0 | 0 |
| mla9 | article-journal | 0 | 0 |
| mla9 | conference-paper | 0 | 0 |
| mla9 | book | 0 | 0 |
| mla9 | thesis | 0 | 0 |
| mla9 | report | 0 | 0 |
| mla9 | patent | 0 | 0 |
| mla9 | webpage | 0 | 0 |

## Contract Sanity Failures

- Field bookTitle prediction coverage 0.9 is at or below the hard floor 0.9.
- Field isbn prediction coverage 0.75 is at or below the hard floor 0.9.
