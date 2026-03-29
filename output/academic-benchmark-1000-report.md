# Academic Benchmark Report

Generated: 2026-03-29T14:21:09.168Z
Frozen corpus: 2026-03-27T12:11:27.113Z
Corpus size: 1000 real citations
IEEE slice: 159 citations per corpus run
Machine-readable report: D:\Coding\Citing\output\academic-benchmark-1000-report.json

## Executive summary

This internal benchmark evaluates 1000 real-world academic references across journals, conferences, books, chapters, reports, and theses. It runs the current v2 engine in 50, 100, and 200 citation batches to mirror institutional use while separating strict external readiness from a legacy internal-compatibility score.

## External Readiness Score (Primary)

- Strict essential accuracy: 83.20%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 100.00%
- Average APA render similarity: 90.05%
- Direct LLM call rate: 0.00%

## LLM Fallback Diagnostics

- Enrichment opt-in: disabled
- LLM extract opt-in: disabled
- LLM actually used in this run: no
- Direct model calls recorded: 0
- Direct model accepts: 0
- Cluster-reused LLM accepts: 0
- Total citations that accepted LLM-derived fields: 0
- Rejected fallback attempts: 0
- Budget-skipped fallback attempts: 0
- Accepted fallbacks with improved fields: 0
- Accepted fallbacks with non-empty output: 0
- Accepted fallbacks that increased strict pass coverage: 0
- Total strict-pass delta from accepted fallbacks: 0
- Improved fields: none recorded in this run
- Rejected reasons: none recorded in this run
- Accepted reasons: none recorded in this run

## Internal Compatibility Reference (Secondary)

- Legacy-comparable field average: 94.90%
- Methodology version: 1.0
- Frozen at: 2026-03-27

Footnote: The primary score uses strict citation-level pass/fail on core fields plus identity and output integrity. The secondary score is a frozen internal field-average reference for historical comparison only and must not be cited as the external readiness number.

## Action Needed Reasons

- Overall multi_field_low_confidence: 675
- Overall weak_venue: 96
- Overall weak_first_author: 63
- Overall weak_reference_type: 54
- Overall malformed_authors: 27
- Overall empty_output: 12
- Overall missing_authors: 12
- Overall identity_contamination: 0

- IEEE multi_field_low_confidence: 93
- IEEE weak_first_author: 21
- IEEE weak_venue: 15
- IEEE weak_reference_type: 9
- IEEE empty_output: 6
- IEEE malformed_authors: 6
- IEEE missing_authors: 6
- IEEE identity_contamination: 0

- Near-pass multi_field_low_confidence: 642
- Near-pass weak_venue: 75
- Near-pass weak_first_author: 45
- Near-pass weak_reference_type: 42
- Near-pass malformed_authors: 24
- Near-pass empty_output: 0
- Near-pass identity_contamination: 0
- Near-pass missing_authors: 0

## Dominant Failure Ledger

- residual_other: 58 (34.52%)
- venue_cleanup: 39 (23.21%)
- conference_container_type: 24 (14.29%)
- ieee_author_order: 20 (11.90%)
- pages_locator: 11 (6.55%)
- report_institution_type: 7 (4.17%)
- apa_author_order: 5 (2.98%)
- missing_output: 4 (2.38%)
- identity_contamination: 0 (0.00%)

## Near-Pass Ledger

- firstAuthor: 48 (28.57%)
- referenceType: 39 (23.21%)
- venue: 18 (10.71%)
- title: 8 (4.76%)
- year: 2 (1.19%)
- identity: 0 (0.00%)
- output: 0 (0.00%)

## Weighted Lift Model

- Current strict external accuracy: 83.20%
- Target strict external accuracy: 90.00%
- Remaining gap: 6.80%
- Source journal: share 55.00%, strict 86.18%, weighted headroom 7.60%
- Source conference: share 15.00%, strict 73.33%, weighted headroom 4.00%
- Source book: share 10.00%, strict 78.00%, weighted headroom 2.20%
- Source chapter: share 10.00%, strict 83.00%, weighted headroom 1.70%
- Source report: share 5.00%, strict 80.00%, weighted headroom 1.00%
- Source thesis: share 5.00%, strict 94.00%, weighted headroom 0.30%

## Methodology

- The corpus contains 1,000 real citations drawn from Crossref and frozen locally on the generation date shown above.
- The primary score uses the deterministic v2 pipeline with enrichment, LLM extraction, and GROBID disabled for repeatability.
- Strict external readiness requires referenceType, year, title, firstAuthor, venue, non-empty output, and identity integrity to all pass.
- The legacy-comparable score is a frozen field-average reference for internal comparison only.

## Batch results

### Batch size 50

- Strict essential accuracy: 83.20%
- Legacy field average: 94.90%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 100.00%
- Mean batch time: 1851.71 ms
- Median batch time: 1592.28 ms
- P95 batch time: 3023.57 ms
- Mean ms per citation: 37.03 ms
- Throughput: 9.00 citations/sec

### Batch size 100

- Strict essential accuracy: 83.20%
- Legacy field average: 94.90%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 100.00%
- Mean batch time: 3556.57 ms
- Median batch time: 3637.16 ms
- P95 batch time: 4595.71 ms
- Mean ms per citation: 35.57 ms
- Throughput: 9.37 citations/sec

### Batch size 200

- Strict essential accuracy: 83.20%
- Legacy field average: 94.90%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 100.00%
- Mean batch time: 7233.03 ms
- Median batch time: 7214.60 ms
- P95 batch time: 7625.18 ms
- Mean ms per citation: 36.17 ms
- Throughput: 9.22 citations/sec

## IEEE failure breakdown

- author_order: 54
- venue_abbreviation: 15
- locator_misclassified: 3
- doi_parse: 0
- reference_type: 36
- identity_contamination: 0
- empty_output: 6

## Selector diagnostics

- selection mode full_scoring: 966
- selection mode single_survivor: 1041
- selection mode unanimous_diversity_guard: 981
- top winner adapter heuristic:ieee_quoted_reference: 615
- top winner adapter heuristic:in_source_container: 363
- top winner adapter heuristic:quoted_title_journal_locator: 225
- top winner adapter heuristic:harvard_sentence_journal: 222
- top winner adapter heuristic:vancouver_compact_journal: 204

## Type confusion matrix

- journal -> journal: 1572
- conference -> conference: 414
- chapter -> chapter: 273
- book -> book: 258
- thesis -> thesis: 150
- report -> report: 147
- journal -> conference: 48
- book -> report: 24
- conference -> chapter: 24
- journal -> book: 18

## Strengths

- The benchmark uses a frozen 1,000-reference real-world corpus, making reruns auditable and institution-friendly.
- Strict external readiness, internal legacy compatibility, and batch performance are separated instead of being collapsed into one misleading score.
- thesis records performed best on the strict score at 94.00%.
- The fastest operating point was the 100-citation batch at 9.37 citations/sec.

## Weaknesses

- conference is the weakest strict source type and should stay in the next remediation wave.
- IEEE is the lowest-performing input style on the strict score.
- pages is the lowest-accuracy field and remains the clearest parser-recovery target.
- Identity contamination currently accounts for 0 strict failures across the benchmarked runs.

## Pros

- Uses real citations rather than synthetic placeholders.
- Separates strict external readiness from legacy internal comparability.
- Measures count integrity, non-empty output, identity integrity, consistency, and speed as distinct operational properties.
- Evaluates 50, 100, and 200 citation batch sizes to mirror institution-friendly throughput constraints.

## Cons

- LLM extraction and GROBID can be toggled for the primary benchmark, so benchmark claims must always be read alongside the reported run flags.
- The legacy-comparable score is higher by design and must not be used as a readiness claim.
- The benchmark is still internal; an external validation round would increase procurement credibility.
- This release is scoped to academic references and does not cover websites, patents, statutes, or datasets.

## Suggested external pilot

- Use the strict external readiness score as the procurement-facing metric and treat the legacy score as internal historical context only.
- Default acceptance testing to the 100-citation batch, then verify operational headroom with 50-citation and 200-citation runs.
- Record count integrity, non-empty output rate, identity integrity, and strict essential accuracy together so the evaluation cannot be gamed by a softer metric.
- Have a librarian, writing center lead, or research support team manually inspect a stratified sample from the weakest source types and IEEE-style inputs.

## Sample failures

- journal-0033-10-1002-chin-200104012 [batch 50, repeat 1] mismatches: referenceType, year, title, firstAuthor, venue, volume, issue, pages, doi, output; render similarity: 0.00%; winner: missing; mode: missing
  Expected: Brooker, M. H., Berg, R. W., von Barner, J. H., & Bjerrum, N. J. (2001). ChemInform Abstract: Matrix‐Isolated Al 2 OF 6 2‐ Ion in Molten and Solid LiF/NaF/KF. ChemInform, 32(4), chin.200104012. https://doi.org/10.1002/chin.200104012
  Actual: 
- book-0029-10-4028-b-fkeh8l [batch 50, repeat 1] mismatches: referenceType, title, firstAuthor, venue; render similarity: 62.00%; winner: parser:selected_style:apa; mode: single_survivor
  Expected: Nandyala, S. H. (2017). Journal of Biomimetics, Biomaterials and Biomedical Engineering Vol. 34. In Journal of Biomimetics, Biomaterials and Biomedical Engineering. Trans Tech Publications Ltd. https://doi.org/10.4028/b-fkeh8l
  Actual: ussain Nandyala, J., ournal of Biomimetics, B., & Ltd, B. E. V. 3. T. T. P. (2017). doi. Sooraj Hussain Nandyala, Journal of Biomimetics, Biomaterials and Biomedical Engineering, 34, 2017.
- journal-0296-10-33917-mic-4-93-2020-47-56 [batch 50, repeat 1] mismatches: title, firstAuthor; render similarity: 64.00%; winner: heuristic:ieee_quoted_reference; mode: single_survivor
  Expected: Российская академия народного хозяйства и государственной службы при Президенте Российской Федерации, Ахрамеев, М. Д., Стефановский, Д. В., Российская академия народного хозяйства и государственной службы при Президенте Российской Федерации, Сенько, О. В., & Федеральный исследовательский центр “Информатика и управление” Российской Академии Наук. (2020). Прогнозирование банкротств контрагентов на основе данных платежной дисциплины. Microeconomics, 93(4), 47–56. https://doi.org/10.33917/mic-4.93.2020.47-56
  Actual: Федерации, Р. А. Н. Х. И. С. П. П. Р. Дмитриевич Ахрамеев, М. Владимирович Стефановский, Д. Федерации, Р. А. Н. Х. И. С. П. П. Р. Валентинович Сенько, О. & центр, Ф. И. (2020). Информатика иуправление" Российской Академии Наук, "Прогнозирование банкротств контрагентов на основе данных платежной дисциплины. Microeconomics, 93(4), 47-56.
- conference-0006-10-1109-icpe-2015-7168043 [batch 50, repeat 1] mismatches: year, title; render similarity: 74.00%; winner: legacy:year_anchored_fallback; mode: single_survivor
  Expected: Sampath, J. P. K., Alphones, A., & Vilathgamuwa, D. M. (2015). Optimization of double spiral metamaterial for wireless power transfer. 2015 9th International Conference on Power Electronics and ECCE Asia (ICPE-ECCE Asia), 1937–1943. https://doi.org/10.1109/icpe.2015.7168043
  Actual: Sampath, J. P. K., Alphones, A., Electronics, A. D. M. V. ". O. D. S. M. F. W. P. T. I. 2. 9. I. C. O. P., & Asia), E. A. (ICPE-E. (1937). 1943. Ieee, 2015. In 2015 9th International Conference on Power Electronics and ECCE Asia (ICPE-ECCE Asia) (pp. 1937-1943). IEEE. https://doi.org/10.1109/icpe.2015.7168043.
- journal-0150-10-1111-j-1467-8705-1974-tb01519-x [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 75.00%; winner: heuristic:quoted_title_journal_locator; mode: unanimous_diversity_guard
  Expected: EVERETT, B. (1974). A Visit to Burnt Norton. Critical Quarterly, 16(3), 199–224. https://doi.org/10.1111/j.1467-8705.1974.tb01519.x
  Actual: BARBARA EVERETT. (1974). A Visit to Burnt Norton. Critical Quarterly, 16(3), 199-224.
- book-0055-10-22533-at-ed-409201303 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 79.00%; winner: heuristic:author_year_publisher_tail; mode: full_scoring
  Expected: Mônica Jasper. (2020). Aspectos Fitossanitários da Agricultura. Atena Editora. https://doi.org/10.22533/at.ed.409201303
  Actual: Jasper, M. (2020). Aspectos Fitossanitários da Agricultura. Atena Editora.
- report-0030-10-4271-630502 [batch 50, repeat 1] mismatches: pages; render similarity: 83.00%; winner: heuristic:vancouver_publisher_year_source; mode: full_scoring
  Expected: Eaton, W. F. (1963). An operator’s experience (p. 630502). SAE International. https://doi.org/10.4271/630502
  Actual: Eaton, W. F. (1963). An operator's experience. SAE International.
- chapter-0144-10-1007-978-981-10-6898-0-21 [batch 50, repeat 1] mismatches: referenceType; render similarity: 87.00%; winner: parser:selected_style:vancouver; mode: unanimous_diversity_guard
  Expected: Prakash, R. K. R., Amritha, P. P., & Sethumadhavan, M. (2017). Opaque Predicate Detection by Static Analysis of Binary Executables. In Communications in Computer and Information Science (pp. 250–258). Springer Singapore. https://doi.org/10.1007/978-981-10-6898-0_21
  Actual: Prakash, R. K. R., Amritha, P. P., & Sethumadhavan, M. (2017). Opaque Predicate Detection by Static Analysis of Binary Executables. In: Communications in Computer and Information Science, 250-258.
- journal-0383-10-5005-jp-journals-10006-2222 [batch 50, repeat 1] mismatches: referenceType, volume, issue, doi; render similarity: 88.00%; winner: heuristic:quoted_book_chapter; mode: single_survivor
  Expected: Megadhana, I. W., Winata, I. G. S., Widiyanti, E. S., & Lawu, A. A. (2023). Role of Oxygenation Factor Hypoxia-inducible Factor-1α (HIF-1α) as Prognostic Indicators in Cervical Cancer. Journal of South Asian Federation of Obstetrics and Gynaecology, 15(4), 490–496. https://doi.org/10.5005/jp-journals-10006-2222
  Actual: Megadhana, I. W., I Gde Sastra Winata, E. S. W., & Lawu, A. A. (2023). Role of Oxygenation Factor Hypoxia-inducible Factor-1α (HIF-1α) as Prognostic Indicators in Cervical Cancer. In Journal of South Asian Federation of Obstetrics and Gynaecology, vol. 15 (pp. 490-496). 10.
- thesis-0040-10-14264-190019 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 88.00%; winner: heuristic:sentence_thesis; mode: full_scoring
  Expected: Peter Kyne. (2023). Chondrichthyans and the Queensland East Coast Trawl Fishery: Bycatch reduction, biology, conservation status and sustainability [Doctoral dissertation, University of Queensland Library]. https://doi.org/10.14264/190019
  Actual: Kyne, P. (2023). Chondrichthyans and the Queensland East Coast Trawl Fishery: Bycatch reduction, biology, conservation status and sustainability. University of Queensland Library.
- journal-0433-10-1002-chin-197210264 [batch 50, repeat 1] mismatches: referenceType, venue, volume, issue, pages; render similarity: 88.00%; winner: heuristic:author_year_publisher_tail; mode: single_survivor
  Expected: GUNDERMANN, K., BURZIN, K., SPRENGER, F., & SCHULZE, H. (1972). ChemInform Abstract: BERBESSERTE SYNTH. VON 2‐CYAN‐AZIRIDINEN UND UNTERSUCHUNGEN ZU IHRER ISOMERISIERUNG. Chemischer Informationsdienst, 3(10), chin.197210264. https://doi.org/10.1002/chin.197210264
  Actual: GUNDERMANN, KARL‐DIETRICH, BURZIN, FRANZ‐JOSEF, & SCHULZE. (1972). Cheminform Abstract: BERBESSERTE Synth. VON 2‐cyan‐aziridinen UND UNTERSUCHUNGEN ZU IHRER ISOMERISIERUNG. Chemischer Informationsdienst, 3(10), chin.197210264.
- journal-0025-10-1134-s0036023619070088 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 89.00%; winner: heuristic:apa_journal; mode: single_survivor
  Expected: Folomeikin, Yu. I., Karachevtsev, F. N., & Stolyarova, V. L. (2019). Production of Ceramics Based on the Y2O3–ZrO2–HfO2 System for Casting Molds. Russian Journal of Inorganic Chemistry, 64(7), 934–940. https://doi.org/10.1134/s0036023619070088
  Actual: Karachevtsev, F. N., & Stolyarova, V. L. (2019). Production of Ceramics Based on the Y2O3-ZrO2-HfO2 System for Casting Molds. Russian Journal of Inorganic Chemistry, 64(7), 934-940.
- journal-0394-10-14222-turkiyat4249 [batch 50, repeat 1] mismatches: issue; render similarity: 90.00%; winner: heuristic:harvard_sentence_journal; mode: full_scoring
  Expected: COŞKUN, D. (2020). Şîa’nın Siyasallaşma Sürecinde Seyyid Kıvâmeddin Marâşî. Journal of Turkish Research Institute, 67, 481–491. https://doi.org/10.14222/turkiyat4249
  Actual: C. O.ŞK. U. N., D. (2020). Şîa'nın Siyasallaşma Sürecinde Seyyid Kıvâmeddin Marâşî. Journal of Turkish Research Institute, 67, 481-491.
- journal-0407-10-1371-journal-pone-0269394 [batch 50, repeat 1] mismatches: pages; render similarity: 90.00%; winner: heuristic:ieee_quoted_reference; mode: single_survivor
  Expected: R., R., Uthaiah, C. A., C. M., R., Madhunapantula, S. V., Salimath, P. V., K., P., M., S. K., & M. R., K. (2022). Comparative assessment of cognitive impairment and oxidative stress markers among vitamin D insufficient elderly patients with and without type 2 diabetes mellitus (T2DM). PLOS ONE, 17(6), e0269394. https://doi.org/10.1371/journal.pone.0269394
  Actual: R, R., Rajalakshmi, Uthaiah, C. A., M, R. C., Madhunapantula, S. V., Salimath, P. V., K, P., M, S. K., & R, K. M. (2022). Comparative assessment of cognitive impairment and oxidative stress markers among vitamin D insufficient elderly patients with and without type 2 diabetes mellitus (T2DM). PLOS ONE, 17(6), 10.
- journal-0178-10-1038-npre-2010-5416 [batch 50, repeat 1] mismatches: referenceType; render similarity: 90.00%; winner: heuristic:author_year_publisher_tail; mode: full_scoring
  Expected: Patil, P., Patil, P., & Watve, M. (2010). Hyperinsulinemia and insulin resistance : What comes first ? Nature Precedings. https://doi.org/10.1038/npre.2010.5416
  Actual: Patil, P., Patil, P., & Watve, M. (2010). Hyperinsulinemia and insulin resistance: What comes first ? Nature Precedings.

