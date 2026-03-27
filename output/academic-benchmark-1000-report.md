# Academic Benchmark Report

Generated: 2026-03-27T16:21:00.742Z
Frozen corpus: 2026-03-27T12:11:27.113Z
Corpus size: 1000 real citations
Machine-readable report: D:\Coding\Citing\output\academic-benchmark-1000-report.json

## Executive summary

This internal benchmark evaluates 1000 real-world academic references across journals, conferences, books, chapters, reports, and theses. It runs the deterministic v2 engine in 50, 100, and 200 citation batches to mirror institutional use while separating strict external readiness from a legacy internal-compatibility score.

## External Readiness Score (Primary)

- Strict essential accuracy: 64.60%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 99.10%
- Identity contamination count: 3
- Consistency: 100.00%
- Average APA render similarity: 88.12%

## Internal Compatibility Reference (Secondary)

- Legacy-comparable field average: 89.07%
- Methodology version: 1.0
- Frozen at: 2026-03-27

Footnote: The primary score uses strict citation-level pass/fail on core fields plus identity and output integrity. The secondary score is a frozen internal field-average reference for historical comparison only and must not be cited as the external readiness number.

## Methodology

- The corpus contains 1,000 real citations drawn from Crossref and frozen locally on the generation date shown above.
- All benchmark runs use the deterministic v2 pipeline with enrichment, LLM extraction, and GROBID disabled for repeatability.
- The primary score is strict citation-level external readiness: referenceType, year, title, firstAuthor, venue, non-empty output, and identity integrity must all pass.
- The secondary score is a frozen legacy-comparable field average over title, firstAuthor, year, venue, volume, issue, pages, and doi when expected.
- Identity contamination uses normalized Levenshtein ratio after normalization and is reported separately from count integrity and empty-output failures.

## Batch results

### Batch size 50

- Strict essential accuracy: 64.60%
- Legacy field average: 89.07%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 99.10%
- Identity contamination count: 1
- Consistency: 100.00%
- Mean batch time: 941.80 ms
- Median batch time: 912.25 ms
- P95 batch time: 1209.29 ms
- Mean ms per citation: 18.84 ms
- Throughput: 17.70 citations/sec

### Batch size 100

- Strict essential accuracy: 64.60%
- Legacy field average: 89.07%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 99.10%
- Identity contamination count: 1
- Consistency: 100.00%
- Mean batch time: 1883.09 ms
- Median batch time: 1849.09 ms
- P95 batch time: 2281.12 ms
- Mean ms per citation: 18.83 ms
- Throughput: 17.70 citations/sec

### Batch size 200

- Strict essential accuracy: 64.60%
- Legacy field average: 89.07%
- Count integrity: 99.20%
- Non-empty output rate: 99.20%
- Identity integrity: 99.10%
- Identity contamination count: 1
- Consistency: 100.00%
- Mean batch time: 3896.67 ms
- Median batch time: 3893.44 ms
- P95 batch time: 4290.35 ms
- Mean ms per citation: 19.48 ms
- Throughput: 17.11 citations/sec

## IEEE failure breakdown

- author_order: 156
- venue_abbreviation: 39
- locator_misclassified: 12
- doi_parse: 0
- reference_type: 66
- identity_contamination: 0
- empty_output: 6

## Strengths

- The benchmark uses a frozen 1,000-reference real-world corpus, making reruns auditable and institution-friendly.
- Strict external readiness, internal legacy compatibility, and batch performance are separated instead of being collapsed into one misleading score.
- journal records performed best on the strict score at 73.82%.
- The fastest operating point was the 50-citation batch at 17.70 citations/sec.

## Weaknesses

- chapter is the weakest strict source type and should stay in the next remediation wave.
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

- journal-0033-10-1002-chin-200104012 [batch 50, repeat 1] mismatches: referenceType, year, title, firstAuthor, venue, volume, issue, pages, doi, output; render similarity: 0.00%
  Expected: Brooker, M. H., Berg, R. W., von Barner, J. H., & Bjerrum, N. J. (2001). ChemInform Abstract: Matrix‐Isolated Al 2 OF 6 2‐ Ion in Molten and Solid LiF/NaF/KF. ChemInform, 32(4), chin.200104012. https://doi.org/10.1002/chin.200104012
  Actual: 
- journal-0416-10-1061-asce-0733-9429-1986-112-11-1110 [batch 50, repeat 1] mismatches: title, firstAuthor, venue, volume, issue; render similarity: 75.00%
  Expected: Roberts, P. J. W., & Matthews, P. R. (1986). Closure to “ Dynamics of Jets in Two‐Layer Stratified Fluids ” by Philip J. W. Roberts and P. Reid Matthews (September, 1984, Vol. 110, No. 4). Journal of Hydraulic Engineering, 112(11), 1110–1113. https://doi.org/10.1061/(asce)0733-9429(1986)112:11(1110)
  Actual: Reid Matthews, P. (1986). Closure to. Dynamics of Jets in Two‐Layer Stratified Fluids " by Philip J. W. Roberts and P. Reid Matthews (September, 1984, 110(4), 1110-1113.
- conference-0126-10-1055-s-0040-1704732 [batch 50, repeat 1] mismatches: referenceType, venue; render similarity: 79.00%
  Expected: Correia, C., Almeida, N., Portela, F., Gomes, D., Fernandes, A., Rosa, A., & Figueiredo, P. (2020). ENDOSCOPIC DRAINAGE OF PANCREATIC AND PERI-PANCREATIC COLLECTIONS: A RETROSPECTIVE ANALYSIS. Endoscopy. https://doi.org/10.1055/s-0040-1704732
  Actual: Correia, C., N Almeida, F. P., D Gomes, A. F., & A Rosa, P. F. (2020). ENDOSCOPIC DRAINAGE OF PANCREATIC AND PERI-PANCREATIC Collections: ARETROSPECTIVE Analysis." in Endoscopy. © Georg Thieme Verlag KG.
- journal-0398-10-18690-pomurska-obzorja-1-1-29-34-2014 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 80.00%
  Expected: Erjavec Škerget, A. (2022). Poroke med krvnimi sorodniki: genetske in / ali pravne ovire. Pomurska Obzorja, 1(1), 29–34. https://doi.org/10.18690/pomurska-obzorja.1.1.29-34.2014
  Actual: Škerget, A. E. (2022). Poroke med krvnimi sorodniki: genetske in / ali pravne ovire. Pomurska Obzorja, Vol, 1(1), 29-34.
- journal-0397-10-1126-scisignal-2004004 [batch 50, repeat 1] mismatches: referenceType, volume, issue; render similarity: 80.00%
  Expected: Foley, J. F. (2013). IKK Goes BAD. Science Signaling, 6(260). https://doi.org/10.1126/scisignal.2004004
  Actual: Foley, J. F. (2013). IKK Goes BAD. Science Signaling, 6(260).
- chapter-0051-10-5040-9780755620272-ch-005 [batch 50, repeat 1] mismatches: referenceType, title, venue; render similarity: 80.00%
  Expected: Claffey, P. (2007). KéRéKou the Chameleon, Master of Myth. In Staging Politics. I.B.Tauris. https://doi.org/10.5040/9780755620272.ch-005
  Actual: Claffey. (2007). Patrick. "KéRéKou the Chameleon, Master of Myth." In Staging Politics. I.B.Tauris.
- journal-0482-10-15765-librosic-v1i1-12 [batch 50, repeat 1] mismatches: firstAuthor, venue; render similarity: 82.00%
  Expected: Morales Ospina, A. (2022). Nomofobia y el nivel productividad de las organizaciones. Libros IC, 107–122. https://doi.org/10.15765/librosic.v1i1.12
  Actual: Alberto Morales Ospina. (2022). Nomofobia yel nivel productividad de las organizaciones. Libros IC, Vol. Pp, 107-122.
- report-0025-10-2172-87065 [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 82.00%
  Expected: Nuclear Regulatory Commission, Washington, DC (United States). Div. of Reactor Controls and Human Factors. (1995). Non-Power Reactor Operator Licensing Examiner Standards. Revision 1. Office of Scientific and Technical Information (OSTI). https://doi.org/10.2172/87065
  Actual: Nuclear Regulatory Commission, & Factors, H. (1995). Non-Power Reactor Operator Licensing Examiner Standards. Revision 1. Office of Scientific and Technical Information (OSTI).
- book-0025-10-1007-978-90-6704-489-9 [batch 50, repeat 1] mismatches: title, venue; render similarity: 82.00%
  Expected: Ribbelink, O. (2008). Beyond the UN Charter: Peace, Security and the Role of Justice. In From Peace to Justice Series. Hague Academic Press, an imprint of T.M.C. Asser Press. https://doi.org/10.1007/978-90-6704-489-9
  Actual: Ribbelink, O. (2008). Beyond the UN Charter: Peace, Security and the Role of Justice. Hague Academic Press, an imprint of T.M.C. Asser Press.
- chapter-0085-10-1007-978-3-030-67127-3-15 [batch 50, repeat 1] mismatches: venue; render similarity: 82.00%
  Expected: Yu, K., & Perez, M. (2021). Racial and Ethnic Considerations in the United States. In Eating Disorders in Boys and Men (pp. 217–228). Springer International Publishing. https://doi.org/10.1007/978-3-030-67127-3_15
  Actual: Yu, K., & Perez, M. (2021). Racial and Ethnic Considerations in the United States. In Boys and Men (pp. 217-228). https://doi.org/10.1007/978-3-030-67127-3_15.
- journal-0118-10-1111-j-1745-6924-2009-01084-x [batch 50, repeat 1] mismatches: firstAuthor; render similarity: 85.00%
  Expected: Ceci, S. J., & Bruck, M. (2009). Do IRBs Pass the Minimal Harm Test? Perspectives on Psychological Science, 4(1), 28–29. https://doi.org/10.1111/j.1745-6924.2009.01084.x
  Actual: Ceci, S., & Bruck, M. (2009). Do IRBs Pass the Minimal Harm Test? Perspectives on Psychological Science, 4(1), 28-29.
- chapter-0009-10-30525-978-9934-26-226-5-11 [batch 50, repeat 1] mismatches: referenceType, title, venue, pages; render similarity: 86.00%
  Expected: Iliuk, I. A., Baranova, I. V., & Postovitenko, K. P. (2022). Post-infectiou cough hypersensitivity syndrom: modern problem solving. In NEW TRENDS AND UNSOLVED ISSUES IN MEDICINE (pp. 44–48). Izdevnieciba “Baltija Publishing.” https://doi.org/10.30525/978-9934-26-226-5-11
  Actual: Iliuk, I. (2022). A., I. V. Baranova, and K. P. Postovitenko. "Post-infectiou cough hypersensitivity syndrom: modern problem solving." In NEW TRENDS AND UNSOLVED ISSUES IN MEDICINE, 44-48. Izdevnieciba "Baltija Publishing.".
- journal-0407-10-1371-journal-pone-0269394 [batch 50, repeat 1] mismatches: firstAuthor, venue, pages; render similarity: 87.00%
  Expected: R., R., Uthaiah, C. A., C. M., R., Madhunapantula, S. V., Salimath, P. V., K., P., M., S. K., & M. R., K. (2022). Comparative assessment of cognitive impairment and oxidative stress markers among vitamin D insufficient elderly patients with and without type 2 diabetes mellitus (T2DM). PLOS ONE, 17(6), e0269394. https://doi.org/10.1371/journal.pone.0269394
  Actual: Rajalakshmi, Uthaiah, C. A., Ramya C., M., Madhunapantula, S. V., Salimath, P. V., Praveen, K., M., S. K., & Kishor M., R. (2022). Comparative assessment of cognitive impairment and oxidative stress markers among vitamin D insufficient elderly patients with and without type 2 diabetes mellitus (T2DM. PLoS ONE, Vol, 17(6), 10.
- conference-0056-10-1109-lfnm-2003-1246078 [batch 50, repeat 1] mismatches: referenceType, year, title, firstAuthor, venue, pages; render similarity: 87.00%
  Expected: Starikov, F. A., Dolgopolov, Yu. V., Dudov, A. M., Gerasimenko, N. N., Kirillov, G. A., Kochemasov, G. G., Kulikov, S. M., Ladagin, V. K., Pevny, S. N., Shkapa, A. F., Smyshlyaev, S. P., Sukharev, S. A., & Zykov, L. I. (2004). Investigation of explosively pumped photo-dissociation iodine laser with phase conjugation of super-high quality. 5th International Workshop on Laser and Fiber-Optical Networks Modeling, 2003. Proceedings of LFNM 2003., 75–75. https://doi.org/10.1109/lfnm.2003.1246078
  Actual: F. A., F. A. (2003). Starikov, Yu.V. Dolgopolov, A.M. Dudov, N.N. Gerasimenko, G.A. Kirillov, G.G. Kochemasov, S.M. Kulikov, V.K. Ladagin, S.N. Pevny, A.F. Shkapa, S.P. Smyshlyaev, S.A. Sukharev, and L.I. Zykov, "Investigation of explosively pumped photo-dissociation iodine laser with phase conjugation of super-high quality," in 5th International Workshop on Laser and Fiber-Optical Networks Modeling, 2003. Proceedings of LFNM 2003. pp. 75-75, 2004. doi. F.A.
- journal-0540-10-15835-buasvmcn-asb-11648 [batch 50, repeat 1] mismatches: referenceType, volume; render similarity: 88.00%
  Expected: Criste, A., Henţ, T., Giuburuncă, M., Zăhan, M., Niste, M., Fiţ, N., & Mitrea, M. (2016). Characterization of Microorganisms Isolated from Petroleum Hydrocarbon Polluted Soil. Bulletin of University of Agricultural Sciences and Veterinary Medicine Cluj-Napoca. Animal Science and Biotechnologies, 73(1). https://doi.org/10.15835/buasvmcn-asb:11648
  Actual: Criste, A., Tabita Henţ, M. G., Marius Zăhan, M. N., & Nicodim Fiţ, M. M. (2016). Characterization of Microorganisms Isolated from Petroleum Hydrocarbon Polluted Soil. Bulletin of University of Agricultural Sciences and Veterinary Medicine Cluj-Napoca. Animal Science and Biotechnologies 73, 1.

