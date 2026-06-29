# Grobid-Style Benchmark Summary

- Generated At: 2026-04-21T14:34:14.676Z
- Mode: full
- Profile: current-runtime
- Parse Profile: core_parse_fast
- Source Type: text
- Hardware Profile: benchmark_5600h
- Benchmark Variant: parallel
- Semantic Output Hash: sha256:188f73a6d02bacff38fd70331274eabc5cf8528bb78c902d9a4424d4eb5379be
- Measured Throughput (refs/sec): 196.52
- Measured Wall Clock (ms): 34927
- Scoring Spec: grobid-soft-v3
- Target Status: pass

## Contract Sanity

- Hard Failures: 0
- Warnings: 2

## Metric Legend

- `tp` (true positives): expected field matches that the engine got right.
- `fp` (false positives): field values the engine predicted but that did not match the expected field.
- `fn` (false negatives): expected field values the engine missed or failed to match.
- `precision`: of the values predicted for a field, how many were correct.
- `recall`: of the values expected for a field, how many were recovered.
- `f1`: harmonic mean of precision and recall; use this as the main per-field score.

## Clean

- Macro Soft F1: 0.9876
- Instance Soft F1: 0.93
- Type Accuracy: 0.9913 (5948/6000)
- Style Accuracy: 0.9373 (5624/6000)
- Style Family Accuracy: 0.9775 (5865/6000)
- Throughput (refs/sec): 196.52
- Normalized Citation Exact-Match Rate: 0 (6000 compared)
- Required-Field Completeness: 0.998
- False-Fill Rate: 0.0496
- Accepted-Without-Edit Rate: 0.2207
- Mean Normalized Edit Distance: 0.3114 (6000 compared)
- Unsupported False-Commit Rate: 0 (0 compared)
- Abstain Precision: 0.0687 (4570 compared)
- Abstain Coverage: 0.7476 (420 required)

### Clean Adversarial Pair Accuracy

| Pair | Styles | Accuracy | Correct | Compared |
| --- | --- | --- | --- | --- |
| apa7_vs_harvard-ctr | apa7 vs harvard-ctr | 0.892 | 1784 | 2000 |
| mla9_vs_chicago-notes-bib | mla9 vs chicago-notes-bib | 0.9285 | 1857 | 2000 |
| vancouver_vs_ieee | vancouver vs ieee | 0.9915 | 1983 | 2000 |

### Clean Soft Field Metrics

| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |
| --- | --- | --- | --- | --- | --- | --- |
| authors | 3760 | 362 | 0 | 0.9122 | 1 | 0.9541 |
| bookTitle | 655 | 1 | 10 | 0.9985 | 0.985 | 0.9917 |
| conferenceTitle | 656 | 7 | 3 | 0.9894 | 0.9954 | 0.9924 |
| doi | 4668 | 0 | 0 | 1 | 1 | 1 |
| firstAuthor | 4031 | 91 | 0 | 0.9779 | 1 | 0.9888 |
| institution | 1376 | 16 | 18 | 0.9885 | 0.9871 | 0.9878 |
| isbn | 1046 | 168 | 46 | 0.8616 | 0.9579 | 0.9072 |
| issn | 668 | 0 | 16 | 1 | 0.9766 | 0.9882 |
| issue | 644 | 0 | 10 | 1 | 0.9847 | 0.9923 |
| journal/venue | 5275 | 58 | 1 | 0.9891 | 0.9998 | 0.9944 |
| pages | 1372 | 8 | 0 | 0.9942 | 1 | 0.9971 |
| patent | 665 | 1 | 0 | 0.9985 | 1 | 0.9992 |
| publisher | 1929 | 28 | 23 | 0.9857 | 0.9882 | 0.987 |
| repository | 660 | 0 | 6 | 1 | 0.991 | 0.9955 |
| siteName | 666 | 0 | 0 | 1 | 1 | 1 |
| thesisType | 662 | 4 | 0 | 0.994 | 1 | 0.997 |
| title | 5841 | 159 | 0 | 0.9735 | 1 | 0.9866 |
| url | 5999 | 1 | 0 | 0.9998 | 1 | 0.9999 |
| volume | 656 | 1 | 9 | 0.9985 | 0.9865 | 0.9924 |
| year | 5998 | 2 | 0 | 0.9997 | 1 | 0.9998 |

### Clean Field Contract

| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| title | 1 | 0.9866 | 0.9866 | 0.9735 | 0.9735 | 6000 | 6000 |
| url | 1 | 0.9999 | 0.9999 | 0.9998 | 0.9998 | 6000 | 6000 |
| year | 1 | 0.9998 | 0.9998 | 0.9997 | 0.9997 | 6000 | 6000 |
| journal/venue | 0.9998 | 0.9942 | 0.9944 | 0.9886 | 0.9891 | 5334 | 5333 |
| doi | 1 | 1 | 1 | 1 | 1 | 4668 | 4668 |
| authors | 1 | 0.9541 | 0.9541 | 0.9122 | 0.9122 | 4122 | 4122 |
| firstAuthor | 1 | 0.9888 | 0.9888 | 0.9779 | 0.9779 | 4122 | 4122 |
| publisher | 0.9884 | 0.9849 | 0.987 | 0.9816 | 0.9857 | 1980 | 1957 |
| institution | 0.9872 | 0.9878 | 0.9878 | 0.9885 | 0.9885 | 1410 | 1392 |
| pages | 1 | 0.0833 | 0.9971 | 0.0435 | 0.9942 | 1380 | 1380 |
| isbn | 0.9635 | 0.9072 | 0.9072 | 0.8616 | 0.8616 | 1260 | 1214 |
| issn | 0.9766 | 0.9882 | 0.9882 | 1 | 1 | 684 | 668 |
| bookTitle | 0.985 | 0.9901 | 0.9917 | 0.9954 | 0.9985 | 666 | 656 |
| conferenceTitle | 0.9955 | 0.9924 | 0.9924 | 0.9894 | 0.9894 | 666 | 663 |
| patent | 1 | 0.9992 | 0.9992 | 0.9985 | 0.9985 | 666 | 666 |
| repository | 0.991 | 0.9955 | 0.9955 | 1 | 1 | 666 | 660 |
| siteName | 1 | 1 | 1 | 1 | 1 | 666 | 666 |
| thesisType | 1 | 0.997 | 0.997 | 0.994 | 0.994 | 666 | 666 |
| volume | 0.9865 | 0.9924 | 0.9924 | 0.9985 | 0.9985 | 666 | 657 |
| issue | 0.9847 | 0.9789 | 0.9923 | 0.9736 | 1 | 654 | 644 |

### Clean Citation Field Exactness

| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |
| --- | --- | --- | --- | --- | --- | --- |
| author | 0.9122 | 3760 | 4122 | 0 | 0 | 1549 |
| title | 0.9735 | 5841 | 6000 | 0 | 0 | 0 |
| year | 0.9997 | 5998 | 6000 | 0 | 0 | 0 |
| source | 0.9908 | 5285 | 5334 | 1 | 666 | 666 |
| link | 0.9998 | 5999 | 6000 | 0 | 0 | 0 |

### Clean Input Profiles

| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| doi_list | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_clean | 6000 | 0.93 | 0.2383 | 0.174 | 0.5877 | 0.0124 | 0.998 | 0.0496 | 0.2207 | 0 |
| structured_noisy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pasted_pdf_copy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| multiline_numbered | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ocr_like | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Clean Move-Level Repairs

| Phase | Reason | Total Repairs | Successful Repairs | Precision |
| --- | --- | --- | --- | --- |
| shared_repair | shared_repair_field_mutation | 184 | 0 | 0 |
| normalization | normalization_field_mutation | 6 | 6 | 1 |

## Noisy

- Macro Soft F1: 0.8545
- Instance Soft F1: 0.706
- Type Accuracy: 0.8623 (745/864)
- Style Accuracy: 0.6516 (563/864)
- Style Family Accuracy: 0.8056 (696/864)
- Normalized Citation Exact-Match Rate: 0.0023 (864 compared)
- Required-Field Completeness: 0.954
- False-Fill Rate: 0.0662
- Accepted-Without-Edit Rate: 0.1042
- Mean Normalized Edit Distance: 0.3037 (864 compared)
- Unsupported False-Commit Rate: 0 (0 compared)
- Abstain Precision: 0.2935 (736 compared)
- Abstain Coverage: 0.8504 (254 required)

### Noisy Soft Field Metrics

| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |
| --- | --- | --- | --- | --- | --- | --- |
| authors | 309 | 250 | 5 | 0.5528 | 0.9841 | 0.7079 |
| bookTitle | 93 | 21 | 12 | 0.8158 | 0.8857 | 0.8493 |
| conferenceTitle | 58 | 21 | 17 | 0.7342 | 0.7733 | 0.7532 |
| doi | 406 | 0 | 206 | 1 | 0.6634 | 0.7976 |
| firstAuthor | 426 | 133 | 5 | 0.7621 | 0.9884 | 0.8606 |
| institution | 109 | 23 | 18 | 0.8258 | 0.8583 | 0.8417 |
| isbn | 115 | 35 | 72 | 0.7667 | 0.615 | 0.6825 |
| issn | 71 | 0 | 19 | 1 | 0.7889 | 0.882 |
| issue | 78 | 2 | 10 | 0.975 | 0.8864 | 0.9286 |
| journal/venue | 572 | 96 | 70 | 0.8563 | 0.891 | 0.8733 |
| pages | 211 | 2 | 9 | 0.9906 | 0.9591 | 0.9746 |
| patent | 126 | 0 | 0 | 1 | 1 | 1 |
| publisher | 208 | 47 | 63 | 0.8157 | 0.7675 | 0.7909 |
| repository | 52 | 0 | 20 | 1 | 0.7222 | 0.8387 |
| siteName | 81 | 2 | 43 | 0.9759 | 0.6532 | 0.7826 |
| thesisType | 62 | 1 | 9 | 0.9841 | 0.8732 | 0.9254 |
| title | 687 | 163 | 14 | 0.8082 | 0.98 | 0.8859 |
| url | 620 | 204 | 40 | 0.7524 | 0.9394 | 0.8356 |
| volume | 71 | 7 | 6 | 0.9103 | 0.9221 | 0.9161 |
| year | 803 | 11 | 50 | 0.9865 | 0.9414 | 0.9634 |

### Noisy Field Contract

| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| title | 0.9838 | 0.8859 | 0.8859 | 0.8082 | 0.8082 | 864 | 850 |
| url | 0.9537 | 0.8356 | 0.8356 | 0.7524 | 0.7524 | 864 | 824 |
| year | 0.9421 | 0.9634 | 0.9634 | 0.9865 | 0.9865 | 864 | 814 |
| journal/venue | 0.9051 | 0.8733 | 0.8733 | 0.8563 | 0.8563 | 738 | 668 |
| doi | 0.6634 | 0.7976 | 0.7976 | 1 | 1 | 612 | 406 |
| authors | 0.9911 | 0.7079 | 0.7079 | 0.5528 | 0.5528 | 564 | 559 |
| firstAuthor | 0.9911 | 0.8606 | 0.8606 | 0.7621 | 0.7621 | 564 | 559 |
| publisher | 0.8019 | 0.7886 | 0.7909 | 0.8118 | 0.8157 | 318 | 255 |
| isbn | 0.6757 | 0.6825 | 0.6825 | 0.7667 | 0.7667 | 222 | 150 |
| pages | 0.9595 | 0 | 0.9746 | 0 | 0.9906 | 222 | 213 |
| institution | 0.88 | 0.8048 | 0.8417 | 0.7652 | 0.8258 | 150 | 132 |
| bookTitle | 0.9048 | 0.8493 | 0.8493 | 0.8158 | 0.8158 | 126 | 114 |
| patent | 1 | 1 | 1 | 1 | 1 | 126 | 126 |
| siteName | 0.6587 | 0.7826 | 0.7826 | 0.9759 | 0.9759 | 126 | 83 |
| conferenceTitle | 0.8229 | 0.7532 | 0.7532 | 0.7342 | 0.7342 | 96 | 79 |
| issn | 0.7889 | 0.882 | 0.882 | 1 | 1 | 90 | 71 |
| issue | 0.8889 | 0.9286 | 0.9286 | 0.975 | 0.975 | 90 | 80 |
| volume | 0.9286 | 0.9161 | 0.9161 | 0.9103 | 0.9103 | 84 | 78 |
| repository | 0.7222 | 0.8387 | 0.8387 | 1 | 1 | 72 | 52 |
| thesisType | 0.875 | 0.9254 | 0.9254 | 0.9841 | 0.9841 | 72 | 63 |

### Noisy Citation Field Exactness

| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |
| --- | --- | --- | --- | --- | --- | --- |
| author | 0.5479 | 309 | 564 | 0 | 0 | 257 |
| title | 0.7951 | 687 | 864 | 0 | 0 | 0 |
| year | 0.9294 | 803 | 864 | 0 | 0 | 0 |
| source | 0.8266 | 610 | 738 | 1 | 123 | 123 |
| link | 0.7176 | 620 | 864 | 0 | 0 | 0 |

### Noisy Input Profiles

| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| doi_list | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_clean | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_noisy | 864 | 0.706 | 0.1481 | 0.059 | 0.7928 | 0.094 | 0.954 | 0.0662 | 0.1042 | 0.0023 |
| pasted_pdf_copy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| multiline_numbered | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ocr_like | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Noisy Move-Level Repairs

| Phase | Reason | Total Repairs | Successful Repairs | Precision |
| --- | --- | --- | --- | --- |
| normalization | normalization_field_mutation | 84 | 52 | 0.619 |
| shared_repair | shared_repair_field_mutation | 16 | 2 | 0.125 |

## Cells Below Threshold

| Style | Type | Soft Instance F1 | Compared |
| --- | --- | --- | --- |

## Contract Sanity Failures

- None
