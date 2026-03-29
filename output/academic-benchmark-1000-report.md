# Academic Benchmark Report

Generated: 2026-03-29T13:57:43.150Z
Frozen corpus: 2026-03-27T12:11:27.113Z
Corpus size: 1000 real citations
IEEE slice: 159 citations per corpus run
Machine-readable report: D:\Coding\Citing\output\academic-benchmark-1000-report.json

## Executive summary

This internal benchmark evaluates 1000 real-world academic references across journals, conferences, books, chapters, reports, and theses. It runs the current v2 engine in 50, 100, and 200 citation batches to mirror institutional use while separating strict external readiness from a legacy internal-compatibility score.

## External Readiness Score (Primary)

- Strict essential accuracy: 81.77%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 0.00%
- Average APA render similarity: 90.12%
- Direct LLM call rate: 17.40%

## LLM Fallback Diagnostics

- Enrichment opt-in: disabled
- LLM extract opt-in: enabled
- LLM actually used in this run: yes
- Direct model calls recorded: 174
- Direct model accepts: 146
- Cluster-reused LLM accepts: 213
- Total citations that accepted LLM-derived fields: 359
- Rejected fallback attempts: 28
- Budget-skipped fallback attempts: 282
- Accepted fallbacks with improved fields: 165
- Accepted fallbacks with non-empty output: 359
- Accepted fallbacks that increased strict pass coverage: 10
- Total strict-pass delta from accepted fallbacks: 11
- Improved field authors: 143
- Improved field thesisType: 36
- Improved field title: 22
- Improved field bookTitle: 16
- Improved field institution: 10
- Improved field firstAuthor: 9
- Improved field publisher: 7
- Improved field edition: 5
- Improved field pages: 5
- Improved field journal: 4
- Improved field placeOfPublication: 4
- Improved field volume: 4
- Improved field doi: 3
- Improved field issue: 2
- Improved field url: 1
- Rejected reference_type_less_coherent: 13
- Rejected no_strict_gain: 9
- Rejected llm_invalid_or_failed: 3
- Rejected title_plausibility_worsened: 1
- Rejected type_change_missing_support_fields: 1
- Rejected venue_plausibility_worsened: 1
- Accepted cluster_reuse: 213
- Accepted semantic_gain:authors: 65
- Accepted semantic_gain:thesisType|authors: 32
- Accepted semantic_gain:authors|title: 14
- Accepted semantic_gain:bookTitle|authors: 7
- Accepted improved:firstAuthor|authors: 2
- Accepted semantic_gain:authors|title|publisher: 2
- Accepted semantic_gain:institution|authors: 2
- Accepted semantic_gain:thesisType: 2
- Accepted improved:firstAuthor|authors|pages: 1
- Accepted improved:firstAuthor|authors|title: 1
- Accepted improved:firstAuthor|authors|volume|pages: 1
- Accepted improved:firstAuthor|edition|authors|title: 1
- Accepted improved:firstAuthor|publisher|authors: 1
- Accepted improved:firstAuthor|url|authors|doi: 1
- Accepted improved:title|authors|journal|pages: 1
- Accepted improved:title|firstAuthor|authors|journal|volume|issue|pages: 1
- Accepted semantic_gain:authors|doi: 1
- Accepted semantic_gain:authors|institution: 1
- Accepted semantic_gain:authors|journal: 1
- Accepted semantic_gain:authors|journal|volume|issue|doi: 1
- Accepted semantic_gain:authors|pages: 1
- Accepted semantic_gain:authors|publisher: 1
- Accepted semantic_gain:authors|volume: 1
- Accepted semantic_gain:edition|authors|title: 1
- Accepted semantic_gain:placeOfPublication|authors|institution|publisher: 1
- Accepted semantic_gain:placeOfPublication|institution|publisher: 1
- Accepted semantic_gain:thesisType|authors|institution: 1
- Accepted semantic_gain:thesisType|authors|title: 1

## Internal Compatibility Reference (Secondary)

- Legacy-comparable field average: 94.78%
- Methodology version: 1.0
- Frozen at: 2026-03-27

Footnote: The primary score uses strict citation-level pass/fail on core fields plus identity and output integrity. The secondary score is a frozen internal field-average reference for historical comparison only and must not be cited as the external readiness number.

## Action Needed Reasons

- Overall multi_field_low_confidence: 98
- Overall weak_venue: 20
- Overall weak_reference_type: 14
- Overall missing_authors: 13
- Overall empty_output: 12
- Overall weak_first_author: 9
- Overall malformed_authors: 3
- Overall identity_contamination: 0

- IEEE multi_field_low_confidence: 25
- IEEE empty_output: 6
- IEEE missing_authors: 6
- IEEE weak_venue: 6
- IEEE weak_first_author: 3
- IEEE weak_reference_type: 3
- IEEE identity_contamination: 0
- IEEE malformed_authors: 0

- Near-pass multi_field_low_confidence: 85
- Near-pass weak_venue: 19
- Near-pass weak_reference_type: 13
- Near-pass weak_first_author: 9
- Near-pass malformed_authors: 3
- Near-pass empty_output: 0
- Near-pass identity_contamination: 0
- Near-pass missing_authors: 0

## Dominant Failure Ledger

- residual_other: 73 (37.44%)
- venue_cleanup: 38 (19.49%)
- conference_container_type: 32 (16.41%)
- ieee_author_order: 20 (10.26%)
- pages_locator: 11 (5.64%)
- report_institution_type: 9 (4.62%)
- apa_author_order: 8 (4.10%)
- missing_output: 4 (2.05%)
- identity_contamination: 0 (0.00%)

## Near-Pass Ledger

- firstAuthor: 55 (28.21%)
- referenceType: 51 (26.15%)
- venue: 24 (12.31%)
- title: 9 (4.62%)
- year: 2 (1.03%)
- identity: 0 (0.00%)
- output: 0 (0.00%)

## Weighted Lift Model

- Current strict external accuracy: 81.77%
- Target strict external accuracy: 90.00%
- Remaining gap: 8.23%
- Source journal: share 55.00%, strict 84.67%, weighted headroom 8.43%
- Source conference: share 15.00%, strict 68.89%, weighted headroom 4.67%
- Source book: share 10.00%, strict 79.67%, weighted headroom 2.03%
- Source chapter: share 10.00%, strict 84.00%, weighted headroom 1.60%
- Source report: share 5.00%, strict 80.67%, weighted headroom 0.97%
- Source thesis: share 5.00%, strict 89.33%, weighted headroom 0.53%

## Methodology

- The corpus contains 1,000 real citations drawn from Crossref and frozen locally on the generation date shown above.
- The primary score uses the v2 pipeline with enrichment disabled, GPT-5.4 nano extract fallback enabled, and GROBID disabled.
- Strict external readiness requires referenceType, year, title, firstAuthor, venue, non-empty output, and identity integrity to all pass.
- The legacy-comparable score is a frozen field-average reference for internal comparison only.

## Batch results

### Batch size 50

- Strict essential accuracy: 81.60%
- Legacy field average: 94.71%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 0.00%
- Mean batch time: 19144.77 ms
- Median batch time: 18937.94 ms
- P95 batch time: 25815.28 ms
- Mean ms per citation: 382.90 ms
- Throughput: 2.61 citations/sec

### Batch size 100

- Strict essential accuracy: 81.90%
- Legacy field average: 94.84%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 0.00%
- Mean batch time: 26119.69 ms
- Median batch time: 26280.04 ms
- P95 batch time: 28174.82 ms
- Mean ms per citation: 261.20 ms
- Throughput: 3.83 citations/sec

### Batch size 200

- Strict essential accuracy: 81.80%
- Legacy field average: 94.80%
- Count integrity: 99.60%
- Non-empty output rate: 99.60%
- Identity integrity: 99.60%
- Identity contamination count: 0
- Consistency: 0.00%
- Mean batch time: 39338.97 ms
- Median batch time: 40046.78 ms
- P95 batch time: 42059.47 ms
- Mean ms per citation: 196.70 ms
- Throughput: 5.08 citations/sec

## IEEE failure breakdown

- author_order: 52
- venue_abbreviation: 20
- locator_misclassified: 0
- doi_parse: 0
- reference_type: 42
- identity_contamination: 0
- empty_output: 6

## Selector diagnostics

- selection mode full_scoring: 966
- selection mode single_survivor: 1040
- selection mode unanimous_diversity_guard: 981
- top winner adapter heuristic:ieee_quoted_reference: 615
- top winner adapter heuristic:in_source_container: 363
- top winner adapter heuristic:harvard_sentence_journal: 225
- top winner adapter heuristic:quoted_title_journal_locator: 225
- top winner adapter heuristic:vancouver_compact_journal: 204

## Type confusion matrix

- journal -> journal: 1538
- conference -> conference: 414
- chapter -> chapter: 272
- book -> book: 257
- thesis -> thesis: 150
- report -> report: 147
- journal -> conference: 48
- journal -> report: 33
- book -> report: 24
- conference -> chapter: 24

## Strengths

- The benchmark uses a frozen 1,000-reference real-world corpus, making reruns auditable and institution-friendly.
- Strict external readiness, internal legacy compatibility, and batch performance are separated instead of being collapsed into one misleading score.
- thesis records performed best on the strict score at 89.33%.
- The fastest operating point was the 200-citation batch at 5.08 citations/sec.

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
- thesis-0001-10-17771-pucrio-acad-64355 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 83.00%; winner: heuristic:apa_thesis; mode: full_scoring
  Expected: CLARA QUARESMA PEREIRA DA SILVA, A. (2023). CULTURA POPULAR E (RE)PRODUÇÕES DE MASCULINIDADES HEGEMÔNICAS: ESTUDO DE CASO DA SÉRIE FRIENDS [Doctoral dissertation, Faculdades Catolicas]. https://doi.org/10.17771/pucrio.acad.64355
  Actual: CLARA QUARESMA PEREIRA da. (2023). CULTURA POPULAR E (re)produções DE MASCULINIDADES Hegemônicas: ESTUDO DE CASO DA SÉRIE FRIENDS. Faculdades Catolicas.
- report-0030-10-4271-630502 [batch 50, repeat 1] mismatches: pages; render similarity: 83.00%; winner: heuristic:vancouver_publisher_year_source; mode: full_scoring
  Expected: Eaton, W. F. (1963). An operator’s experience (p. 630502). SAE International. https://doi.org/10.4271/630502
  Actual: Eaton, W. F. (1963). An operator's experience. SAE International.
- chapter-0144-10-1007-978-981-10-6898-0-21 [batch 50, repeat 1] mismatches: referenceType; render similarity: 87.00%; winner: parser:selected_style:vancouver; mode: unanimous_diversity_guard
  Expected: Prakash, R. K. R., Amritha, P. P., & Sethumadhavan, M. (2017). Opaque Predicate Detection by Static Analysis of Binary Executables. In Communications in Computer and Information Science (pp. 250–258). Springer Singapore. https://doi.org/10.1007/978-981-10-6898-0_21
  Actual: Prakash, R. K. R., Amritha, P. P., & Sethumadhavan, M. (2017). Opaque Predicate Detection by Static Analysis of Binary Executables. In: Communications in Computer and Information Science, 250-258.
- thesis-0033-10-47749-t-unicamp-2011-800745 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 88.00%; winner: heuristic:apa_thesis; mode: full_scoring
  Expected: Luís Zani, E. (2021). Profilaxia antibiótica na biópsia prostática transretal: revisão sistemática com metanálise [Doctoral dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.2011.800745
  Actual: Zani, L., & Emerson. (2021). Profilaxia antibiótica na biópsia prostática transretal: revisão sistemática com metanálise [Doctoral dissertation]. Universidade Estadual de Campinas.
- journal-0383-10-5005-jp-journals-10006-2222 [batch 50, repeat 1] mismatches: referenceType, volume, issue, doi; render similarity: 88.00%; winner: heuristic:quoted_book_chapter; mode: single_survivor
  Expected: Megadhana, I. W., Winata, I. G. S., Widiyanti, E. S., & Lawu, A. A. (2023). Role of Oxygenation Factor Hypoxia-inducible Factor-1α (HIF-1α) as Prognostic Indicators in Cervical Cancer. Journal of South Asian Federation of Obstetrics and Gynaecology, 15(4), 490–496. https://doi.org/10.5005/jp-journals-10006-2222
  Actual: Megadhana, I. W., I Gde Sastra Winata, E. S. W., & Lawu, A. A. (2023). Role of Oxygenation Factor Hypoxia-inducible Factor-1α (HIF-1α) as Prognostic Indicators in Cervical Cancer. In Journal of South Asian Federation of Obstetrics and Gynaecology, vol. 15 (pp. 490-496). 10.
- journal-0039-10-1186-s13104-017-2882-4 [batch 50, repeat 1] mismatches: referenceType; render similarity: 88.00%; winner: heuristic:vancouver_compact_journal; mode: unanimous_diversity_guard
  Expected: Nakamura, K., Kato, M., Miyashita, Y., Nagashima, O., Sasaki, S., Tominaga, S., & Takahashi, K. (2017). Development of interstitial pneumonia during treatment with eribulin: a case report. BMC Research Notes, 10(1), 557. https://doi.org/10.1186/s13104-017-2882-4
  Actual: Nakamura, K., Kato, M., Miyashita, Y., Nagashima, O., Sasaki, S., Tominaga, S., & Takahashi, K. (2017). Development of interstitial pneumonia during treatment with eribulin: a case report. In BMC Research Notes (Vol. 10, Issue 1, p. 557). BMC Research Notes.
- thesis-0040-10-14264-190019 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 88.00%; winner: heuristic:sentence_thesis; mode: full_scoring
  Expected: Peter Kyne. (2023). Chondrichthyans and the Queensland East Coast Trawl Fishery: Bycatch reduction, biology, conservation status and sustainability [Doctoral dissertation, University of Queensland Library]. https://doi.org/10.14264/190019
  Actual: Kyne, P. (2023). Chondrichthyans and the Queensland East Coast Trawl Fishery: Bycatch reduction, biology, conservation status and sustainability. University of Queensland Library.
- journal-0025-10-1134-s0036023619070088 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 89.00%; winner: heuristic:apa_journal; mode: single_survivor
  Expected: Folomeikin, Yu. I., Karachevtsev, F. N., & Stolyarova, V. L. (2019). Production of Ceramics Based on the Y2O3–ZrO2–HfO2 System for Casting Molds. Russian Journal of Inorganic Chemistry, 64(7), 934–940. https://doi.org/10.1134/s0036023619070088
  Actual: Karachevtsev, F. N., & Stolyarova, V. L. (2019). Production of Ceramics Based on the Y2O3-ZrO2-HfO2 System for Casting Molds. Russian Journal of Inorganic Chemistry, 64(7), 934-940.
- journal-0394-10-14222-turkiyat4249 [batch 50, repeat 1] mismatches: issue; render similarity: 90.00%; winner: heuristic:harvard_sentence_journal; mode: full_scoring
  Expected: COŞKUN, D. (2020). Şîa’nın Siyasallaşma Sürecinde Seyyid Kıvâmeddin Marâşî. Journal of Turkish Research Institute, 67, 481–491. https://doi.org/10.14222/turkiyat4249
  Actual: C. O.ŞK. U. N., D. (2020). Şîa'nın Siyasallaşma Sürecinde Seyyid Kıvâmeddin Marâşî. Journal of Turkish Research Institute, (67), 481-491.

