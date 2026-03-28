# Academic Benchmark Report

Generated: 2026-03-28T05:13:02.706Z
Frozen corpus: 2026-03-27T12:11:27.113Z
Corpus size: 1000 real citations
IEEE slice: 159 citations per corpus run
Machine-readable report: D:\Coding\Citing\output\academic-benchmark-1000-report.json

## Executive summary

This internal benchmark evaluates 1000 real-world academic references across journals, conferences, books, chapters, reports, and theses. It runs the deterministic v2 engine in 50, 100, and 200 citation batches to mirror institutional use while separating strict external readiness from a legacy internal-compatibility score.

## External Readiness Score (Primary)

- Strict essential accuracy: 65.00%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 98.90%
- Identity contamination count: 9
- Consistency: 100.00%
- Average APA render similarity: 88.33%
- LLM fallback attempt rate: 0.00%

## Internal Compatibility Reference (Secondary)

- Legacy-comparable field average: 88.31%
- Methodology version: 1.0
- Frozen at: 2026-03-27

Footnote: The primary score uses strict citation-level pass/fail on core fields plus identity and output integrity. The secondary score is a frozen internal field-average reference for historical comparison only and must not be cited as the external readiness number.

## Action Needed Reasons

- Overall multi_field_low_confidence: 126
- Overall malformed_authors: 63
- Overall weak_venue: 63
- Overall weak_first_author: 54
- Overall weak_reference_type: 51
- Overall missing_authors: 27
- Overall empty_output: 24
- Overall identity_contamination: 9

- IEEE multi_field_low_confidence: 42
- IEEE malformed_authors: 24
- IEEE weak_first_author: 24
- IEEE weak_reference_type: 21
- IEEE weak_venue: 21
- IEEE empty_output: 6
- IEEE missing_authors: 6
- IEEE identity_contamination: 0

- Near-pass multi_field_low_confidence: 60
- Near-pass malformed_authors: 45
- Near-pass weak_first_author: 27
- Near-pass weak_venue: 27
- Near-pass weak_reference_type: 15
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

- Strict essential accuracy: 65.00%
- Legacy field average: 88.31%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 98.90%
- Identity contamination count: 3
- Consistency: 100.00%
- Mean batch time: 1763.95 ms
- Median batch time: 1510.42 ms
- P95 batch time: 2557.49 ms
- Mean ms per citation: 35.28 ms
- Throughput: 9.45 citations/sec

### Batch size 100

- Strict essential accuracy: 65.00%
- Legacy field average: 88.31%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 98.90%
- Identity contamination count: 3
- Consistency: 100.00%
- Mean batch time: 3650.66 ms
- Median batch time: 3797.78 ms
- P95 batch time: 4476.63 ms
- Mean ms per citation: 36.51 ms
- Throughput: 9.13 citations/sec

### Batch size 200

- Strict essential accuracy: 65.00%
- Legacy field average: 88.31%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 98.90%
- Identity contamination count: 3
- Consistency: 100.00%
- Mean batch time: 7440.05 ms
- Median batch time: 7476.85 ms
- P95 batch time: 8569.76 ms
- Mean ms per citation: 37.20 ms
- Throughput: 8.96 citations/sec

## IEEE failure breakdown

- author_order: 99
- venue_abbreviation: 9
- locator_misclassified: 3
- doi_parse: 0
- reference_type: 78
- identity_contamination: 0
- empty_output: 6

## Selector diagnostics

- selection mode full_scoring: 978
- selection mode single_survivor: 1044
- selection mode unanimous_diversity_guard: 954
- top winner adapter heuristic:ieee_quoted_reference: 603
- top winner adapter parser:selected_style:apa: 252
- top winner adapter heuristic:author_year_publisher_tail: 222
- top winner adapter heuristic:quoted_title_journal_locator: 222
- top winner adapter heuristic:vancouver_compact_journal: 201

## Type confusion matrix

- journal -> journal: 1488
- conference -> conference: 336
- book -> book: 258
- chapter -> chapter: 171
- journal -> book: 114
- report -> report: 102
- thesis -> thesis: 96
- chapter -> book: 60
- chapter -> conference: 42
- conference -> chapter: 42

## Strengths

- The benchmark uses a frozen 1,000-reference real-world corpus, making reruns auditable and institution-friendly.
- Strict external readiness, internal legacy compatibility, and batch performance are separated instead of being collapsed into one misleading score.
- book records performed best on the strict score at 74.00%.
- The fastest operating point was the 50-citation batch at 9.45 citations/sec.

## Weaknesses

- chapter is the weakest strict source type and should stay in the next remediation wave.
- HARVARD is the lowest-performing input style on the strict score.
- pages is the lowest-accuracy field and remains the clearest parser-recovery target.
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
- journal-0267-10-14744-dajpns-2025-00305 [batch 50, repeat 1] mismatches: title, firstAuthor, pages; render similarity: 53.00%; winner: legacy:year_anchored_fallback; mode: single_survivor
  Expected: Kurt, B. (2025). Drug-induced stuttering associated with venlafaxineolanzapine combination: A rare pharmacodynamic interaction. Dusunen Adam: Journal of Psychiatry and Neurological Sciences, 277–278. https://doi.org/10.14744/dajpns.2025.00305
  Actual: Psychiatry, K. B. D. I. S. A. W. V. C. A. R. P. I. D. A. J. O., & Sciences, N. (2025). 277-278. doi. Dusunen Adam: Journal of Psychiatry, Neurological Sciences. 2025;277-278.
- journal-0407-10-1371-journal-pone-0269394 [batch 50, repeat 1] mismatches: title, pages; render similarity: 64.00%; winner: legacy:year_anchored_fallback; mode: single_survivor
  Expected: R., R., Uthaiah, C. A., C. M., R., Madhunapantula, S. V., Salimath, P. V., K., P., M., S. K., & M. R., K. (2022). Comparative assessment of cognitive impairment and oxidative stress markers among vitamin D insufficient elderly patients with and without type 2 diabetes mellitus (T2DM). PLOS ONE, 17(6), e0269394. https://doi.org/10.1371/journal.pone.0269394
  Actual: R., R., Rajalakshmi, C. A. U., M., R. C., Madhunapantula, S. V., Salimath, P. V., K., P., Srinath K., M., impairment, A. K. M. R. ". A. O. C., with, O. S. M. A. V. D. I. E. P., without type 2 diabetes mellitus (T2DM)." PLoS, O. N. E., 17, V., & 6, N. (2022). pp. e0269394. doi. PLoS ONE, 17(6), 10.
- journal-0150-10-1111-j-1467-8705-1974-tb01519-x [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 75.00%; winner: heuristic:quoted_title_journal_locator; mode: unanimous_diversity_guard
  Expected: EVERETT, B. (1974). A Visit to Burnt Norton. Critical Quarterly, 16(3), 199–224. https://doi.org/10.1111/j.1467-8705.1974.tb01519.x
  Actual: BARBARA. EVERETT. (1974). A Visit to Burnt Norton. Critical Quarterly, 16(3), 199-224.
- conference-0126-10-1055-s-0040-1704732 [batch 50, repeat 1] mismatches: referenceType, venue; render similarity: 79.00%; winner: heuristic:book_tail; mode: single_survivor
  Expected: Correia, C., Almeida, N., Portela, F., Gomes, D., Fernandes, A., Rosa, A., & Figueiredo, P. (2020). ENDOSCOPIC DRAINAGE OF PANCREATIC AND PERI-PANCREATIC COLLECTIONS: A RETROSPECTIVE ANALYSIS. Endoscopy. https://doi.org/10.1055/s-0040-1704732
  Actual: Correia, C., N Almeida, F. P., D Gomes, A. F., & A Rosa, P. F. (2020). ENDOSCOPIC DRAINAGE OF PANCREATIC AND PERI-PANCREATIC Collections: ARETROSPECTIVE Analysis." in Endoscopy. Georg Thieme Verlag KG.
- thesis-0027-10-12681-eadd-60873 [batch 50, repeat 1] mismatches: referenceType, venue; render similarity: 79.00%; winner: parser:selected_style:vancouver; mode: unanimous_diversity_guard
  Expected: Φέρρα, Γ. (2026). Police interviews with children in Greece [Doctoral dissertation, National Documentation Centre (EKT)]. https://doi.org/10.12681/eadd/60873
  Actual: Φέρρα, & Γκόλφω. (2026). Police interviews with children in Greece. National Documentation Centre (EKT), 2026. Dissertation.
- journal-0397-10-1126-scisignal-2004004 [batch 50, repeat 1] mismatches: referenceType, volume, issue; render similarity: 80.00%; winner: heuristic:author_year_publisher_tail; mode: full_scoring
  Expected: Foley, J. F. (2013). IKK Goes BAD. Science Signaling, 6(260). https://doi.org/10.1126/scisignal.2004004
  Actual: Foley, J. F. (2013). IKK Goes BAD. Science Signaling, 6(260).
- conference-0149-10-26678-abcm-cobem2023-cob2023-0316 [batch 50, repeat 1] mismatches: title, venue; render similarity: 81.00%; winner: parser:selected_style:vancouver; mode: full_scoring
  Expected: Paschoalinoto, N. W., Ferrer, J., Bordinassi, E. C., Seriacopi, V., de Farias, A., Otavio dos Santos, M., & Batalha, G. (2025). DEVELOPING A MQL VALVE FOR Ti-6Al-4V ALLOY MILLING WITH DIFFERENT CUTTING OIL AND GRAPHITE MIXING RATIO. Proceedings of the 27th International Congress of Mechanical Engineering. https://doi.org/10.26678/abcm.cobem2023.cob2023-0316
  Actual: Paschoalinoto, N. W., Jorge Ferrer, E. C. B., Vanessa Seriacopi, A. D. F., & Marcelo Otavio dos Santos, G. B. (2025). DEVELOPING AMQL VALVE FOR Ti-6Al-4V ALLOY MILLING WITH DIFFERENT CUTTING OIL AND GRAPHITE MIXING RATIO." Proceedings of the 27th International Congress of Mechanical Engineering, 2025. In Proceedings of the 27th International Congress of Mechanical Engineering, ABCM. https://doi.org/10.26678/abcm.cobem2023.cob2023-0316.
- report-0025-10-2172-87065 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 82.00%; winner: heuristic:author_year_publisher_tail; mode: full_scoring
  Expected: Nuclear Regulatory Commission, Washington, DC (United States). Div. of Reactor Controls and Human Factors. (1995). Non-Power Reactor Operator Licensing Examiner Standards. Revision 1. Office of Scientific and Technical Information (OSTI). https://doi.org/10.2172/87065
  Actual: Nuclear Regulatory Commission, & Factors, H. (1995). Non-Power Reactor Operator Licensing Examiner Standards. Revision 1. Office of Scientific and Technical Information (OSTI).
- thesis-0011-10-4995-thesis-10251-110969 [batch 50, repeat 1] mismatches: referenceType, firstAuthor, venue; render similarity: 82.00%; winner: parser:selected_style:vancouver; mode: unanimous_diversity_guard
  Expected: Cortés López, V. (2018). Innovations in non-destructive techniques for fruit quality control applied to manipulation and inspection lines [Doctoral dissertation, Universitat Politecnica de Valencia]. https://doi.org/10.4995/thesis/10251/110969
  Actual: López, C., & Victoria. (2018). Innovations in non-destructive techniques for fruit quality control applied to manipulation and inspection lines. Universitat Politecnica de Valencia, 2018. Dissertation.
- journal-0118-10-1111-j-1745-6924-2009-01084-x [batch 50, repeat 1] mismatches: referenceType, title, firstAuthor, venue, volume, issue, pages; render similarity: 84.00%; winner: heuristic:author_year_publisher_tail; mode: single_survivor
  Expected: Ceci, S. J., & Bruck, M. (2009). Do IRBs Pass the Minimal Harm Test? Perspectives on Psychological Science, 4(1), 28–29. https://doi.org/10.1111/j.1745-6924.2009.01084.x
  Actual: Ceci, S., & Bruck, M. (2009). Do IRBs Pass the Minimal Harm Test?. Perspectives on Psychological Science, 4(1), pp. 28-29.
- thesis-0025-10-11606-d-6-1967-tde-20251106-162329 [batch 50, repeat 1] mismatches: title, venue; render similarity: 84.00%; winner: parser:selected_style:apa; mode: full_scoring
  Expected: Usarralde de Adlerstein, M. N. (2025). Repercusiones orales de la diabetes sacarina [Doctoral dissertation, Universidade de São Paulo. Agência de Bibliotecas e Coleções Digitais]. https://doi.org/10.11606/d.6.1967.tde-20251106-162329
  Actual: Usarralde de Adlerstein, M. N. (2025). Repercusiones orales de la diabetes sacarina [Doctoral dissertation, Universidade de São Paulo. In Agência de Bibliotecas e Coleções Digitais]. Agência de Bibliotecas e Coleções Digitais].
- chapter-0009-10-30525-978-9934-26-226-5-11 [batch 50, repeat 1] mismatches: referenceType, title, venue, pages; render similarity: 86.00%; winner: heuristic:book_tail; mode: single_survivor
  Expected: Iliuk, I. A., Baranova, I. V., & Postovitenko, K. P. (2022). Post-infectiou cough hypersensitivity syndrom: modern problem solving. In NEW TRENDS AND UNSOLVED ISSUES IN MEDICINE (pp. 44–48). Izdevnieciba “Baltija Publishing.” https://doi.org/10.30525/978-9934-26-226-5-11
  Actual: Iliuk, I. (2022). A., I. V. Baranova, and K. P. Postovitenko. "Post-infectiou cough hypersensitivity syndrom: modern problem solving." In NEW TRENDS AND UNSOLVED ISSUES IN MEDICINE, 44-48. Izdevnieciba "Baltija Publishing.".
- journal-0124-10-1093-cvr-22-10-686 [batch 50, repeat 1] mismatches: referenceType, title, venue, volume, issue, pages; render similarity: 86.00%; winner: heuristic:author_year_publisher_tail; mode: full_scoring
  Expected: DOERING, C. W., JALIL, J. E., JANICKI, J. S., PICK, R., AGHILI, S., ABRAHAMS, C., & WEBER, K. T. (1988). Collagen network remodelling and diastolic stiffness of the rat left ventricle with pressure overload hypertrophy. Cardiovascular Research, 22(10), 686–695. https://doi.org/10.1093/cvr/22.10.686
  Actual: DOERING, J. E., PICK, ABRAHAMS S,WEBER C, K. T. (1988). Collagen network remodelling and diastolic stiffness of the rat left ventricle with pressure overload hypertrophy. Cardiovascular Research, 22(10), pp. 686-695.
- journal-0002-10-53730-ijhs-v6ns1-8707 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 87.00%; winner: heuristic:ieee_quoted_reference; mode: single_survivor
  Expected: Djumabaevich, T. S., Karimovich, K. Z., Beknazarovich, X. Z., Sagdullaevich, A. N., & Tirkashevich, M. S. (2022). role and significance of physical culture and sport in the sphere of education. International Journal of Health Sciences, 14419–14427. https://doi.org/10.53730/ijhs.v6ns1.8707
  Actual: Sharof Djumabaevich, T., Zokir Karimovich, K., Zafar Beknazarovich, X., Nuriddin Sagdullaevich, A., & Saidmurod Tirkashevich, M. (2022). role and significance of physical culture and sport in the sphere of education. International Journal of Health Sciences, 14419-14427.

