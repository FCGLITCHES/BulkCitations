# Grobid-Style Benchmark Summary

- Generated At: 2026-04-21T13:27:11.917Z
- Mode: pilot
- Profile: current-runtime
- Parse Profile: core_parse_fast
- Source Type: text
- Hardware Profile: benchmark_5600h
- Benchmark Variant: grobid_compare
- Semantic Output Hash: sha256:02de05b2a2e0c6780e7f503527b0647b5eea61abf46f9a6faafac18962424cf5
- Measured Throughput (refs/sec): 34.86
- Measured Wall Clock (ms): 39072
- Scoring Spec: grobid-soft-v3
- Target Status: pass

## Contract Sanity

- Hard Failures: 0
- Warnings: 0

## Metric Legend

- `tp` (true positives): expected field matches that the engine got right.
- `fp` (false positives): field values the engine predicted but that did not match the expected field.
- `fn` (false negatives): expected field values the engine missed or failed to match.
- `precision`: of the values predicted for a field, how many were correct.
- `recall`: of the values expected for a field, how many were recovered.
- `f1`: harmonic mean of precision and recall; use this as the main per-field score.

## Clean

- Macro Soft F1: 0.9895
- Instance Soft F1: 0.945
- Type Accuracy: 0.9958 (1195/1200)
- Style Accuracy: 0.9408 (1129/1200)
- Style Family Accuracy: 0.9808 (1177/1200)
- Throughput (refs/sec): 34.86
- Normalized Citation Exact-Match Rate: 0 (1200 compared)
- Required-Field Completeness: 0.9987
- False-Fill Rate: 0.05
- Accepted-Without-Edit Rate: 0.2258
- Mean Normalized Edit Distance: 0.3097 (1200 compared)
- Unsupported False-Commit Rate: 0 (0 compared)
- Abstain Precision: 0.0506 (909 compared)
- Abstain Coverage: 0.697 (66 required)

### Clean Adversarial Pair Accuracy

| Pair | Styles | Accuracy | Correct | Compared |
| --- | --- | --- | --- | --- |
| apa7_vs_harvard-ctr | apa7 vs harvard-ctr | 0.895 | 358 | 400 |
| mla9_vs_chicago-notes-bib | mla9 vs chicago-notes-bib | 0.9325 | 373 | 400 |
| vancouver_vs_ieee | vancouver vs ieee | 0.995 | 398 | 400 |

### Clean Soft Field Metrics

| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |
| --- | --- | --- | --- | --- | --- | --- |
| authors | 769 | 47 | 0 | 0.9424 | 1 | 0.9703 |
| bookTitle | 132 | 0 | 0 | 1 | 1 | 1 |
| conferenceTitle | 138 | 0 | 0 | 1 | 1 | 1 |
| doi | 936 | 0 | 0 | 1 | 1 | 1 |
| firstAuthor | 811 | 5 | 0 | 0.9939 | 1 | 0.9969 |
| institution | 274 | 2 | 0 | 0.9928 | 1 | 0.9964 |
| isbn | 210 | 48 | 0 | 0.814 | 1 | 0.8974 |
| issn | 133 | 0 | 5 | 1 | 0.9638 | 0.9815 |
| issue | 133 | 0 | 5 | 1 | 0.9638 | 0.9815 |
| journal/venue | 1060 | 8 | 0 | 0.9925 | 1 | 0.9962 |
| pages | 258 | 0 | 0 | 1 | 1 | 1 |
| patent | 132 | 0 | 0 | 1 | 1 | 1 |
| publisher | 400 | 1 | 1 | 0.9975 | 0.9975 | 0.9975 |
| repository | 132 | 0 | 0 | 1 | 1 | 1 |
| siteName | 132 | 0 | 0 | 1 | 1 | 1 |
| thesisType | 132 | 0 | 0 | 1 | 1 | 1 |
| title | 1180 | 20 | 0 | 0.9833 | 1 | 0.9916 |
| url | 1200 | 0 | 0 | 1 | 1 | 1 |
| volume | 133 | 0 | 5 | 1 | 0.9638 | 0.9815 |
| year | 1200 | 0 | 0 | 1 | 1 | 1 |

### Clean Field Contract

| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| title | 1 | 0.9916 | 0.9916 | 0.9833 | 0.9833 | 1200 | 1200 |
| url | 1 | 1 | 1 | 1 | 1 | 1200 | 1200 |
| year | 1 | 1 | 1 | 1 | 1 | 1200 | 1200 |
| journal/venue | 1 | 0.9962 | 0.9962 | 0.9925 | 0.9925 | 1068 | 1068 |
| doi | 1 | 1 | 1 | 1 | 1 | 936 | 936 |
| authors | 1 | 0.9703 | 0.9703 | 0.9424 | 0.9424 | 816 | 816 |
| firstAuthor | 1 | 0.9969 | 0.9969 | 0.9939 | 0.9939 | 816 | 816 |
| publisher | 0.9975 | 0.9975 | 0.9975 | 0.9975 | 0.9975 | 402 | 401 |
| institution | 1 | 0.9964 | 0.9964 | 0.9928 | 0.9928 | 276 | 276 |
| isbn | 1 | 0.8974 | 0.8974 | 0.814 | 0.814 | 258 | 258 |
| pages | 1 | 0.0889 | 1 | 0.0465 | 1 | 258 | 258 |
| conferenceTitle | 1 | 1 | 1 | 1 | 1 | 138 | 138 |
| issn | 0.9638 | 0.9815 | 0.9815 | 1 | 1 | 138 | 133 |
| issue | 0.9638 | 0.9815 | 0.9815 | 1 | 1 | 138 | 133 |
| volume | 0.9638 | 0.9815 | 0.9815 | 1 | 1 | 138 | 133 |
| bookTitle | 1 | 1 | 1 | 1 | 1 | 132 | 132 |
| patent | 1 | 1 | 1 | 1 | 1 | 132 | 132 |
| repository | 1 | 1 | 1 | 1 | 1 | 132 | 132 |
| siteName | 1 | 1 | 1 | 1 | 1 | 132 | 132 |
| thesisType | 1 | 1 | 1 | 1 | 1 | 132 | 132 |

### Clean Citation Field Exactness

| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |
| --- | --- | --- | --- | --- | --- | --- |
| author | 0.9424 | 769 | 816 | 0 | 0 | 316 |
| title | 0.9833 | 1180 | 1200 | 0 | 0 | 0 |
| year | 1 | 1200 | 1200 | 0 | 0 | 0 |
| source | 0.9925 | 1060 | 1068 | 1 | 132 | 132 |
| link | 1 | 1200 | 1200 | 0 | 0 | 0 |

### Clean Input Profiles

| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| doi_list | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_clean | 1200 | 0.945 | 0.2425 | 0.18 | 0.5775 | 0.0093 | 0.9987 | 0.05 | 0.2258 | 0 |
| structured_noisy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pasted_pdf_copy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| multiline_numbered | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ocr_like | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Clean Move-Level Repairs

| Phase | Reason | Total Repairs | Successful Repairs | Precision |
| --- | --- | --- | --- | --- |
| shared_repair | shared_repair_field_mutation | 36 | 0 | 0 |

## Noisy

- Macro Soft F1: 0.8809
- Instance Soft F1: 0.7654
- Type Accuracy: 0.9383 (152/162)
- Style Accuracy: 0.6975 (113/162)
- Style Family Accuracy: 0.7963 (129/162)
- Normalized Citation Exact-Match Rate: 0.0062 (162 compared)
- Required-Field Completeness: 0.9827
- False-Fill Rate: 0.0668
- Accepted-Without-Edit Rate: 0.0926
- Mean Normalized Edit Distance: 0.3096 (162 compared)
- Unsupported False-Commit Rate: 0 (0 compared)
- Abstain Precision: 0.2101 (138 compared)
- Abstain Coverage: 0.7632 (38 required)

### Noisy Soft Field Metrics

| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |
| --- | --- | --- | --- | --- | --- | --- |
| authors | 46 | 38 | 0 | 0.5476 | 1 | 0.7077 |
| bookTitle | 11 | 1 | 0 | 0.9167 | 1 | 0.9565 |
| doi | 83 | 0 | 31 | 1 | 0.7281 | 0.8426 |
| firstAuthor | 58 | 26 | 0 | 0.6905 | 1 | 0.8169 |
| institution | 38 | 10 | 6 | 0.7917 | 0.8636 | 0.8261 |
| isbn | 16 | 9 | 11 | 0.64 | 0.5926 | 0.6154 |
| issn | 22 | 0 | 2 | 1 | 0.9167 | 0.9565 |
| issue | 23 | 0 | 1 | 1 | 0.9583 | 0.9787 |
| journal/venue | 118 | 16 | 4 | 0.8806 | 0.9672 | 0.9219 |
| pages | 29 | 0 | 1 | 1 | 0.9667 | 0.9831 |
| patent | 24 | 0 | 0 | 1 | 1 | 1 |
| publisher | 31 | 4 | 1 | 0.8857 | 0.9688 | 0.9254 |
| repository | 4 | 0 | 2 | 1 | 0.6667 | 0.8 |
| siteName | 21 | 0 | 3 | 1 | 0.875 | 0.9333 |
| thesisType | 10 | 0 | 2 | 1 | 0.8333 | 0.9091 |
| title | 128 | 33 | 1 | 0.795 | 0.9922 | 0.8828 |
| url | 121 | 37 | 4 | 0.7658 | 0.968 | 0.8551 |
| volume | 18 | 5 | 1 | 0.7826 | 0.9474 | 0.8571 |
| year | 152 | 0 | 10 | 1 | 0.9383 | 0.9682 |

### Noisy Field Contract

| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| title | 0.9938 | 0.8828 | 0.8828 | 0.795 | 0.795 | 162 | 161 |
| url | 0.9753 | 0.8551 | 0.8551 | 0.7658 | 0.7658 | 162 | 158 |
| year | 0.9383 | 0.9682 | 0.9682 | 1 | 1 | 162 | 152 |
| journal/venue | 0.971 | 0.9219 | 0.9219 | 0.8806 | 0.8806 | 138 | 134 |
| doi | 0.7281 | 0.8426 | 0.8426 | 1 | 1 | 114 | 83 |
| authors | 1 | 0.7077 | 0.7077 | 0.5476 | 0.5476 | 84 | 84 |
| firstAuthor | 1 | 0.8169 | 0.8169 | 0.6905 | 0.6905 | 84 | 84 |
| institution | 0.8889 | 0.7727 | 0.8261 | 0.7083 | 0.7917 | 54 | 48 |
| isbn | 0.6944 | 0.6154 | 0.6154 | 0.64 | 0.64 | 36 | 25 |
| publisher | 0.9722 | 0.9254 | 0.9254 | 0.8857 | 0.8857 | 36 | 35 |
| pages | 0.9667 | 0 | 0.9831 | 0 | 1 | 30 | 29 |
| issn | 0.9167 | 0.9565 | 0.9565 | 1 | 1 | 24 | 22 |
| issue | 0.9583 | 0.9787 | 0.9787 | 1 | 1 | 24 | 23 |
| patent | 1 | 1 | 1 | 1 | 1 | 24 | 24 |
| siteName | 0.875 | 0.9333 | 0.9333 | 1 | 1 | 24 | 21 |
| volume | 0.9583 | 0.8571 | 0.8571 | 0.7826 | 0.7826 | 24 | 23 |
| bookTitle | 1 | 0.9565 | 0.9565 | 0.9167 | 0.9167 | 12 | 12 |
| thesisType | 0.8333 | 0.9091 | 0.9091 | 1 | 1 | 12 | 10 |
| repository | 0.6667 | 0.8 | 0.8 | 1 | 1 | 6 | 4 |

### Noisy Citation Field Exactness

| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |
| --- | --- | --- | --- | --- | --- | --- |
| author | 0.5476 | 46 | 84 | 0 | 0 | 57 |
| title | 0.7901 | 128 | 162 | 0 | 0 | 0 |
| year | 0.9383 | 152 | 162 | 0 | 0 | 0 |
| source | 0.8768 | 121 | 138 | 1 | 23 | 23 |
| link | 0.7469 | 121 | 162 | 0 | 0 | 0 |

### Noisy Input Profiles

| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| doi_list | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_clean | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_noisy | 162 | 0.7654 | 0.1481 | 0.0988 | 0.7531 | 0.0716 | 0.9827 | 0.0668 | 0.0926 | 0.0062 |
| pasted_pdf_copy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| multiline_numbered | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ocr_like | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Noisy Move-Level Repairs

| Phase | Reason | Total Repairs | Successful Repairs | Precision |
| --- | --- | --- | --- | --- |
| normalization | normalization_field_mutation | 17 | 8 | 0.4706 |
| shared_repair | shared_repair_field_mutation | 2 | 0 | 0 |

## Cells Below Threshold

| Style | Type | Soft Instance F1 | Compared |
| --- | --- | --- | --- |

## Contract Sanity Failures

- None
