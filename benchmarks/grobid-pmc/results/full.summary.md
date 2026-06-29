# Grobid-Style Benchmark Summary

- Generated At: 2026-04-14T15:39:54.456Z
- Mode: full
- Profile: heuristic-only
- Scoring Spec: grobid-soft-v3
- Target Status: pass

## Contract Sanity

- Hard Failures: 0
- Warnings: 3

## Metric Legend

- `tp` (true positives): expected field matches that the engine got right.
- `fp` (false positives): field values the engine predicted but that did not match the expected field.
- `fn` (false negatives): expected field values the engine missed or failed to match.
- `precision`: of the values predicted for a field, how many were correct.
- `recall`: of the values expected for a field, how many were recovered.
- `f1`: harmonic mean of precision and recall; use this as the main per-field score.

## Clean

- Macro Soft F1: 0.9582
- Instance Soft F1: 0.9293
- Type Accuracy: 0.9878 (5927/6000)
- Style Accuracy: 0.9373 (5624/6000)
- Style Family Accuracy: 0.9775 (5865/6000)
- Throughput (refs/sec): 60.37
- Normalized Citation Exact-Match Rate: 0 (6000 compared)
- Required-Field Completeness: 0.9975
- False-Fill Rate: 0.056
- Accepted-Without-Edit Rate: 0.599
- Mean Normalized Edit Distance: 0.3086 (6000 compared)
- Unsupported False-Commit Rate: 0 (0 compared)
- Abstain Precision: 0.076 (2145 compared)
- Abstain Coverage: 0.3844 (424 required)

### Clean Adversarial Pair Accuracy

| Pair | Styles | Accuracy | Correct | Compared |
| --- | --- | --- | --- | --- |
| apa7_vs_harvard-ctr | apa7 vs harvard-ctr | 0.892 | 1784 | 2000 |
| mla9_vs_chicago-notes-bib | mla9 vs chicago-notes-bib | 0.9285 | 1857 | 2000 |
| vancouver_vs_ieee | vancouver vs ieee | 0.9915 | 1983 | 2000 |

### Clean Soft Field Metrics

| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |
| --- | --- | --- | --- | --- | --- | --- |
| authors | 3912 | 210 | 0 | 0.9491 | 1 | 0.9739 |
| bookTitle | 649 | 1 | 16 | 0.9985 | 0.9759 | 0.9871 |
| conferenceTitle | 632 | 7 | 27 | 0.989 | 0.959 | 0.9738 |
| doi | 4668 | 0 | 0 | 1 | 1 | 1 |
| firstAuthor | 4007 | 115 | 0 | 0.9721 | 1 | 0.9859 |
| institution | 1371 | 21 | 18 | 0.9849 | 0.987 | 0.986 |
| isbn | 240 | 968 | 52 | 0.1987 | 0.8219 | 0.32 |
| issn | 677 | 0 | 7 | 1 | 0.9898 | 0.9949 |
| issue | 653 | 0 | 1 | 1 | 0.9985 | 0.9992 |
| journal/venue | 5243 | 84 | 7 | 0.9842 | 0.9987 | 0.9914 |
| pages | 1372 | 8 | 0 | 0.9942 | 1 | 0.9971 |
| patent | 665 | 1 | 0 | 0.9985 | 1 | 0.9992 |
| publisher | 1905 | 28 | 47 | 0.9855 | 0.9759 | 0.9807 |
| repository | 660 | 0 | 6 | 1 | 0.991 | 0.9955 |
| siteName | 664 | 2 | 0 | 0.997 | 1 | 0.9985 |
| thesisType | 662 | 4 | 0 | 0.994 | 1 | 0.997 |
| title | 5825 | 175 | 0 | 0.9708 | 1 | 0.9852 |
| url | 5999 | 1 | 0 | 0.9998 | 1 | 0.9999 |
| volume | 665 | 1 | 0 | 0.9985 | 1 | 0.9992 |
| year | 5998 | 2 | 0 | 0.9997 | 1 | 0.9998 |

### Clean Field Contract

| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| title | 1 | 0.9852 | 0.9852 | 0.9708 | 0.9708 | 6000 | 6000 |
| url | 1 | 0.9999 | 0.9999 | 0.9998 | 0.9998 | 6000 | 6000 |
| year | 1 | 0.9998 | 0.9998 | 0.9997 | 0.9997 | 6000 | 6000 |
| journal/venue | 0.9987 | 0.9911 | 0.9914 | 0.9837 | 0.9842 | 5334 | 5327 |
| doi | 1 | 1 | 1 | 1 | 1 | 4668 | 4668 |
| authors | 1 | 0.9739 | 0.9739 | 0.9491 | 0.9491 | 4122 | 4122 |
| firstAuthor | 1 | 0.9859 | 0.9859 | 0.9721 | 0.9721 | 4122 | 4122 |
| publisher | 0.9763 | 0.9786 | 0.9807 | 0.9814 | 0.9855 | 1980 | 1933 |
| institution | 0.9872 | 0.986 | 0.986 | 0.9849 | 0.9849 | 1410 | 1392 |
| pages | 1 | 0.0833 | 0.9971 | 0.0435 | 0.9942 | 1380 | 1380 |
| isbn | 0.9587 | 0.32 | 0.32 | 0.1987 | 0.1987 | 1260 | 1208 |
| issn | 0.9898 | 0.9949 | 0.9949 | 1 | 1 | 684 | 677 |
| bookTitle | 0.976 | 0.9855 | 0.9871 | 0.9954 | 0.9985 | 666 | 650 |
| conferenceTitle | 0.9595 | 0.9738 | 0.9738 | 0.989 | 0.989 | 666 | 639 |
| patent | 1 | 0.9992 | 0.9992 | 0.9985 | 0.9985 | 666 | 666 |
| repository | 0.991 | 0.9955 | 0.9955 | 1 | 1 | 666 | 660 |
| siteName | 1 | 0.9985 | 0.9985 | 0.997 | 0.997 | 666 | 666 |
| thesisType | 1 | 0.997 | 0.997 | 0.994 | 0.994 | 666 | 666 |
| volume | 1 | 0.9992 | 0.9992 | 0.9985 | 0.9985 | 666 | 666 |
| issue | 0.9985 | 0.986 | 0.9992 | 0.974 | 1 | 654 | 653 |

### Clean Citation Field Exactness

| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |
| --- | --- | --- | --- | --- | --- | --- |
| author | 0.9491 | 3912 | 4122 | 0 | 0 | 1854 |
| title | 0.9708 | 5825 | 6000 | 0 | 0 | 0 |
| year | 0.9997 | 5998 | 6000 | 0 | 0 | 0 |
| source | 0.9908 | 5285 | 5334 | 1 | 666 | 666 |
| link | 0.9998 | 5999 | 6000 | 0 | 0 | 0 |

### Clean Input Profiles

| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| doi_list | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_clean | 6000 | 0.9293 | 0.6425 | 0.3173 | 0.0402 | 0.0128 | 0.9975 | 0.056 | 0.599 | 0 |
| structured_noisy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pasted_pdf_copy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| multiline_numbered | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ocr_like | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Clean Move-Level Repairs

| Phase | Reason | Total Repairs | Successful Repairs | Precision |
| --- | --- | --- | --- | --- |
| shared_repair | shared_repair_field_mutation | 250 | 0 | 0 |
| normalization | normalization_field_mutation | 6 | 6 | 1 |

## Noisy

- Macro Soft F1: 0.8371
- Instance Soft F1: 0.6921
- Type Accuracy: 0.8299 (717/864)
- Style Accuracy: 0.6447 (557/864)
- Style Family Accuracy: 0.8009 (692/864)
- Normalized Citation Exact-Match Rate: 0.0046 (864 compared)
- Required-Field Completeness: 0.9524
- False-Fill Rate: 0.0759
- Accepted-Without-Edit Rate: 0.4537
- Mean Normalized Edit Distance: 0.3036 (864 compared)
- Unsupported False-Commit Rate: 0 (0 compared)
- Abstain Precision: 0.4213 (356 compared)
- Abstain Coverage: 0.5639 (266 required)

### Noisy Soft Field Metrics

| Field | TP (matched expected) | FP (wrong predicted) | FN (missed expected) | Precision (correct / predicted) | Recall (recovered / expected) | F1 (balanced score) |
| --- | --- | --- | --- | --- | --- | --- |
| authors | 343 | 216 | 5 | 0.6136 | 0.9856 | 0.7563 |
| bookTitle | 91 | 19 | 16 | 0.8273 | 0.8505 | 0.8387 |
| conferenceTitle | 59 | 20 | 17 | 0.7468 | 0.7763 | 0.7613 |
| doi | 406 | 0 | 206 | 1 | 0.6634 | 0.7976 |
| firstAuthor | 417 | 142 | 5 | 0.746 | 0.9882 | 0.8502 |
| institution | 87 | 16 | 47 | 0.8447 | 0.6493 | 0.7342 |
| isbn | 31 | 113 | 78 | 0.2153 | 0.2844 | 0.2451 |
| issn | 78 | 0 | 12 | 1 | 0.8667 | 0.9286 |
| issue | 85 | 2 | 3 | 0.977 | 0.9659 | 0.9714 |
| journal/venue | 558 | 115 | 65 | 0.8291 | 0.8957 | 0.8611 |
| pages | 218 | 2 | 2 | 0.9909 | 0.9909 | 0.9909 |
| patent | 126 | 0 | 0 | 1 | 1 | 1 |
| publisher | 212 | 49 | 57 | 0.8123 | 0.7881 | 0.8 |
| repository | 52 | 0 | 20 | 1 | 0.7222 | 0.8387 |
| siteName | 80 | 3 | 43 | 0.9639 | 0.6504 | 0.7767 |
| thesisType | 62 | 4 | 6 | 0.9394 | 0.9118 | 0.9254 |
| title | 696 | 159 | 9 | 0.814 | 0.9872 | 0.8923 |
| url | 620 | 204 | 40 | 0.7524 | 0.9394 | 0.8356 |
| volume | 77 | 7 | 0 | 0.9167 | 1 | 0.9565 |
| year | 832 | 11 | 21 | 0.987 | 0.9754 | 0.9811 |

### Noisy Field Contract

| Field | Coverage | Exact F1 | Canonical F1 | Exact Precision (non-abstained) | Canonical Precision (non-abstained) | Expected Rows | Predicted Non-Empty Rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| title | 0.9896 | 0.8923 | 0.8923 | 0.814 | 0.814 | 864 | 855 |
| url | 0.9537 | 0.8356 | 0.8356 | 0.7524 | 0.7524 | 864 | 824 |
| year | 0.9757 | 0.9811 | 0.9811 | 0.987 | 0.987 | 864 | 843 |
| journal/venue | 0.9119 | 0.8611 | 0.8611 | 0.8291 | 0.8291 | 738 | 673 |
| doi | 0.6634 | 0.7976 | 0.7976 | 1 | 1 | 612 | 406 |
| authors | 0.9911 | 0.7563 | 0.7563 | 0.6136 | 0.6136 | 564 | 559 |
| firstAuthor | 0.9911 | 0.8502 | 0.8502 | 0.746 | 0.746 | 564 | 559 |
| publisher | 0.8208 | 0.7955 | 0.8 | 0.8046 | 0.8123 | 318 | 261 |
| isbn | 0.6486 | 0.2451 | 0.2451 | 0.2153 | 0.2153 | 222 | 144 |
| pages | 0.991 | 0 | 0.9909 | 0 | 0.9909 | 222 | 220 |
| institution | 0.6867 | 0.69 | 0.7342 | 0.767 | 0.8447 | 150 | 103 |
| bookTitle | 0.873 | 0.8387 | 0.8387 | 0.8273 | 0.8273 | 126 | 110 |
| patent | 1 | 1 | 1 | 1 | 1 | 126 | 126 |
| siteName | 0.6587 | 0.7767 | 0.7767 | 0.9639 | 0.9639 | 126 | 83 |
| conferenceTitle | 0.8229 | 0.7613 | 0.7613 | 0.7468 | 0.7468 | 96 | 79 |
| issn | 0.8667 | 0.9286 | 0.9286 | 1 | 1 | 90 | 78 |
| issue | 0.9667 | 0.9714 | 0.9714 | 0.977 | 0.977 | 90 | 87 |
| volume | 1 | 0.9565 | 0.9565 | 0.9167 | 0.9167 | 84 | 84 |
| repository | 0.7222 | 0.8387 | 0.8387 | 1 | 1 | 72 | 52 |
| thesisType | 0.9167 | 0.9254 | 0.9254 | 0.9394 | 0.9394 | 72 | 66 |

### Noisy Citation Field Exactness

| Group | Exact Match Rate | Correct | Compared | Raw False-Positive Repair Rate | Raw False-Positive Repaired | Raw False-Positive Compared |
| --- | --- | --- | --- | --- | --- | --- |
| author | 0.6082 | 343 | 564 | 0 | 0 | 289 |
| title | 0.8056 | 696 | 864 | 0 | 0 | 0 |
| year | 0.963 | 832 | 864 | 0 | 0 | 0 |
| source | 0.8306 | 613 | 738 | 1 | 123 | 123 |
| link | 0.7176 | 620 | 864 | 0 | 0 | 0 |

### Noisy Input Profiles

| Input Profile | Compared | Soft Instance F1 | High-Confidence Rate | Partial Parse Rate | Needs-Action Rate | Abstain Rate | Required Completeness | False-Fill Rate | Accepted-Without-Edit Rate | Normalized Exact-Match Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| doi_list | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_clean | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| structured_noisy | 864 | 0.6921 | 0.588 | 0.2315 | 0.1806 | 0.0967 | 0.9524 | 0.0759 | 0.4537 | 0.0046 |
| pasted_pdf_copy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| multiline_numbered | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ocr_like | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Noisy Move-Level Repairs

| Phase | Reason | Total Repairs | Successful Repairs | Precision |
| --- | --- | --- | --- | --- |
| normalization | normalization_field_mutation | 79 | 58 | 0.7342 |
| shared_repair | shared_repair_field_mutation | 22 | 0 | 0 |

## Cells Below Threshold

| Style | Type | Soft Instance F1 | Compared |
| --- | --- | --- | --- |

## Contract Sanity Failures

- None
