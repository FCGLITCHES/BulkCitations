# Academic Benchmark Report

Generated: 2026-03-29T05:27:26.463Z
Frozen corpus: 2026-03-27T12:11:27.113Z
Corpus size: 1000 real citations
IEEE slice: 159 citations per corpus run
Machine-readable report: D:\Coding\Citing\output\academic-benchmark-1000-report.json

## Executive summary

This internal benchmark evaluates 1000 real-world academic references across journals, conferences, books, chapters, reports, and theses. It runs the deterministic v2 engine in 50, 100, and 200 citation batches to mirror institutional use while separating strict external readiness from a legacy internal-compatibility score.

## External Readiness Score (Primary)

- Strict essential accuracy: 81.93%
- Count integrity: 99.50%
- Non-empty output rate: 99.50%
- Identity integrity: 99.40%
- Identity contamination count: 3
- Consistency: 96.10%
- Average APA render similarity: 90.20%
- LLM fallback attempt rate: 0.00%

## LLM Fallback Diagnostics

- Enrichment opt-in: enabled
- Hybrid benchmark opt-in: disabled
- Fallback attempts recorded in this primary report: 0
- Rejected reasons: none recorded in this run

## Internal Compatibility Reference (Secondary)

- Legacy-comparable field average: 94.44%
- Methodology version: 1.0
- Frozen at: 2026-03-27

Footnote: The primary score uses strict citation-level pass/fail on core fields plus identity and output integrity. The secondary score is a frozen internal field-average reference for historical comparison only and must not be cited as the external readiness number.

## Action Needed Reasons

- Overall multi_field_low_confidence: 155
- Overall weak_venue: 35
- Overall empty_output: 15
- Overall missing_authors: 15
- Overall weak_first_author: 15
- Overall weak_reference_type: 15
- Overall malformed_authors: 5
- Overall identity_contamination: 3

- IEEE multi_field_low_confidence: 45
- IEEE empty_output: 6
- IEEE missing_authors: 6
- IEEE weak_venue: 4
- IEEE weak_first_author: 3
- IEEE weak_reference_type: 3
- IEEE identity_contamination: 0
- IEEE malformed_authors: 0

- Near-pass multi_field_low_confidence: 134
- Near-pass weak_venue: 29
- Near-pass weak_reference_type: 15
- Near-pass weak_first_author: 9
- Near-pass malformed_authors: 5
- Near-pass empty_output: 0
- Near-pass identity_contamination: 0
- Near-pass missing_authors: 0

## Dominant Failure Ledger

- residual_other: 54 (29.35%)
- venue_cleanup: 46 (25.00%)
- conference_container_type: 26 (14.13%)
- ieee_author_order: 22 (11.96%)
- pages_locator: 12 (6.52%)
- report_institution_type: 12 (6.52%)
- apa_author_order: 6 (3.26%)
- missing_output: 5 (2.72%)
- identity_contamination: 1 (0.54%)

## Near-Pass Ledger

- firstAuthor: 58 (31.52%)
- referenceType: 33 (17.93%)
- venue: 19 (10.33%)
- title: 7 (3.80%)
- year: 3 (1.63%)
- identity: 0 (0.00%)
- output: 0 (0.00%)

## Weighted Lift Model

- Current strict external accuracy: 81.93%
- Target strict external accuracy: 90.00%
- Remaining gap: 8.07%
- Source journal: share 55.00%, strict 84.55%, weighted headroom 8.50%
- Source conference: share 15.00%, strict 73.56%, weighted headroom 3.97%
- Source book: share 10.00%, strict 78.33%, weighted headroom 2.17%
- Source chapter: share 10.00%, strict 84.67%, weighted headroom 1.53%
- Source report: share 5.00%, strict 70.00%, weighted headroom 1.50%
- Source thesis: share 5.00%, strict 92.00%, weighted headroom 0.40%

## Methodology

- The corpus contains 1,000 real citations drawn from Crossref and frozen locally on the generation date shown above.
- The primary score uses the deterministic v2 pipeline with enrichment enabled and LLM extraction and GROBID disabled.
- The secondary hybrid run enables GPT-5.4 nano extract fallback only when ACADEMIC_BENCHMARK_ENABLE_HYBRID=1; it is reported separately and must not replace the deterministic business-facing KPI.
- Strict external readiness requires referenceType, year, title, firstAuthor, venue, non-empty output, and identity integrity to all pass.
- The legacy-comparable score is a frozen field-average reference for internal comparison only.

## Batch results

### Batch size 50

- Strict essential accuracy: 82.00%
- Legacy field average: 94.19%
- Count integrity: 99.50%
- Non-empty output rate: 99.50%
- Identity integrity: 99.40%
- Identity contamination count: 1
- Consistency: 88.29%
- Mean batch time: 3353.92 ms
- Median batch time: 2470.58 ms
- P95 batch time: 6527.94 ms
- Mean ms per citation: 67.08 ms
- Throughput: 4.97 citations/sec

### Batch size 100

- Strict essential accuracy: 81.90%
- Legacy field average: 94.56%
- Count integrity: 99.50%
- Non-empty output rate: 99.50%
- Identity integrity: 99.40%
- Identity contamination count: 1
- Consistency: 100.00%
- Mean batch time: 3747.02 ms
- Median batch time: 3842.05 ms
- P95 batch time: 4525.65 ms
- Mean ms per citation: 37.47 ms
- Throughput: 8.90 citations/sec

### Batch size 200

- Strict essential accuracy: 81.90%
- Legacy field average: 94.56%
- Count integrity: 99.50%
- Non-empty output rate: 99.50%
- Identity integrity: 99.40%
- Identity contamination count: 1
- Consistency: 100.00%
- Mean batch time: 7437.96 ms
- Median batch time: 7412.12 ms
- P95 batch time: 7983.49 ms
- Mean ms per citation: 37.19 ms
- Throughput: 8.96 citations/sec

## IEEE failure breakdown

- author_order: 60
- venue_abbreviation: 18
- locator_misclassified: 3
- doi_parse: 0
- reference_type: 30
- identity_contamination: 0
- empty_output: 6

## Selector diagnostics

- selection mode full_scoring: 963
- selection mode single_survivor: 1044
- selection mode unanimous_diversity_guard: 978
- top winner adapter heuristic:ieee_quoted_reference: 609
- top winner adapter heuristic:in_source_container: 363
- top winner adapter heuristic:quoted_title_journal_locator: 225
- top winner adapter heuristic:harvard_sentence_journal: 222
- top winner adapter heuristic:vancouver_compact_journal: 204

## Type confusion matrix

- journal -> journal: 1575
- conference -> conference: 411
- chapter -> chapter: 273
- book -> book: 270
- thesis -> thesis: 150
- report -> report: 132
- journal -> conference: 39
- conference -> chapter: 27
- journal -> book: 21
- chapter -> journal: 15

## Strengths

- The benchmark uses a frozen 1,000-reference real-world corpus, making reruns auditable and institution-friendly.
- Strict external readiness, internal legacy compatibility, and batch performance are separated instead of being collapsed into one misleading score.
- thesis records performed best on the strict score at 92.00%.
- The fastest operating point was the 200-citation batch at 8.96 citations/sec.

## Weaknesses

- report is the weakest strict source type and should stay in the next remediation wave.
- IEEE is the lowest-performing input style on the strict score.
- pages is the lowest-accuracy field and remains the clearest parser-recovery target.
- Identity contamination currently accounts for 3 strict failures across the benchmarked runs.

## Pros

- Uses real citations rather than synthetic placeholders.
- Separates strict external readiness from legacy internal comparability.
- Measures count integrity, non-empty output, identity integrity, consistency, and speed as distinct operational properties.
- Evaluates 50, 100, and 200 citation batch sizes to mirror institution-friendly throughput constraints.

## Cons

- The deterministic benchmark disables enrichment, LLM extraction, and GROBID, so it is intentionally tougher than an assisted production path.
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
- journal-0002-10-53730-ijhs-v6ns1-8707 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 75.00%; winner: heuristic:ieee_quoted_reference; mode: single_survivor
  Expected: Djumabaevich, T. S., Karimovich, K. Z., Beknazarovich, X. Z., Sagdullaevich, A. N., & Tirkashevich, M. S. (2022). role and significance of physical culture and sport in the sphere of education. International Journal of Health Sciences, 14419–14427. https://doi.org/10.53730/ijhs.v6ns1.8707
  Actual: Tashtaev, S. D., Khudoiberganov, Z. K., Xudaykulov, Z. B., Adilov, N. S., & Mamasoliev, S. T. (2022). role and significance of physical culture and sport in the sphere of education. International Journal of Health Sciences, 14419-14427.
- journal-0150-10-1111-j-1467-8705-1974-tb01519-x [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 75.00%; winner: heuristic:quoted_title_journal_locator; mode: unanimous_diversity_guard
  Expected: EVERETT, B. (1974). A Visit to Burnt Norton. Critical Quarterly, 16(3), 199–224. https://doi.org/10.1111/j.1467-8705.1974.tb01519.x
  Actual: BARBARA EVERETT. (1974). A Visit to Burnt Norton. Critical Quarterly, 16(3), 199-224.
- journal-0171-10-47191-jefms-v5-i9-30 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 79.00%; winner: heuristic:institutional_vancouver_journal; mode: single_survivor
  Expected: Department of Economics, Faculty of Social Sciences, Niger Delta University, Wilberforce Island, P.M.B. 071, Yenagoa, Bayelsa State, Nigeria. (2022). Naira to Dollar Exchange Rate Fluctuations and Nigeria’s Balance of Payment. JOURNAL OF ECONOMICS, FINANCE AND MANAGEMENT STUDIES, 5(9). https://doi.org/10.47191/jefms/v5-i9-30
  Actual: Department of Economics, Island, P. 071 W., Yenagoa, State, B., & Nigeria. (2022). Naira to Dollar Exchange Rate Fluctuations and Nigeria's Balance of Payment. JOURNAL OF ECONOMICS, FINANCE AND MANAGEMENT STUDIES, 5(9).
- thesis-0001-10-17771-pucrio-acad-64355 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 83.00%; winner: heuristic:apa_thesis; mode: full_scoring
  Expected: CLARA QUARESMA PEREIRA DA SILVA, A. (2023). CULTURA POPULAR E (RE)PRODUÇÕES DE MASCULINIDADES HEGEMÔNICAS: ESTUDO DE CASO DA SÉRIE FRIENDS [Doctoral dissertation, Faculdades Catolicas]. https://doi.org/10.17771/pucrio.acad.64355
  Actual: CLARA QUARESMA PEREIRA da. (2023). CULTURA POPULAR E (re)produções DE MASCULINIDADES Hegemônicas: ESTUDO DE CASO DA SÉRIE FRIENDS. Faculdades Catolicas.
- journal-0383-10-5005-jp-journals-10006-2222 [batch 50, repeat 1] mismatches: referenceType, volume, issue, doi; render similarity: 88.00%; winner: heuristic:quoted_book_chapter; mode: single_survivor
  Expected: Megadhana, I. W., Winata, I. G. S., Widiyanti, E. S., & Lawu, A. A. (2023). Role of Oxygenation Factor Hypoxia-inducible Factor-1α (HIF-1α) as Prognostic Indicators in Cervical Cancer. Journal of South Asian Federation of Obstetrics and Gynaecology, 15(4), 490–496. https://doi.org/10.5005/jp-journals-10006-2222
  Actual: Megadhana, I. W., I Gde Sastra Winata, E. S. W., & Lawu, A. A. (2023). Role of Oxygenation Factor Hypoxia-inducible Factor-1α (HIF-1α) as Prognostic Indicators in Cervical Cancer. In Journal of South Asian Federation of Obstetrics and Gynaecology, vol. 15, no. 4 (pp. 490-496). 10.
- thesis-0040-10-14264-190019 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 88.00%; winner: heuristic:sentence_thesis; mode: full_scoring
  Expected: Peter Kyne. (2023). Chondrichthyans and the Queensland East Coast Trawl Fishery: Bycatch reduction, biology, conservation status and sustainability [Doctoral dissertation, University of Queensland Library]. https://doi.org/10.14264/190019
  Actual: Kyne, P. (2023). Chondrichthyans and the Queensland East Coast Trawl Fishery: Bycatch reduction, biology, conservation status and sustainability. University of Queensland Library.
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
- journal-0566-10-1016-j-molcata-2009-01-028 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 90.00%; winner: heuristic:ieee_quoted_reference; mode: single_survivor
  Expected: Venu Madhav, J., Thirupathi Reddy, Y., Narsimha Reddy, P., Nikhil Reddy, M., Kuarm, S., Crooks, Peter. A., & Rajitha, B. (2009). Cellulose sulfuric acid: An efficient biodegradable and recyclable solid acid catalyst for the one-pot synthesis of aryl-14H-dibenzo[a.j]xanthenes under solvent-free conditions. Journal of Molecular Catalysis A: Chemical, 304(1–2), 85–87. https://doi.org/10.1016/j.molcata.2009.01.028
  Actual: Madhav, J. V., Reddy, Y. T., Reddy, P. N., Reddy, M. N., Kuarm, S., Crooks, P. A., & Rajitha, B. (2009). Cellulose sulfuric acid: An efficient biodegradable and recyclable solid acid catalyst for the one-pot synthesis of aryl-14H-dibenzo[a.j]xanthenes under solvent-free conditions. Journal of Molecular Catalysis A: Chemical, 304(1-2), 85-87.
- journal-0352-10-1103-physreve-60-r29 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 90.00%; winner: heuristic:harvard_sentence_journal; mode: unanimous_diversity_guard
  Expected: Lapeña, A. M., Glotzer, S. C., Langer, S. A., & Liu, A. J. (1999). Effect of ordering on spinodal decomposition of liquid-crystal/polymer mixtures. Physical Review E, 60(1), R29–R32. https://doi.org/10.1103/physreve.60.r29
  Actual: Lapeña, A., Glotzer, S., Langer, S., & Liu, A. (1999). Effect of ordering on spinodal decomposition of liquid-crystal/polymer mixtures. Physical Review E, 60(1), R29-R32.

