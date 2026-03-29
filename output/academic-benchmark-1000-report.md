# Academic Benchmark Report

Generated: 2026-03-29T13:17:14.041Z
Frozen corpus: 2026-03-27T12:11:27.113Z
Corpus size: 1000 real citations
IEEE slice: 159 citations per corpus run
Machine-readable report: D:\Coding\Citing\output\academic-benchmark-1000-report.json

## Executive summary

This internal benchmark evaluates 1000 real-world academic references across journals, conferences, books, chapters, reports, and theses. It runs the current v2 engine in 50, 100, and 200 citation batches to mirror institutional use while separating strict external readiness from a legacy internal-compatibility score.

## External Readiness Score (Primary)

- Strict essential accuracy: 81.80%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 100.00%
- Average APA render similarity: 90.02%
- LLM fallback attempt rate: 0.00%

## LLM Fallback Diagnostics

- Enrichment opt-in: disabled
- LLM extract opt-in: disabled
- Fallback attempts recorded in this primary report: 0
- Rejected reasons: none recorded in this run

## Internal Compatibility Reference (Secondary)

- Legacy-comparable field average: 94.77%
- Methodology version: 1.0
- Frozen at: 2026-03-27

Footnote: The primary score uses strict citation-level pass/fail on core fields plus identity and output integrity. The secondary score is a frozen internal field-average reference for historical comparison only and must not be cited as the external readiness number.

## Action Needed Reasons

- Overall multi_field_low_confidence: 111
- Overall weak_venue: 21
- Overall empty_output: 12
- Overall missing_authors: 12
- Overall weak_reference_type: 12
- Overall weak_first_author: 6
- Overall malformed_authors: 3
- Overall identity_contamination: 0

- IEEE multi_field_low_confidence: 42
- IEEE empty_output: 6
- IEEE missing_authors: 6
- IEEE weak_venue: 6
- IEEE weak_first_author: 3
- IEEE weak_reference_type: 3
- IEEE identity_contamination: 0
- IEEE malformed_authors: 0

- Near-pass multi_field_low_confidence: 99
- Near-pass weak_venue: 21
- Near-pass weak_reference_type: 12
- Near-pass weak_first_author: 6
- Near-pass malformed_authors: 3
- Near-pass empty_output: 0
- Near-pass identity_contamination: 0
- Near-pass missing_authors: 0

## Dominant Failure Ledger

- residual_other: 64 (35.16%)
- venue_cleanup: 38 (20.88%)
- conference_container_type: 32 (17.58%)
- ieee_author_order: 20 (10.99%)
- pages_locator: 11 (6.04%)
- report_institution_type: 7 (3.85%)
- apa_author_order: 6 (3.30%)
- missing_output: 4 (2.20%)
- identity_contamination: 0 (0.00%)

## Near-Pass Ledger

- referenceType: 48 (26.37%)
- firstAuthor: 45 (24.73%)
- venue: 24 (13.19%)
- title: 7 (3.85%)
- year: 2 (1.10%)
- identity: 0 (0.00%)
- output: 0 (0.00%)

## Weighted Lift Model

- Current strict external accuracy: 81.80%
- Target strict external accuracy: 90.00%
- Remaining gap: 8.20%
- Source journal: share 55.00%, strict 84.73%, weighted headroom 8.40%
- Source conference: share 15.00%, strict 68.67%, weighted headroom 4.70%
- Source book: share 10.00%, strict 79.00%, weighted headroom 2.10%
- Source chapter: share 10.00%, strict 84.00%, weighted headroom 1.60%
- Source report: share 5.00%, strict 80.00%, weighted headroom 1.00%
- Source thesis: share 5.00%, strict 92.00%, weighted headroom 0.40%

## Methodology

- The corpus contains 1,000 real citations drawn from Crossref and frozen locally on the generation date shown above.
- The primary score uses the deterministic v2 pipeline with enrichment, LLM extraction, and GROBID disabled for repeatability.
- Strict external readiness requires referenceType, year, title, firstAuthor, venue, non-empty output, and identity integrity to all pass.
- The legacy-comparable score is a frozen field-average reference for internal comparison only.

## Batch results

### Batch size 50

- Strict essential accuracy: 81.80%
- Legacy field average: 94.77%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 100.00%
- Mean batch time: 1519.65 ms
- Median batch time: 1501.44 ms
- P95 batch time: 1986.15 ms
- Mean ms per citation: 30.39 ms
- Throughput: 10.97 citations/sec

### Batch size 100

- Strict essential accuracy: 81.80%
- Legacy field average: 94.77%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 100.00%
- Mean batch time: 2983.23 ms
- Median batch time: 2862.31 ms
- P95 batch time: 3550.86 ms
- Mean ms per citation: 29.83 ms
- Throughput: 11.17 citations/sec

### Batch size 200

- Strict essential accuracy: 81.80%
- Legacy field average: 94.77%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 100.00%
- Mean batch time: 6421.98 ms
- Median batch time: 6492.67 ms
- P95 batch time: 7261.17 ms
- Mean ms per citation: 32.11 ms
- Throughput: 10.38 citations/sec

## IEEE failure breakdown

- author_order: 54
- venue_abbreviation: 21
- locator_misclassified: 0
- doi_parse: 0
- reference_type: 42
- identity_contamination: 0
- empty_output: 6

## Selector diagnostics

- selection mode full_scoring: 966
- selection mode single_survivor: 1041
- selection mode unanimous_diversity_guard: 981
- top winner adapter heuristic:ieee_quoted_reference: 615
- top winner adapter heuristic:in_source_container: 363
- top winner adapter heuristic:harvard_sentence_journal: 225
- top winner adapter heuristic:quoted_title_journal_locator: 225
- top winner adapter heuristic:vancouver_compact_journal: 204

## Type confusion matrix

- journal -> journal: 1539
- conference -> conference: 414
- chapter -> chapter: 273
- book -> book: 258
- thesis -> thesis: 150
- report -> report: 147
- journal -> conference: 48
- journal -> report: 33
- book -> report: 24
- conference -> chapter: 24

## Strengths

- The benchmark uses a frozen 1,000-reference real-world corpus, making reruns auditable and institution-friendly.
- Strict external readiness, internal legacy compatibility, and batch performance are separated instead of being collapsed into one misleading score.
- thesis records performed best on the strict score at 92.00%.
- The fastest operating point was the 100-citation batch at 11.17 citations/sec.

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
- journal-0240-10-1097-md-0000000000017835 [batch 50, repeat 1] mismatches: referenceType; render similarity: 63.00%; winner: heuristic:quoted_title_journal_locator; mode: single_survivor
  Expected: Park, H. O., Choi, J. Y., Jang, I. S., Kim, J. D., Kim, J. W., Byun, J. H., Kim, S. H., Yang, J. H., Moon, S. H., Kim, K. N., Kang, D. H., Jung, J. J., Choi, S. M., Kim, J. Y., & Lee, C. E. (2019). Perforation of inferior vena cava and duodenum by strut of inferior vena cava filter: A case report. Medicine, 98(47), e17835. https://doi.org/10.1097/md.0000000000017835
  Actual: Park, H. O. (2019). Perforation of inferior vena cava and duodenum by strut of inferior vena cava filter: A case report. In Medicine (No. e17835; Vol. 98, Issue 47).
- journal-0296-10-33917-mic-4-93-2020-47-56 [batch 50, repeat 1] mismatches: title, firstAuthor; render similarity: 64.00%; winner: heuristic:ieee_quoted_reference; mode: single_survivor
  Expected: Российская академия народного хозяйства и государственной службы при Президенте Российской Федерации, Ахрамеев, М. Д., Стефановский, Д. В., Российская академия народного хозяйства и государственной службы при Президенте Российской Федерации, Сенько, О. В., & Федеральный исследовательский центр “Информатика и управление” Российской Академии Наук. (2020). Прогнозирование банкротств контрагентов на основе данных платежной дисциплины. Microeconomics, 93(4), 47–56. https://doi.org/10.33917/mic-4.93.2020.47-56
  Actual: Федерации, Р. А. Н. Х. И. С. П. П. Р. Дмитриевич Ахрамеев, М. Владимирович Стефановский, Д. Федерации, Р. А. Н. Х. И. С. П. П. Р. Валентинович Сенько, О. & центр, Ф. И. (2020). Информатика иуправление" Российской Академии Наук, "Прогнозирование банкротств контрагентов на основе данных платежной дисциплины. Microeconomics, 93(4), 47-56.
- journal-0414-10-1097-ms9-0000000000003904 [batch 50, repeat 1] mismatches: referenceType; render similarity: 72.00%; winner: heuristic:quoted_title_journal_locator; mode: single_survivor
  Expected: Alsadi, M. O., Latifa, J., Alokla, D., Darkaznli, M. I., Al Almallah, L., Channan, F., & AlSalloum Alibrahim, M. J. (2025). Takotsubo cardiomyopathy: a rare case report highlighting seizure presentation in a 27-year-old female. Annals of Medicine & Surgery, 87(11), 7698–7700. https://doi.org/10.1097/ms9.0000000000003904
  Actual: Alsadi, M. O. (2025). Takotsubo cardiomyopathy: a rare case report highlighting seizure presentation in a 27-year-old female. In Annals of Medicine & Surgery (Vol. 87, Issue 11, pp. 7698-7700).
- journal-0150-10-1111-j-1467-8705-1974-tb01519-x [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 75.00%; winner: heuristic:quoted_title_journal_locator; mode: unanimous_diversity_guard
  Expected: EVERETT, B. (1974). A Visit to Burnt Norton. Critical Quarterly, 16(3), 199–224. https://doi.org/10.1111/j.1467-8705.1974.tb01519.x
  Actual: BARBARA EVERETT. (1974). A Visit to Burnt Norton. Critical Quarterly, 16(3), 199-224.
- book-0055-10-22533-at-ed-409201303 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 79.00%; winner: heuristic:author_year_publisher_tail; mode: full_scoring
  Expected: Mônica Jasper. (2020). Aspectos Fitossanitários da Agricultura. Atena Editora. https://doi.org/10.22533/at.ed.409201303
  Actual: Jasper, M. (2020). Aspectos Fitossanitários da Agricultura. Atena Editora.
- thesis-0001-10-17771-pucrio-acad-64355 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 83.00%; winner: heuristic:apa_thesis; mode: full_scoring
  Expected: CLARA QUARESMA PEREIRA DA SILVA, A. (2023). CULTURA POPULAR E (RE)PRODUÇÕES DE MASCULINIDADES HEGEMÔNICAS: ESTUDO DE CASO DA SÉRIE FRIENDS [Doctoral dissertation, Faculdades Catolicas]. https://doi.org/10.17771/pucrio.acad.64355
  Actual: CLARA QUARESMA PEREIRA da. (2023). CULTURA POPULAR E (re)produções DE MASCULINIDADES Hegemônicas: ESTUDO DE CASO DA SÉRIE FRIENDS. Faculdades Catolicas.
- report-0030-10-4271-630502 [batch 50, repeat 1] mismatches: pages; render similarity: 83.00%; winner: heuristic:vancouver_publisher_year_source; mode: full_scoring
  Expected: Eaton, W. F. (1963). An operator’s experience (p. 630502). SAE International. https://doi.org/10.4271/630502
  Actual: Eaton, W. F. (1963). An operator's experience. SAE International.
- chapter-0144-10-1007-978-981-10-6898-0-21 [batch 50, repeat 1] mismatches: referenceType; render similarity: 87.00%; winner: parser:selected_style:vancouver; mode: unanimous_diversity_guard
  Expected: Prakash, R. K. R., Amritha, P. P., & Sethumadhavan, M. (2017). Opaque Predicate Detection by Static Analysis of Binary Executables. In Communications in Computer and Information Science (pp. 250–258). Springer Singapore. https://doi.org/10.1007/978-981-10-6898-0_21
  Actual: Prakash, R. K. R., Amritha, P. P., & Sethumadhavan, M. (2017). Opaque Predicate Detection by Static Analysis of Binary Executables. In: Communications in Computer and Information Science, 250-258.
- journal-0383-10-5005-jp-journals-10006-2222 [batch 50, repeat 1] mismatches: referenceType, volume, issue, doi; render similarity: 88.00%; winner: heuristic:quoted_book_chapter; mode: single_survivor
  Expected: Megadhana, I. W., Winata, I. G. S., Widiyanti, E. S., & Lawu, A. A. (2023). Role of Oxygenation Factor Hypoxia-inducible Factor-1α (HIF-1α) as Prognostic Indicators in Cervical Cancer. Journal of South Asian Federation of Obstetrics and Gynaecology, 15(4), 490–496. https://doi.org/10.5005/jp-journals-10006-2222
  Actual: Megadhana, I. W., I Gde Sastra Winata, E. S. W., & Lawu, A. A. (2023). Role of Oxygenation Factor Hypoxia-inducible Factor-1α (HIF-1α) as Prognostic Indicators in Cervical Cancer. In Journal of South Asian Federation of Obstetrics and Gynaecology, vol. 15 (pp. 490-496). 10.
- journal-0039-10-1186-s13104-017-2882-4 [batch 50, repeat 1] mismatches: referenceType; render similarity: 88.00%; winner: heuristic:vancouver_compact_journal; mode: unanimous_diversity_guard
  Expected: Nakamura, K., Kato, M., Miyashita, Y., Nagashima, O., Sasaki, S., Tominaga, S., & Takahashi, K. (2017). Development of interstitial pneumonia during treatment with eribulin: a case report. BMC Research Notes, 10(1), 557. https://doi.org/10.1186/s13104-017-2882-4
  Actual: Nakamura, K., Kato, M., Miyashita, Y., Nagashima, O., Sasaki, S., Tominaga, S., & Takahashi, K. (2017). Development of interstitial pneumonia during treatment with eribulin: a case report. In BMC Research Notes (Vol. 10, Issue 1, p. 557). BMC Research Notes.
- thesis-0040-10-14264-190019 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 88.00%; winner: heuristic:sentence_thesis; mode: full_scoring
  Expected: Peter Kyne. (2023). Chondrichthyans and the Queensland East Coast Trawl Fishery: Bycatch reduction, biology, conservation status and sustainability [Doctoral dissertation, University of Queensland Library]. https://doi.org/10.14264/190019
  Actual: Kyne, P. (2023). Chondrichthyans and the Queensland East Coast Trawl Fishery: Bycatch reduction, biology, conservation status and sustainability. University of Queensland Library.
- journal-0433-10-1002-chin-197210264 [batch 50, repeat 1] mismatches: referenceType, venue, volume, issue, pages; render similarity: 88.00%; winner: heuristic:author_year_publisher_tail; mode: single_survivor
  Expected: GUNDERMANN, K., BURZIN, K., SPRENGER, F., & SCHULZE, H. (1972). ChemInform Abstract: BERBESSERTE SYNTH. VON 2‐CYAN‐AZIRIDINEN UND UNTERSUCHUNGEN ZU IHRER ISOMERISIERUNG. Chemischer Informationsdienst, 3(10), chin.197210264. https://doi.org/10.1002/chin.197210264
  Actual: GUNDERMANN, KARL‐DIETRICH, BURZIN, FRANZ‐JOSEF, & SCHULZE. (1972). Cheminform Abstract: BERBESSERTE Synth. VON 2‐cyan‐aziridinen UND UNTERSUCHUNGEN ZU IHRER ISOMERISIERUNG. Chemischer Informationsdienst, 3(10), chin.197210264.
- journal-0025-10-1134-s0036023619070088 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 89.00%; winner: heuristic:apa_journal; mode: single_survivor
  Expected: Folomeikin, Yu. I., Karachevtsev, F. N., & Stolyarova, V. L. (2019). Production of Ceramics Based on the Y2O3–ZrO2–HfO2 System for Casting Molds. Russian Journal of Inorganic Chemistry, 64(7), 934–940. https://doi.org/10.1134/s0036023619070088
  Actual: Karachevtsev, F. N., & Stolyarova, V. L. (2019). Production of Ceramics Based on the Y2O3-ZrO2-HfO2 System for Casting Molds. Russian Journal of Inorganic Chemistry, 64(7), 934-940.

