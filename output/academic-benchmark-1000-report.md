# Academic Benchmark Report

Generated: 2026-03-28T07:41:18.268Z
Frozen corpus: 2026-03-27T12:11:27.113Z
Corpus size: 1000 real citations
IEEE slice: 159 citations per corpus run
Machine-readable report: D:\Coding\Citing\output\academic-benchmark-1000-report.json

## Executive summary

This internal benchmark evaluates 1000 real-world academic references across journals, conferences, books, chapters, reports, and theses. It runs the deterministic v2 engine in 50, 100, and 200 citation batches to mirror institutional use while separating strict external readiness from a legacy internal-compatibility score.

## External Readiness Score (Primary)

- Strict essential accuracy: 71.20%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 98.90%
- Identity contamination count: 9
- Consistency: 100.00%
- Average APA render similarity: 88.89%
- LLM fallback attempt rate: 0.00%

## Internal Compatibility Reference (Secondary)

- Legacy-comparable field average: 91.85%
- Methodology version: 1.0
- Frozen at: 2026-03-27

Footnote: The primary score uses strict citation-level pass/fail on core fields plus identity and output integrity. The secondary score is a frozen internal field-average reference for historical comparison only and must not be cited as the external readiness number.

## Action Needed Reasons

- Overall multi_field_low_confidence: 117
- Overall malformed_authors: 66
- Overall weak_first_author: 51
- Overall weak_venue: 51
- Overall weak_reference_type: 48
- Overall missing_authors: 27
- Overall empty_output: 24
- Overall identity_contamination: 9

- IEEE multi_field_low_confidence: 33
- IEEE malformed_authors: 21
- IEEE weak_first_author: 21
- IEEE weak_reference_type: 12
- IEEE weak_venue: 12
- IEEE empty_output: 6
- IEEE missing_authors: 6
- IEEE identity_contamination: 0

- Near-pass multi_field_low_confidence: 60
- Near-pass malformed_authors: 54
- Near-pass weak_first_author: 30
- Near-pass weak_venue: 24
- Near-pass weak_reference_type: 18
- Near-pass empty_output: 0
- Near-pass identity_contamination: 0
- Near-pass missing_authors: 0

## Methodology

- The corpus contains 1,000 real citations drawn from Crossref and frozen locally on the generation date shown above.
- The primary score uses the deterministic v2 pipeline with enrichment, LLM extraction, and GROBID disabled for repeatability.
- The secondary hybrid run enables GPT-5.4 nano extract fallback only; it is reported separately and must not replace the deterministic business-facing KPI.
- Strict external readiness requires referenceType, year, title, firstAuthor, venue, non-empty output, and identity integrity to all pass.
- The legacy-comparable score is a frozen field-average reference for internal comparison only.

## Batch results

### Batch size 50

- Strict essential accuracy: 71.20%
- Legacy field average: 91.85%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 98.90%
- Identity contamination count: 3
- Consistency: 100.00%
- Mean batch time: 1776.79 ms
- Median batch time: 1469.32 ms
- P95 batch time: 2636.11 ms
- Mean ms per citation: 35.54 ms
- Throughput: 9.38 citations/sec

### Batch size 100

- Strict essential accuracy: 71.20%
- Legacy field average: 91.85%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 98.90%
- Identity contamination count: 3
- Consistency: 100.00%
- Mean batch time: 3459.17 ms
- Median batch time: 3596.11 ms
- P95 batch time: 4280.24 ms
- Mean ms per citation: 34.59 ms
- Throughput: 9.64 citations/sec

### Batch size 200

- Strict essential accuracy: 71.20%
- Legacy field average: 91.85%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 98.90%
- Identity contamination count: 3
- Consistency: 100.00%
- Mean batch time: 7119.80 ms
- Median batch time: 7168.28 ms
- P95 batch time: 7668.92 ms
- Mean ms per citation: 35.60 ms
- Throughput: 9.36 citations/sec

## IEEE failure breakdown

- author_order: 60
- venue_abbreviation: 12
- locator_misclassified: 3
- doi_parse: 0
- reference_type: 72
- identity_contamination: 0
- empty_output: 6

## Selector diagnostics

- selection mode full_scoring: 915
- selection mode single_survivor: 1122
- selection mode unanimous_diversity_guard: 939
- top winner adapter heuristic:ieee_quoted_reference: 627
- top winner adapter heuristic:quoted_title_journal_locator: 222
- top winner adapter heuristic:harvard_sentence_journal: 219
- top winner adapter parser:selected_style:apa: 219
- top winner adapter heuristic:vancouver_compact_journal: 201

## Type confusion matrix

- journal -> journal: 1584
- conference -> conference: 351
- book -> book: 258
- chapter -> chapter: 177
- thesis -> thesis: 144
- report -> report: 102
- chapter -> conference: 60
- chapter -> book: 39
- conference -> chapter: 39
- conference -> journal: 30

## Strengths

- The benchmark uses a frozen 1,000-reference real-world corpus, making reruns auditable and institution-friendly.
- Strict external readiness, internal legacy compatibility, and batch performance are separated instead of being collapsed into one misleading score.
- thesis records performed best on the strict score at 84.00%.
- The fastest operating point was the 100-citation batch at 9.64 citations/sec.

## Weaknesses

- chapter is the weakest strict source type and should stay in the next remediation wave.
- APA is the lowest-performing input style on the strict score.
- venue is the lowest-accuracy field and remains the clearest parser-recovery target.
- Identity contamination currently accounts for 9 strict failures across the benchmarked runs.

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
- thesis-0017-10-47749-t-unicamp-2012-899614 [batch 50, repeat 1] mismatches: referenceType, year, title, firstAuthor, venue, doi, identity; render similarity: 36.00%; identity: shifted_prev; winner: parser:selected_style:mla; mode: single_survivor
  Expected: de Oliveira, W. (2021). Simulação para a avaliação do desempenho do sistema de proteção de distância de uma linha de transmissão de 500 KV [Doctoral dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.2012.899614
  Actual: Qiao, M., & Jindrich, D. L. (2014). Compensations during Unsteady Locomotion. Integrative and Comparative Biology, 54(6), 1109-1121.
- journal-0150-10-1111-j-1467-8705-1974-tb01519-x [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 75.00%; winner: heuristic:quoted_title_journal_locator; mode: unanimous_diversity_guard
  Expected: EVERETT, B. (1974). A Visit to Burnt Norton. Critical Quarterly, 16(3), 199–224. https://doi.org/10.1111/j.1467-8705.1974.tb01519.x
  Actual: BARBARA. EVERETT. (1974). A Visit to Burnt Norton. Critical Quarterly, 16(3), 199-224.
- conference-0137-10-1115-detc97-dac-3769 [batch 50, repeat 1] mismatches: venue, pages; render similarity: 78.00%; winner: parser:selected_style:apa; mode: full_scoring
  Expected: Srikanth, K., Liou, F. W., & Balakrishnan, S. N. (1997). Fuzzy Tolerance Analysis of 3-D Mechanical Assemblies. Volume 2: 23rd Design Automation Conference, V002T29A056. https://doi.org/10.1115/detc97/dac-3769
  Actual: Srikanth, K., Liou, F. W., & Balakrishnan, S. N. (1997). Fuzzy Tolerance Analysis of 3-D Mechanical Assemblies. In Volume 2: 23rd Design Automation Conference, 1997, T29A056. American Society of Mechanical Engineers. American Society of Mechanical Engineers. https://doi.org/10.1115/detc97/dac-3769.
- conference-0037-10-14201-0aq0321341349 [batch 50, repeat 1] mismatches: referenceType, venue; render similarity: 82.00%; winner: parser:auto:harvard; mode: full_scoring
  Expected: Deluigi, R., Cuccu, M., & Mondin, F. (2023). Visual Art, a Pedagogical Tool of Plural Knowledge. Interculturalidad, Inclusión y Equidad En Educación, 341–349. https://doi.org/10.14201/0aq0321341349
  Actual: Deluigi, R., Cuccu, M., & Mondin, F. (2023). Visual Art, a Pedagogical Tool of Plural Knowledge. In Interculturalidad (pp. 341-349). In Interculturalidad, inclusión y equidad en educación (pp. 341-349). Ediciones Universidad de Salamanca. https://doi.org/10.14201/0aq0321341349.
- thesis-0025-10-11606-d-6-1967-tde-20251106-162329 [batch 50, repeat 1] mismatches: title, venue; render similarity: 84.00%; winner: parser:selected_style:apa; mode: full_scoring
  Expected: Usarralde de Adlerstein, M. N. (2025). Repercusiones orales de la diabetes sacarina [Doctoral dissertation, Universidade de São Paulo. Agência de Bibliotecas e Coleções Digitais]. https://doi.org/10.11606/d.6.1967.tde-20251106-162329
  Actual: Usarralde de Adlerstein, M. N. (2025). Repercusiones orales de la diabetes sacarina [Doctoral dissertation, Universidade de São Paulo. In Agência de Bibliotecas e Coleções Digitais]. Agência de Bibliotecas e Coleções Digitais].
- report-0007-10-54067-acpf-154-fr [batch 50, repeat 1] mismatches: referenceType; render similarity: 84.00%; winner: parser:auto:harvard; mode: single_survivor
  Expected: Ndoye, A., Dia, M., & Dia, K. (2024). AAgWa Crop Production Forecasts Briefs No. 154. AKADEMIYA2063. https://doi.org/10.54067/acpf.154/fr
  Actual: Ndoye, A., ïssatou, D., & Dia, K. (2024). AAgWa Crop Production Forecasts Briefs No. 154. AKADEMIYA2063.
- journal-0118-10-1111-j-1745-6924-2009-01084-x [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 85.00%; winner: heuristic:harvard_sentence_journal; mode: single_survivor
  Expected: Ceci, S. J., & Bruck, M. (2009). Do IRBs Pass the Minimal Harm Test? Perspectives on Psychological Science, 4(1), 28–29. https://doi.org/10.1111/j.1745-6924.2009.01084.x
  Actual: Ceci, S., & Bruck, M. (2009). Do IRBs Pass the Minimal Harm Test? Perspectives on Psychological Science, 4(1), 28-29.
- journal-0588-10-12685-bul-7-1998-654 [batch 50, repeat 1] mismatches: issue; render similarity: 86.00%; winner: heuristic:ieee_quoted_reference; mode: unanimous_diversity_guard
  Expected: Burkhahlter, S. (1998). Entretien: L’ethnothérapie - une expérience de métissage culturel. SGMOIK-Bulletin, 7, 12–14. https://doi.org/10.12685/bul.7.1998.654
  Actual: Burkhahlter, & Sarah. (1998). Entretien: L'ethnothérapie -une expérience de métissage culturel. SGMOIK-Bulletin, /, 7(7 (): 12-14. https://doi.org), 12-14.
- journal-0171-10-47191-jefms-v5-i9-30 [batch 50, repeat 1] mismatches: title, firstAuthor, venue, volume, issue; render similarity: 87.00%; winner: parser:selected_style:vancouver; mode: single_survivor
  Expected: Department of Economics, Faculty of Social Sciences, Niger Delta University, Wilberforce Island, P.M.B. 071, Yenagoa, Bayelsa State, Nigeria. (2022). Naira to Dollar Exchange Rate Fluctuations and Nigeria’s Balance of Payment. JOURNAL OF ECONOMICS, FINANCE AND MANAGEMENT STUDIES, 5(9). https://doi.org/10.47191/jefms/v5-i9-30
  Actual: Department of Economics, Sciences, F. O. S., Niger Delta University, & Island, W. P. M. B. (2022). 071, Yenagoa, Bayelsa State, Nigeria. Naira to Dollar Exchange Rate Fluctuations and Nigeria's Balance of Payment. JOURNAL OF ECONOMICS, FINANCE AND MANAGEMENT STUDIES. 2022;5(9).
- conference-0022-10-2991-assehr-k-220704-137 [batch 50, repeat 1] mismatches: referenceType; render similarity: 88.00%; winner: parser:selected_style:harvard; mode: unanimous_diversity_guard
  Expected: Wang, R. (2022). People’s Cognition of the Influence of Violence in Video Games. Advances in Social Science, Education and Humanities Research. https://doi.org/10.2991/assehr.k.220704.137
  Actual: Wang, R. (2022). People's Cognition of the Influence of Violence in Video Games. In Advances in Social Science, Education and Humanities Research. Atlantis Press.
- journal-0025-10-1134-s0036023619070088 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 89.00%; winner: heuristic:apa_journal; mode: single_survivor
  Expected: Folomeikin, Yu. I., Karachevtsev, F. N., & Stolyarova, V. L. (2019). Production of Ceramics Based on the Y2O3–ZrO2–HfO2 System for Casting Molds. Russian Journal of Inorganic Chemistry, 64(7), 934–940. https://doi.org/10.1134/s0036023619070088
  Actual: Karachevtsev, F. N., & Stolyarova, V. L. (2019). Production of Ceramics Based on the Y2O3-ZrO2-HfO2 System for Casting Molds. Russian Journal of Inorganic Chemistry, 64(7), 934-940.
- report-0001-10-55277-researchhub-uc1gvo5u [batch 50, repeat 1] mismatches: referenceType; render similarity: 89.00%; winner: heuristic:author_year_publisher_tail; mode: full_scoring
  Expected: Hart, S. (2026). [Free Download] Digital-Forensics-in-Cybersecurity Exam Dumps (March 2026) PDF Practice. ResearchHub Technologies, Inc. https://doi.org/10.55277/researchhub.uc1gvo5u
  Actual: Hart, S. (2026). Free Download] Digital-Forensics-in-Cybersecurity Exam Dumps (March 2026) PDF Practice. ResearchHub Technologies, Inc.
- journal-0230-10-3390-healthcare12090874 [batch 50, repeat 1] mismatches: venue; render similarity: 89.00%; winner: parser:selected_style:mla; mode: single_survivor
  Expected: Gobbens, R. J. J., & van der Ploeg, T. (2024). The Prediction of Quality of Life by Frailty and Disability among Dutch Community-Dwelling People Aged 75 Years or Older. Healthcare, 12(9), 874. https://doi.org/10.3390/healthcare12090874
  Actual: Gobbens, R. J. J., & Ploeg, T. V. D. (2024). The Prediction of Quality of Life by Frailty and Disability among Dutch Community-Dwelling People Aged 75 Years or Older. Healthcare, Vol, 12(9), 874.
- chapter-0114-10-1007-978-3-030-81776-3-11 [batch 50, repeat 1] mismatches: referenceType, venue, pages; render similarity: 89.00%; winner: heuristic:vancouver_publisher_year_source; mode: single_survivor
  Expected: von Rüden, C., Bühren, V., & Perl, M. (2021). Nail Osteosynthesis of Proximal Tibia Fractures. In Strategies in Fracture Treatments (pp. 97–104). Springer International Publishing. https://doi.org/10.1007/978-3-030-81776-3_11
  Actual: von Rüden, C., Bühren, V., & Perl, M. (2021). Nail Osteosynthesis of Proximal Tibia Fractures. In: Strategies in Fracture Treatments. Springer International Publishing.

