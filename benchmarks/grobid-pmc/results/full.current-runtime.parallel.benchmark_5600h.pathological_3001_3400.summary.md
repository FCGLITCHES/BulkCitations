# Grobid-Style Benchmark Summary

- Generated At: 2026-04-21T13:31:15.479Z
- Mode: full
- Profile: current-runtime
- Parse Profile: core_parse_fast
- Source Type: text
- Hardware Profile: benchmark_5600h
- Benchmark Variant: parallel
- Slice Preset: pathological_3001_3400
- Semantic Output Hash: sha256:a0d71f23b08c661aa8cdaf21de281b9e6040689ad779d5770efb1c4e95b7025a
- Measured Throughput (refs/sec): 132.14
- Measured Wall Clock (ms): 3027
- Slice Rows: 3001-3400 (400 rows)
- Scoring Spec: grobid-soft-v3
- Target Status: pass

## Contract Sanity

- Hard Failures: 0
- Warnings: 1

## Metric Legend

- `tp` (true positives): expected field matches that the engine got right.
- `fp` (false positives): field values the engine predicted but that did not match the expected field.
- `fn` (false negatives): expected field values the engine missed or failed to match.
- `precision`: of the values predicted for a field, how many were correct.
- `recall`: of the values expected for a field, how many were recovered.
- `f1`: harmonic mean of precision and recall; use this as the main per-field score.

## Clean

- Macro Soft F1: 0.9869
- Instance Soft F1: 0.9144
- Type Accuracy: 1 (362/362)
- Style Accuracy: 0.9779 (354/362)
- Style Family Accuracy: 1 (362/362)
- Throughput (refs/sec): 132.14
- Normalized Citation Exact-Match Rate: 0 (362 compared)
- Required-Field Completeness: 1
- False-Fill Rate: 0.0022
- Accepted-Without-Edit Rate: 0.442
- Mean Normalized Edit Distance: 0.2599 (362 compared)
- Unsupported False-Commit Rate: 0 (0 compared)
- Abstain Precision: 0.1094 (192 compared)
- Abstain Coverage: 0.6774 (31 required)

### Clean Adversarial Pair Accuracy

| Pair | Styles | Accuracy | Correct | Compared |
| --- | --- | --- | --- | --- |
| apa7_vs_harvard-ctr | apa7 vs harvard-ctr | 1 | 122 | 122 |
| mla9_vs_chicago-notes-bib | mla9 vs chicago-notes-bib | 0.9333 | 112 | 120 |
| vancouver_vs_ieee | vancouver vs ieee | 1 | 120 | 120 |

### Clean Soft Field Metrics

| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |
| --- | --- | --- | --- | --- | --- | --- |
| authors | 313 | 49 | 0 | 0.8646 | 1 | 0.9274 |
| bookTitle | 48 | 0 | 0 | 1 | 1 | 1 |
| doi | 362 | 0 | 0 | 1 | 1 | 1 |
| firstAuthor | 351 | 11 | 0 | 0.9696 | 1 | 0.9846 |
| isbn | 42 | 6 | 0 | 0.875 | 1 | 0.9333 |
| journal/venue | 362 | 0 | 0 | 1 | 1 | 1 |
| pages | 48 | 0 | 0 | 1 | 1 | 1 |
| publisher | 48 | 0 | 0 | 1 | 1 | 1 |
| repository | 314 | 0 | 0 | 1 | 1 | 1 |
| title | 360 | 2 | 0 | 0.9945 | 1 | 0.9972 |
| url | 362 | 0 | 0 | 1 | 1 | 1 |
| year | 362 | 0 | 0 | 1 | 1 | 1 |

### Clean Field Contract

| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| authors | 1 | 0.9274 | 0.9274 | 0.8646 | 0.8646 | 362 | 362 |
| doi | 1 | 1 | 1 | 1 | 1 | 362 | 362 |
| firstAuthor | 1 | 0.9846 | 0.9846 | 0.9696 | 0.9696 | 362 | 362 |
| journal/venue | 1 | 1 | 1 | 1 | 1 | 362 | 362 |
| title | 1 | 0.9972 | 0.9972 | 0.9945 | 0.9945 | 362 | 362 |
| url | 1 | 1 | 1 | 1 | 1 | 362 | 362 |
| year | 1 | 1 | 1 | 1 | 1 | 362 | 362 |
| repository | 1 | 1 | 1 | 1 | 1 | 314 | 314 |
| bookTitle | 1 | 1 | 1 | 1 | 1 | 48 | 48 |
| isbn | 1 | 0.9333 | 0.9333 | 0.875 | 0.875 | 48 | 48 |
| pages | 1 | 0 | 1 | 0 | 1 | 48 | 48 |
| publisher | 1 | 1 | 1 | 1 | 1 | 48 | 48 |

### Clean Citation Field Exactness

| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |
| --- | --- | --- | --- | --- | --- | --- |
| author | 0.8646 | 313 | 362 | 0 | 0 | 0 |
| title | 0.9945 | 360 | 362 | 0 | 0 | 0 |
| year | 1 | 362 | 362 | 0 | 0 | 0 |
| source | 1 | 362 | 362 | 0 | 0 | 0 |
| link | 1 | 362 | 362 | 0 | 0 | 0 |

### Clean Input Profiles

| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| doi_list | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_clean | 362 | 0.9144 | 0.4696 | 0.1713 | 0.3591 | 0.0135 | 1 | 0.0022 | 0.442 | 0 |
| structured_noisy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pasted_pdf_copy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| multiline_numbered | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ocr_like | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Clean Move-Level Repairs

| Phase | Reason | Total Repairs | Successful Repairs | Precision |
| --- | --- | --- | --- | --- |
| none | none | 0 | 0 | 0 |

## Noisy

- Macro Soft F1: 0.8188
- Instance Soft F1: 0.6053
- Type Accuracy: 0.8158 (31/38)
- Style Accuracy: 0.6316 (24/38)
- Style Family Accuracy: 0.7368 (28/38)
- Normalized Citation Exact-Match Rate: 0 (38 compared)
- Required-Field Completeness: 0.9415
- False-Fill Rate: 0.0115
- Accepted-Without-Edit Rate: 0.1316
- Mean Normalized Edit Distance: 0.268 (38 compared)
- Unsupported False-Commit Rate: 0 (0 compared)
- Abstain Precision: 0.4 (30 compared)
- Abstain Coverage: 0.8 (15 required)

### Noisy Soft Field Metrics

| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |
| --- | --- | --- | --- | --- | --- | --- |
| authors | 18 | 19 | 1 | 0.4865 | 0.9474 | 0.6429 |
| bookTitle | 11 | 1 | 0 | 0.9167 | 1 | 0.9565 |
| doi | 22 | 0 | 16 | 1 | 0.5789 | 0.7333 |
| firstAuthor | 28 | 9 | 1 | 0.7568 | 0.9655 | 0.8485 |
| isbn | 3 | 5 | 4 | 0.375 | 0.4286 | 0.4 |
| journal/venue | 33 | 1 | 4 | 0.9706 | 0.8919 | 0.9296 |
| pages | 12 | 0 | 0 | 1 | 1 | 1 |
| publisher | 10 | 2 | 0 | 0.8333 | 1 | 0.9091 |
| repository | 19 | 0 | 7 | 1 | 0.7308 | 0.8444 |
| title | 31 | 4 | 3 | 0.8857 | 0.9118 | 0.8986 |
| url | 22 | 12 | 4 | 0.6471 | 0.8462 | 0.7333 |
| year | 33 | 0 | 5 | 1 | 0.8684 | 0.9296 |

### Noisy Field Contract

| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| authors | 0.9737 | 0.6429 | 0.6429 | 0.4865 | 0.4865 | 38 | 37 |
| doi | 0.5789 | 0.7333 | 0.7333 | 1 | 1 | 38 | 22 |
| firstAuthor | 0.9737 | 0.8485 | 0.8485 | 0.7568 | 0.7568 | 38 | 37 |
| journal/venue | 0.8947 | 0.9296 | 0.9296 | 0.9706 | 0.9706 | 38 | 34 |
| title | 0.9211 | 0.8986 | 0.8986 | 0.8857 | 0.8857 | 38 | 35 |
| url | 0.8947 | 0.7333 | 0.7333 | 0.6471 | 0.6471 | 38 | 34 |
| year | 0.8684 | 0.9296 | 0.9296 | 1 | 1 | 38 | 33 |
| repository | 0.7308 | 0.8444 | 0.8444 | 1 | 1 | 26 | 19 |
| bookTitle | 1 | 0.9565 | 0.9565 | 0.9167 | 0.9167 | 12 | 12 |
| isbn | 0.6667 | 0.4 | 0.4 | 0.375 | 0.375 | 12 | 8 |
| pages | 1 | 0 | 1 | 0 | 1 | 12 | 12 |
| publisher | 1 | 0.9091 | 0.9091 | 0.8333 | 0.8333 | 12 | 12 |

### Noisy Citation Field Exactness

| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |
| --- | --- | --- | --- | --- | --- | --- |
| author | 0.4737 | 18 | 38 | 0 | 0 | 0 |
| title | 0.8158 | 31 | 38 | 0 | 0 | 0 |
| year | 0.8684 | 33 | 38 | 0 | 0 | 0 |
| source | 0.8947 | 34 | 38 | 0 | 0 | 0 |
| link | 0.5789 | 22 | 38 | 0 | 0 | 0 |

### Noisy Input Profiles

| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| doi_list | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_clean | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_noisy | 38 | 0.6053 | 0.2105 | 0.0789 | 0.7105 | 0.0927 | 0.9415 | 0.0115 | 0.1316 | 0 |
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

- None
