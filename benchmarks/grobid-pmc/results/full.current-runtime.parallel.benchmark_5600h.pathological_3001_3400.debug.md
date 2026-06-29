# Grobid-Style Benchmark Debug

- Mode: full
- Profile: current-runtime
- Parse Profile: core_parse_fast
- Source Type: text
- Hardware Profile: benchmark_5600h
- Benchmark Variant: parallel
- Semantic Output Hash: sha256:a0d71f23b08c661aa8cdaf21de281b9e6040689ad779d5770efb1c4e95b7025a
- Slice Rows: 3001-3400 (400 rows)

## Metric Legend

- `tp` (true positives): expected field matches that the engine got right.
- `fp` (false positives): field values the engine predicted but that did not match the expected field.
- `fn` (false negatives): expected field values the engine missed or failed to match.
- `precision`: of the values predicted for a field, how many were correct.
- `recall`: of the values expected for a field, how many were recovered.
- `f1`: harmonic mean of precision and recall; use this as the main per-field score.

## Contract Coverage

| Field | Expected Rows | Predicted Non-Empty Rows | Coverage | Hard Failure | Warning |
| --- | --- | --- | --- | --- | --- |
| authors | 400 | 399 | 0.9975 | false | false |
| doi | 400 | 384 | 0.96 | false | false |
| firstAuthor | 400 | 399 | 0.9975 | false | false |
| journal/venue | 400 | 396 | 0.99 | false | false |
| title | 400 | 397 | 0.9925 | false | false |
| url | 400 | 396 | 0.99 | false | false |
| year | 400 | 395 | 0.9875 | false | false |
| repository | 340 | 333 | 0.9794 | false | false |
| bookTitle | 60 | 60 | 1 | false | false |
| isbn | 60 | 56 | 0.9333 | false | true |
| pages | 60 | 60 | 1 | false | false |
| publisher | 60 | 60 | 1 | false | false |

## Contract Samples

| Variant | Required Fields | Expected Keys | Predicted Keys | Missing Required |
| --- | --- | --- | --- | --- |
| preprint-144383a403d1db07:apa7:noisy | title, repository, journal/venue | authors, doi, firstAuthor, journal/venue, repository, title, url, year | authors, firstAuthor, journal/venue, publisher, title, url | repository |
| preprint-144383a403d1db07:ieee:noisy | title, year, repository, journal/venue | authors, doi, firstAuthor, journal/venue, repository, title, url, year | authors, firstAuthor, journal/venue, publisher, title, year | repository |
| preprint-30f0411ad1c5c805:ieee:noisy | title, year, repository, journal/venue | authors, doi, firstAuthor, journal/venue, repository, title, url, year | journal/venue, publisher, title, year | repository |
| preprint-30f0411ad1c5c805:mla9:noisy | authors, title, year, repository, journal/venue | authors, doi, firstAuthor, journal/venue, repository, title, url, year | authors, firstAuthor, title, url, year | repository, journal/venue |
| preprint-38020f44ab0ab870:apa7:noisy | title, repository, journal/venue | authors, doi, firstAuthor, journal/venue, repository, title, url, year | authors, firstAuthor, journal/venue, repository, url | title |
| preprint-38020f44ab0ab870:vancouver:noisy | title, year | authors, doi, firstAuthor, journal/venue, repository, title, url, year | authors, firstAuthor, url, year | title |
| preprint-41f44a875a1ce010:apa7:noisy | title, repository, journal/venue | authors, doi, firstAuthor, journal/venue, repository, title, url, year | authors, firstAuthor, url | title, repository, journal/venue |
| preprint-41f44a875a1ce010:harvard-ctr:noisy | title, repository, journal/venue | authors, doi, firstAuthor, journal/venue, repository, title, url, year | authors, firstAuthor, title, url | repository, journal/venue |

## Clean Structure Breakdown

| Structure | Compared | Soft Instance F1 | Macro Soft F1 |
| --- | --- | --- | --- |
| structured | 362 | 0.884 | 0.9847 |
| unstructured | 0 | 0 | 0 |

## Priority Fields

| Field | Soft F1 (balanced score) | Missing Expected | Unsupported Predicted | TP (matched expected) | FP (wrong predicted) | FN (missed expected) |
| --- | --- | --- | --- | --- | --- | --- |
| institution | 0 | 0 | 78 | 0 | 0 | 0 |
| conferenceTitle | 0 | 0 | 0 | 0 | 0 | 0 |
| issn | 0 | 0 | 0 | 0 | 0 | 0 |
| patent | 0 | 0 | 0 | 0 | 0 | 0 |
| siteName | 0 | 0 | 0 | 0 | 0 | 0 |
| authors | 0.9274 | 0 | 0 | 313 | 49 | 0 |
| isbn | 0.9333 | 0 | 0 | 42 | 6 | 0 |
| title | 0.9972 | 0 | 0 | 360 | 2 | 0 |
| publisher | 1 | 0 | 314 | 48 | 0 | 0 |
| year | 1 | 0 | 0 | 362 | 0 | 0 |
| journal/venue | 1 | 0 | 0 | 362 | 0 | 0 |
| bookTitle | 1 | 0 | 0 | 48 | 0 | 0 |
| doi | 1 | 0 | 0 | 362 | 0 | 0 |
| url | 1 | 0 | 0 | 362 | 0 | 0 |
| repository | 1 | 0 | 0 | 314 | 0 | 0 |

## Accuracy

- Type Accuracy: 1 (362/362)
- Style Accuracy: 0.9779 (354/362)
- Style Family Accuracy: 1 (362/362)

## Adversarial Pair Accuracy

| Pair | Styles | Accuracy | Correct | Compared |
| --- | --- | --- | --- | --- |
| apa7_vs_harvard-ctr | apa7 vs harvard-ctr | 1 | 122 | 122 |
| mla9_vs_chicago-notes-bib | mla9 vs chicago-notes-bib | 0.9333 | 112 | 120 |
| vancouver_vs_ieee | vancouver vs ieee | 1 | 120 | 120 |

## Priority Cells

| Style | Type | Compared | Soft Instance F1 |
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

## Top Style Mismatches

| Expected | Detected | Count |
| --- | --- | --- |
| chicago-notes-bib | mla9 | 8 |

## Style Failure Examples

### chicago-notes-bib -> mla9

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| preprint-013a98d4a636ccea:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Awang, Noor Azura, Nik Noor Haryatul Eleena Bt N. Mahmud, and Noor Ummi Hazirah Hani Zulkefli. “Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber.” Preprint, Elsevier BV, 2023. https://doi.org/10.2139/ssrn.4577205. |
| preprint-0438341024d575b7:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Hassan, A., A. A. M. Arafa, S. Z. Rida, M. A. Dagher, and Hamed M. El Sherbiny. “An Effective Technique for Solving Generalized Cahn-Hilliard (C-H) Problems.” Preprint, Research Square Platform LLC, 2023. https://doi.org/10.21203/rs.3.rs-2870128/v1. |
| preprint-0658a1475e8a5845:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Brizuela-Torres, Diego, Yves Zinngrebe, Mark D. A. Rounsevell, and Calum Brown. “Thirty Years of Drivers and Patterns of Land Use Change Across the Amazon Biome.” Preprint, Elsevier BV, 2023. https://doi.org/10.2139/ssrn.4591009. |
| preprint-19ff91e02f546e21:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Shen, Yusheng, and Kassandra M. Ori-McKenney. “Microtubule-Associated Proteins Orchestrate the Tubulin Code for Cellular Adaptation.” Preprint, Elsevier BV, 2023. https://doi.org/10.2139/ssrn.4502784. |


## Top Type Mismatches

| Expected | Detected | Count |
| --- | --- | --- |

## Stripped Fields By Detected Type

| Detected Type | Field | Count |
| --- | --- | --- |
| preprint | publisher | 314 |
| preprint | institution | 72 |
| preprint | journal | 60 |
| book-chapter | institution | 6 |

## Field Failure Examples

### authors

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| book-chapter-9ebd7c2b56ff9b44:apa7:clean | Madhav, M. S.; Laha, G. S.; Padmakumari, A. P.; Somasekhar, N.; Mangrauthia, S. K.; Viraktamath, B. C. | Madhav, M S | Madhav, M S | book-chapter | apa7 | author_initials_only |
| book-chapter-9ebd7c2b56ff9b44:chicago-notes-bib:clean | Madhav, M. S.; Laha, G. S.; Padmakumari, A. P.; Somasekhar, N.; Mangrauthia, S. K.; Viraktamath, B. C. | Madhav, M S | Madhav, M S | book-chapter | chicago-notes-bib | author_initials_only |
| book-chapter-9ebd7c2b56ff9b44:harvard-ctr:clean | Madhav, M. S.; Laha, G. S.; Padmakumari, A. P.; Somasekhar, N.; Mangrauthia, S. K.; Viraktamath, B. C. | Madhav, M S | Madhav, M S | book-chapter | harvard-ctr | author_initials_only |
| book-chapter-9ebd7c2b56ff9b44:ieee:clean | Madhav, M. S.; Laha, G. S.; Padmakumari, A. P.; Somasekhar, N.; Mangrauthia, S. K.; Viraktamath, B. C. | Madhav, M. S. | Madhav, M. S. | book-chapter | ieee | author_initials_only |
| book-chapter-9ebd7c2b56ff9b44:mla9:clean | Madhav, M. S.; Laha, G. S.; Padmakumari, A. P.; Somasekhar, N.; Mangrauthia, S. K.; Viraktamath, B. C. | Madhav, M S | Madhav, M S | book-chapter | mla9 | author_initials_only |

### title

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| preprint-17060760b24c9498:apa7:clean | Effect of Recrystallization Annealing on Microstructure and Properties of Cold-Deformed Cocrcu1.2feni High Entropy Alloy | Effect of Recrystallization Annealing on Microstructure and Properties of Cold-Deformed Cocrcu1 | Effect of Recrystallization Annealing on Microstructure and Properties of Cold-Deformed Cocrcu1 | preprint | apa7 | truncated_value |
| preprint-2377bdd72f32afbd:vancouver:clean | Luminescent 3d-Europium-Based Metal-Organic Framework: A Brilliant Sentinel for Quercetin Detection. Unveiling the Path to Portable, Selective, and Sensitive Sensing | Luminescent 3d-Europium-Based Metal-Organic Framework: A Brilliant Sentinel for Quercetin Detection | Luminescent 3d-Europium-Based Metal-Organic Framework: A Brilliant Sentinel for Quercetin Detection | preprint | vancouver | truncated_value |

### isbn

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| book-chapter-9bea9fa78e88b5de:apa7:clean | 9780792384250 | 9781402006135 | 9781402006135 | book-chapter | apa7 | catastrophic_wrong_content |
| book-chapter-9bea9fa78e88b5de:chicago-notes-bib:clean | 9780792384250 | 9781402006135 | 9781402006135 | book-chapter | chicago-notes-bib | catastrophic_wrong_content |
| book-chapter-9bea9fa78e88b5de:harvard-ctr:clean | 9780792384250 | 9781402006135 | 9781402006135 | book-chapter | harvard-ctr | catastrophic_wrong_content |
| book-chapter-9bea9fa78e88b5de:ieee:clean | 9780792384250 | 9781402006135 | 9781402006135 | book-chapter | ieee | catastrophic_wrong_content |
| book-chapter-9bea9fa78e88b5de:mla9:clean | 9780792384250 | 9781402006135 | 9781402006135 | book-chapter | mla9 | catastrophic_wrong_content |

## Sample Failures

| Variant | Structure | Source Kind | Style | Type | Detected Style | Detected Type | Missing Fields | Stripped Fields |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| book-chapter-9ebd7c2b56ff9b44:apa7:clean | structured | csl_rendered | apa7 | book-chapter | apa7 | book-chapter | authors |  |
| book-chapter-9ebd7c2b56ff9b44:chicago-notes-bib:clean | structured | csl_rendered | chicago-notes-bib | book-chapter | chicago-notes-bib | book-chapter | authors |  |
| book-chapter-9ebd7c2b56ff9b44:harvard-ctr:clean | structured | csl_rendered | harvard-ctr | book-chapter | harvard-ctr | book-chapter | authors |  |
| book-chapter-9ebd7c2b56ff9b44:mla9:clean | structured | csl_rendered | mla9 | book-chapter | mla9 | book-chapter | authors |  |
| book-chapter-9ebd7c2b56ff9b44:vancouver:clean | structured | csl_rendered | vancouver | book-chapter | vancouver | book-chapter | authors |  |
| preprint-0c09765f95636878:apa7:clean | structured | csl_rendered | apa7 | preprint | apa7 | preprint | authors | publisher |
| preprint-0c09765f95636878:chicago-notes-bib:clean | structured | csl_rendered | chicago-notes-bib | preprint | chicago-notes-bib | preprint | authors | publisher |
| preprint-0c09765f95636878:mla9:clean | structured | csl_rendered | mla9 | preprint | mla9 | preprint | authors | publisher |
| preprint-0c09765f95636878:vancouver:clean | structured | csl_rendered | vancouver | preprint | vancouver | preprint | authors | publisher |
| preprint-126a55568a763ac1:apa7:clean | structured | csl_rendered | apa7 | preprint | apa7 | preprint | authors | publisher |
| preprint-126a55568a763ac1:chicago-notes-bib:clean | structured | csl_rendered | chicago-notes-bib | preprint | chicago-notes-bib | preprint | authors | publisher |
| preprint-126a55568a763ac1:harvard-ctr:clean | structured | csl_rendered | harvard-ctr | preprint | harvard-ctr | preprint | authors | publisher |
| preprint-126a55568a763ac1:mla9:clean | structured | csl_rendered | mla9 | preprint | mla9 | preprint | authors | publisher |
| preprint-126a55568a763ac1:vancouver:clean | structured | csl_rendered | vancouver | preprint | vancouver | preprint | authors | publisher |
| preprint-17060760b24c9498:apa7:clean | structured | csl_rendered | apa7 | preprint | apa7 | preprint | title | institution, journal, publisher |
| preprint-209810d7dd36aca1:chicago-notes-bib:clean | structured | csl_rendered | chicago-notes-bib | preprint | chicago-notes-bib | preprint | authors | publisher |
| preprint-209810d7dd36aca1:mla9:clean | structured | csl_rendered | mla9 | preprint | mla9 | preprint | authors | publisher |
| preprint-219022281916469e:apa7:clean | structured | csl_rendered | apa7 | preprint | apa7 | preprint | authors | publisher |
| preprint-219022281916469e:chicago-notes-bib:clean | structured | csl_rendered | chicago-notes-bib | preprint | chicago-notes-bib | preprint | authors | publisher |
| preprint-219022281916469e:mla9:clean | structured | csl_rendered | mla9 | preprint | mla9 | preprint | authors | publisher |
