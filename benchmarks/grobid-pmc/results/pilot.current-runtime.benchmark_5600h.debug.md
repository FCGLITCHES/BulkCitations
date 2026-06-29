# Grobid-Style Benchmark Debug

- Mode: pilot
- Profile: current-runtime
- Parse Profile: core_parse_fast
- Source Type: text
- Hardware Profile: benchmark_5600h
- Benchmark Variant: grobid_compare
- Semantic Output Hash: sha256:02de05b2a2e0c6780e7f503527b0647b5eea61abf46f9a6faafac18962424cf5

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
| title | 1362 | 1361 | 0.9993 | false | false |
| url | 1362 | 1358 | 0.9971 | false | false |
| year | 1362 | 1352 | 0.9927 | false | false |
| journal/venue | 1206 | 1202 | 0.9967 | false | false |
| doi | 1050 | 1019 | 0.9705 | false | false |
| authors | 900 | 900 | 1 | false | false |
| firstAuthor | 900 | 900 | 1 | false | false |
| publisher | 438 | 436 | 0.9954 | false | false |
| institution | 330 | 324 | 0.9818 | false | false |
| isbn | 294 | 283 | 0.9626 | false | false |
| pages | 288 | 287 | 0.9965 | false | false |
| issn | 162 | 155 | 0.9568 | false | false |
| issue | 162 | 156 | 0.963 | false | false |
| volume | 162 | 156 | 0.963 | false | false |
| patent | 156 | 156 | 1 | false | false |
| siteName | 156 | 153 | 0.9808 | false | false |
| bookTitle | 144 | 144 | 1 | false | false |
| thesisType | 144 | 142 | 0.9861 | false | false |
| conferenceTitle | 138 | 138 | 1 | false | false |
| repository | 138 | 136 | 0.9855 | false | false |

## Contract Samples

| Variant | Required Fields | Expected Keys | Predicted Keys | Missing Required |
| --- | --- | --- | --- | --- |
| article-journal-137b6aa48ebe1478:chicago-notes-bib:noisy | authors, title, journal/venue, volume, issue, pages | authors, doi, firstAuthor, issn, issue, journal/venue, pages, title, url, volume, year | authors, firstAuthor, issue, journal/venue, pages, title, url | volume |
| article-journal-1662e676706eb0ff:apa7:clean | title, year, doi, url, journal/venue, volume, issue, pages | authors, doi, firstAuthor, issn, issue, journal/venue, pages, title, url, volume, year | authors, conferenceTitle, doi, firstAuthor, journal/venue, pages, publisher, title, url, year | volume, issue |
| article-journal-1662e676706eb0ff:chicago-notes-bib:clean | authors, title, year, doi, url, journal/venue, volume, issue, pages | authors, doi, firstAuthor, issn, issue, journal/venue, pages, title, url, volume, year | authors, conferenceTitle, doi, firstAuthor, journal/venue, pages, publisher, title, url, year | volume, issue |
| article-journal-1662e676706eb0ff:vancouver:clean | title, year, doi, url, journal/venue, volume, issue, pages | authors, doi, firstAuthor, issn, issue, journal/venue, pages, title, url, volume, year | authors, conferenceTitle, doi, firstAuthor, journal/venue, pages, publisher, title, url, year | volume, issue |
| article-journal-1662e676706eb0ff:ieee:clean | title, year, doi, url, journal/venue, volume, issue, pages | authors, doi, firstAuthor, issn, issue, journal/venue, pages, title, url, volume, year | authors, conferenceTitle, doi, firstAuthor, journal/venue, pages, publisher, title, url, year | volume, issue |
| article-journal-1662e676706eb0ff:mla9:clean | authors, title, year, doi, url, journal/venue, volume, issue, pages | authors, doi, firstAuthor, issn, issue, journal/venue, pages, title, url, volume, year | authors, conferenceTitle, doi, firstAuthor, journal/venue, pages, publisher, title, url, year | volume, issue |
| article-journal-1b52ebbd29cf8532:vancouver:noisy | title, year, journal/venue, volume, issue | authors, doi, firstAuthor, issn, issue, journal/venue, title, url, volume, year | authors, firstAuthor, journal/venue, title, url, volume, year | issue |
| book-13f4ea772425fcef:chicago-notes-bib:noisy | authors, title, year, publisher, journal/venue | authors, doi, firstAuthor, isbn, journal/venue, publisher, title, url, year | authors, firstAuthor, title, url, year | publisher, journal/venue |
| preprint-144383a403d1db07:apa7:noisy | title, repository, journal/venue | authors, doi, firstAuthor, journal/venue, repository, title, url, year | authors, firstAuthor, journal/venue, publisher, title, url | repository |
| preprint-144383a403d1db07:ieee:noisy | title, year, repository, journal/venue | authors, doi, firstAuthor, journal/venue, repository, title, url, year | authors, firstAuthor, journal/venue, publisher, title, year | repository |
| report-08376d566f84a3f2:chicago-notes-bib:noisy | authors, title, year, institution, journal/venue | authors, doi, firstAuthor, institution, journal/venue, title, url, year | authors, firstAuthor, institution, title, url, year | journal/venue |
| report-0fab7ad8f6d78470:harvard-ctr:noisy | title, institution, journal/venue | doi, institution, journal/venue, title, url, year | url | title, institution, journal/venue |

## Clean Structure Breakdown

| Structure | Compared | Soft Instance F1 | Macro Soft F1 |
| --- | --- | --- | --- |
| structured | 1200 | 0.935 | 0.989 |
| unstructured | 0 | 0 | 0 |

## Priority Fields

| Field | Soft F1 (balanced score) | Missing Expected | Unsupported Predicted | TP (matched expected) | FP (wrong predicted) | FN (missed expected) |
| --- | --- | --- | --- | --- | --- | --- |
| isbn | 0.8974 | 0 | 0 | 210 | 48 | 0 |
| authors | 0.9703 | 0 | 0 | 769 | 47 | 0 |
| issn | 0.9815 | 5 | 17 | 133 | 0 | 5 |
| title | 0.9916 | 0 | 0 | 1180 | 20 | 0 |
| journal/venue | 0.9962 | 0 | 0 | 1060 | 8 | 0 |
| institution | 0.9964 | 0 | 103 | 274 | 2 | 0 |
| publisher | 0.9975 | 1 | 544 | 400 | 1 | 1 |
| conferenceTitle | 1 | 0 | 133 | 138 | 0 | 0 |
| siteName | 1 | 0 | 132 | 132 | 0 | 0 |
| year | 1 | 0 | 0 | 1200 | 0 | 0 |
| bookTitle | 1 | 0 | 0 | 132 | 0 | 0 |
| doi | 1 | 0 | 0 | 936 | 0 | 0 |
| url | 1 | 0 | 0 | 1200 | 0 | 0 |
| patent | 1 | 0 | 0 | 132 | 0 | 0 |
| repository | 1 | 0 | 0 | 132 | 0 | 0 |

## Accuracy

- Type Accuracy: 0.9958 (1195/1200)
- Style Accuracy: 0.9408 (1129/1200)
- Style Family Accuracy: 0.9808 (1177/1200)

## Adversarial Pair Accuracy

| Pair | Styles | Accuracy | Correct | Compared |
| --- | --- | --- | --- | --- |
| apa7_vs_harvard-ctr | apa7 vs harvard-ctr | 0.895 | 358 | 400 |
| mla9_vs_chicago-notes-bib | mla9 vs chicago-notes-bib | 0.9325 | 373 | 400 |
| vancouver_vs_ieee | vancouver vs ieee | 0.995 | 398 | 400 |

## Priority Cells

| Style | Type | Compared | Soft Instance F1 |
| --- | --- | --- | --- |
| harvard-ctr | article-journal | 23 | 0.8261 |
| chicago-notes-bib | conference-paper | 23 | 0.8261 |
| vancouver | article-journal | 23 | 0.8261 |
| apa7 | preprint | 22 | 0.8636 |
| chicago-notes-bib | book-chapter | 22 | 0.8636 |
| vancouver | book-chapter | 22 | 0.8636 |
| apa7 | article-journal | 23 | 0.8696 |
| mla9 | article-journal | 23 | 0.8696 |
| apa7 | book-chapter | 22 | 0.9091 |
| apa7 | patent | 22 | 0.9091 |
| harvard-ctr | book-chapter | 22 | 0.9091 |
| harvard-ctr | patent | 22 | 0.9091 |

## Top Style Mismatches

| Expected | Detected | Count |
| --- | --- | --- |
| apa7 | unknown | 22 |
| mla9 | unknown | 21 |
| apa7 | harvard-ctr | 20 |
| chicago-notes-bib | mla9 | 4 |
| mla9 | chicago-notes-bib | 2 |
| vancouver | ieee | 1 |
| vancouver | unknown | 1 |

## Style Failure Examples

### apa7 -> unknown

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| webpage-00a35ae549875b24:apa7:clean | webpage | webpage | uncertain_split_block, input_style_uncertain, missing_preferred_fields | Export of UDP Options Information in IP Flow Information Export (IPFIX). (2025). RFC Editor. https://www.rfc-editor.org/rfc/rfc9870.html |
| webpage-02d23a55c7f1c255:apa7:clean | webpage | webpage | uncertain_institution, input_style_uncertain, missing_preferred_fields | Internet Engineering Task Force. (2018). The Transport Layer Security (TLS) Protocol Version 1.3. Internet Engineering Task Force. RFC Editor. https://www.rfc-editor.org/rfc/rfc8446 |
| webpage-06336e77ec7fe31e:apa7:clean | webpage | webpage | input_style_uncertain, missing_preferred_fields | TLS Encrypted Client Hello. (2026). RFC Editor. https://www.rfc-editor.org/rfc/rfc9849.html |
| webpage-0904f991c100052e:apa7:clean | webpage | webpage | uncertain_split_block, input_style_uncertain, missing_preferred_fields | The IPv6 VPN Service Destination Option. (2025). RFC Editor. https://www.rfc-editor.org/rfc/rfc9837.html |

### mla9 -> unknown

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| patent-03eb9c509756f30f:mla9:clean | patent | patent | uncertain_split_block, input_style_uncertain, missing_preferred_fields | Web Page Ranking for Page Query across Public and Private. US20060235842A1, 2006, https://patents.google.com/patent/US20060235842A1/en. |
| webpage-00a35ae549875b24:mla9:clean | webpage | webpage | uncertain_split_block, input_style_uncertain, missing_preferred_fields | “Export of UDP Options Information in IP Flow Information Export (IPFIX).” RFC Editor, 2025, https://www.rfc-editor.org/rfc/rfc9870.html. |
| webpage-06336e77ec7fe31e:mla9:clean | webpage | webpage | uncertain_institution, uncertain_split_block, input_style_uncertain, missing_preferred_fields | “TLS Encrypted Client Hello.” RFC Editor, 2026, https://www.rfc-editor.org/rfc/rfc9849.html. |
| webpage-0904f991c100052e:mla9:clean | webpage | webpage | uncertain_institution, uncertain_split_block, input_style_uncertain, missing_preferred_fields | “The IPv6 VPN Service Destination Option.” RFC Editor, 2025, https://www.rfc-editor.org/rfc/rfc9837.html. |

### apa7 -> harvard-ctr

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| thesis-0184f09544078184:apa7:clean | thesis | thesis | uncertain_split_block, input_style_uncertain, missing_preferred_fields | Botter Junior, W. (2021). Relações interfaciais de poli(dimetilsiloxano) com solidos inorganicos [Dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.1997.133750 |
| thesis-028faba376d4c6fa:apa7:clean | thesis | thesis | uncertain_split_block, input_style_uncertain, missing_preferred_fields | Antonio Fonseca Machado, P. (2021). Algebras geradas por menores de matrizes cataleticas [Dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.1997.114219 |
| thesis-0334154149e8210e:apa7:clean | thesis | thesis | input_style_uncertain, missing_preferred_fields | Albers, U. (2022). Evolution and treatment of vitamin B12 deficiency as a risk factor for (cognitive and functional) neurodegenerative diseases in institutionalized elderly = Evolución y tratamiento de la deficiencia de vitamina B12 como factor de riesgo de enfermedades neurodegenerativas (cognitivas y funcionales) en las personas mayores institucionalizadas. [Dissertation, Universidad Politecnica de Madrid - University Library]. https://doi.org/10.20868/upm.thesis.14629 |
| thesis-04c5599adab2e26d:apa7:clean | thesis | thesis | uncertain_split_block, input_style_uncertain, missing_preferred_fields | Inácio Prado, P. (2021). Diferenciação morfologica em função da planta hospdeira em Tomoplagia tripunctata e Tomoplagia incompleta (Diptera: Tephritidae) [Dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.1994.74931 |

### chicago-notes-bib -> mla9

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| preprint-013a98d4a636ccea:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Awang, Noor Azura, Nik Noor Haryatul Eleena Bt N. Mahmud, and Noor Ummi Hazirah Hani Zulkefli. “Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber.” Preprint, Elsevier BV, 2023. https://doi.org/10.2139/ssrn.4577205. |
| preprint-0438341024d575b7:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Hassan, A., A. A. M. Arafa, S. Z. Rida, M. A. Dagher, and Hamed M. El Sherbiny. “An Effective Technique for Solving Generalized Cahn-Hilliard (C-H) Problems.” Preprint, Research Square Platform LLC, 2023. https://doi.org/10.21203/rs.3.rs-2870128/v1. |
| preprint-0658a1475e8a5845:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Brizuela-Torres, Diego, Yves Zinngrebe, Mark D. A. Rounsevell, and Calum Brown. “Thirty Years of Drivers and Patterns of Land Use Change Across the Amazon Biome.” Preprint, Elsevier BV, 2023. https://doi.org/10.2139/ssrn.4591009. |
| preprint-19ff91e02f546e21:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Shen, Yusheng, and Kassandra M. Ori-McKenney. “Microtubule-Associated Proteins Orchestrate the Tubulin Code for Cellular Adaptation.” Preprint, Elsevier BV, 2023. https://doi.org/10.2139/ssrn.4502784. |

### mla9 -> chicago-notes-bib

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| webpage-02d23a55c7f1c255:mla9:clean | webpage | webpage | uncertain_institution, uncertain_split_block, input_style_uncertain, missing_preferred_fields, render_style_fallback | Internet Engineering Task Force. “The Transport Layer Security (TLS) Protocol Version 1.3.” RFC Editor, Internet Engineering Task Force, 2018, https://www.rfc-editor.org/rfc/rfc8446. |
| webpage-27947c124fa1d625:mla9:clean | webpage | webpage | uncertain_split_block, input_style_uncertain, missing_preferred_fields, render_style_fallback | Mozilla Contributors. “Array.Prototype.Map().” MDN Web Docs, Mozilla Contributors, 2024, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map. |

### vancouver -> ieee

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| thesis-1340436e0a9391fe:vancouver:clean | thesis | thesis | uncertain_split_block, input_style_uncertain, missing_preferred_fields | [1]CAROLINA PEREIRA CASTELO BRANCO A. A ATITUDE E PERCEPÇÃO DO CONSUMIDOR EM RELAÇÃO A MARCAS ESPORTIVAS. Dissertation. Faculdades Catolicas, 2023. https://doi.org/10.17771/pucrio.acad.63534. |

### vancouver -> unknown

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| webpage-27947c124fa1d625:vancouver:clean | webpage | webpage | uncertain_split_block, input_style_uncertain, missing_preferred_fields | [1]Mozilla Contributors. Array.prototype.map(). MDN Web Docs 2024. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map. |


## Top Type Mismatches

| Expected | Detected | Count |
| --- | --- | --- |
| article-journal | conference-paper | 5 |

## Stripped Fields By Detected Type

| Detected Type | Field | Count |
| --- | --- | --- |
| preprint | publisher | 132 |
| patent | siteName | 132 |
| webpage | publisher | 132 |
| patent | conferenceTitle | 120 |
| patent | publisher | 106 |
| article-journal | publisher | 90 |
| report | publisher | 78 |
| conference-paper | institution | 42 |
| preprint | institution | 36 |
| preprint | journal | 18 |
| article-journal | institution | 13 |
| book-chapter | institution | 12 |
| conference-paper | issn | 11 |
| article-journal | conferenceTitle | 7 |
| book-chapter | journal | 7 |
| book-chapter | issn | 6 |
| thesis | publisher | 6 |
| report | journal | 6 |
| report | conferenceTitle | 6 |
| conference-paper | issue | 5 |
| conference-paper | volume | 5 |

## Field Failure Examples

### authors

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| article-journal-0a30dff9e18398c6:apa7:clean | Boberski, Jens; Reza Shaebani, M.; Wolf, Dietrich E. | Boberski, J.; Shaebani, Reza; Wolf, M. and; D.E | Boberski, J.; Shaebani, Reza; Wolf, M. and; D.E | article-journal | apa7 | author_wrong_span |
| article-journal-0a30dff9e18398c6:harvard-ctr:clean | Boberski, Jens; Reza Shaebani, M.; Wolf, Dietrich E. | Boberski, J.; Shaebani, Reza; Wolf, M. and; D.E | Boberski, J.; Shaebani, Reza; Wolf, M. and; D.E | article-journal | harvard-ctr | author_wrong_span |
| article-journal-0a30dff9e18398c6:ieee:clean | Boberski, Jens; Reza Shaebani, M.; Wolf, Dietrich E. | Boberski, J.; Shaebani, Reza; Wolf, M. and; D.E | Boberski, J.; Shaebani, Reza; Wolf, M. and; D.E | article-journal | ieee | author_wrong_span |
| article-journal-0a30dff9e18398c6:mla9:clean | Boberski, Jens; Reza Shaebani, M.; Wolf, Dietrich E. | Boberski, J.; Shaebani, Reza; Wolf, M. and; D.E | Boberski, J.; Shaebani, Reza; Wolf, M. and; D.E | article-journal | mla9 | author_wrong_span |
| article-journal-0a30dff9e18398c6:vancouver:clean | Boberski, Jens; Reza Shaebani, M.; Wolf, Dietrich E. | Boberski, J.; Shaebani, Reza; Wolf, M. and; D.E | Boberski, J.; Shaebani, Reza; Wolf, M. and; D.E | article-journal | vancouver | author_wrong_span |

### title

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| article-journal-022226b2452a4ba5:vancouver:clean | A Cat’s Lick: Democratisation and Minority Communities in the Post-Soviet Baltic by Timofey Agarin, and Continuity and Change in the Baltic Sea Region: Comparing Foreign Policies by David J. Galbreath, Ainius Lašas, Jeremy W. Lamoreaux (review) | A Cat's Lick: Democratisation and Minority Communities in the Post-Soviet Baltic by Timofey Agarin, and Continuity and Change in the Baltic Sea Region: Comparing Foreign Policies by David J | A Cat's Lick: Democratisation and Minority Communities in the Post-Soviet Baltic by Timofey Agarin, and Continuity and Change in the Baltic Sea Region: Comparing Foreign Policies by David J | article-journal | vancouver | truncated_value |
| book-0ff60327bb45c84b:ieee:clean | Review of Basic Mathematical Concepts Used in Computational and Mathematical Psychology | J. T. Townsend, Z. Wang, and A. Eidels, Review of Basic Mathematical Concepts Used in Computational and Mathematical Psychology | J. T. Townsend, Z. Wang, and A. Eidels, Review of Basic Mathematical Concepts Used in Computational and Mathematical Psychology | book | ieee | catastrophic_wrong_content |
| book-1438f46fb88de13e:ieee:clean | Coletânea de Legislação Nacional e Internacional sobre Povos e Comunidades Tradicionais: Volume I - Normas Internacionais | A. G. SILVA, and R. B. LIMA NETO, Coletânea de Legislação Nacional e Internacional sobre Povos e Comunidades Tradicionais: Volume I - Normas Internacionais | A. G. SILVA, and R. B. LIMA NETO, Coletânea de Legislação Nacional e Internacional sobre Povos e Comunidades Tradicionais: Volume I - Normas Internacionais | book | ieee | catastrophic_wrong_content |
| patent-1abfd4e452ce97c4:apa7:clean | Methods, apparatus, equipment, storage media, and program products for generating training samples | Methods | Methods | patent | apa7 | truncated_value |
| patent-1abfd4e452ce97c4:chicago-notes-bib:clean | Methods, apparatus, equipment, storage media, and program products for generating training samples | Methods | Methods | patent | chicago-notes-bib | truncated_value |

### journal/venue

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| article-journal-022226b2452a4ba5:harvard-ctr:clean | Ab Imperio | Galbreath, Ainius Lašas, Jeremy W. Lamoreaux (review)," Ab Imperio | Galbreath, Ainius Lašas, Jeremy W. Lamoreaux (review)," Ab Imperio | article-journal | harvard-ctr | catastrophic_wrong_content |
| article-journal-0d603f677b1165f7:apa7:clean | Bond Law Review | Bond Law Review 2011;23 | Bond Law Review 2011;23 | article-journal | apa7 | catastrophic_wrong_content |
| article-journal-0d603f677b1165f7:chicago-notes-bib:clean | Bond Law Review | Bond Law Review 2011;23 | Bond Law Review 2011;23 | article-journal | chicago-notes-bib | catastrophic_wrong_content |
| article-journal-0d603f677b1165f7:harvard-ctr:clean | Bond Law Review | Bond Law Review 2011;23 | Bond Law Review 2011;23 | article-journal | harvard-ctr | catastrophic_wrong_content |
| article-journal-0d603f677b1165f7:ieee:clean | Bond Law Review | Bond Law Review 2011;23 | Bond Law Review 2011;23 | article-journal | ieee | catastrophic_wrong_content |

### publisher

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| book-chapter-0ae11ce81d7289e2:vancouver:clean | Springer London | 93, Springer London | 93, Springer London | book-chapter | vancouver | catastrophic_wrong_content |
| conference-paper-0cf8807cff5d8d45:chicago-notes-bib:clean | © Georg Thieme Verlag KG |  |  | conference-paper | chicago-notes-bib | container_missing |

### institution

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| webpage-02d23a55c7f1c255:chicago-notes-bib:clean | Internet Engineering Task Force | RFC Editor, Internet Engineering Task Force | RFC Editor, Internet Engineering Task Force | webpage | chicago-notes-bib | catastrophic_wrong_content |
| webpage-02d23a55c7f1c255:mla9:clean | Internet Engineering Task Force | RFC Editor, Internet Engineering Task Force | RFC Editor, Internet Engineering Task Force | webpage | chicago-notes-bib | catastrophic_wrong_content |

### issn

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| article-journal-1662e676706eb0ff:apa7:clean | 1920-261X |  | 1920261X | conference-paper | apa7 | wrong_type_field |
| article-journal-1662e676706eb0ff:chicago-notes-bib:clean | 1920-261X |  | 1920261X | conference-paper | chicago-notes-bib | wrong_type_field |
| article-journal-1662e676706eb0ff:ieee:clean | 1920-261X |  | 1920261X | conference-paper | ieee | wrong_type_field |
| article-journal-1662e676706eb0ff:mla9:clean | 1920-261X |  | 1920261X | conference-paper | mla9 | wrong_type_field |
| article-journal-1662e676706eb0ff:vancouver:clean | 1920-261X |  | 1920261X | conference-paper | vancouver | wrong_type_field |

### isbn

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| book-1b3f5e632c87f2c1:apa7:clean | 9781484279359 | 9781484279366 | 9781484279366 | book | apa7 | catastrophic_wrong_content |
| book-1b3f5e632c87f2c1:chicago-notes-bib:clean | 9781484279359 | 9781484279366 | 9781484279366 | book | chicago-notes-bib | catastrophic_wrong_content |
| book-1b3f5e632c87f2c1:harvard-ctr:clean | 9781484279359 | 9781484279366 | 9781484279366 | book | harvard-ctr | catastrophic_wrong_content |
| book-1b3f5e632c87f2c1:ieee:clean | 9781484279359 | 9781484279366 | 9781484279366 | book | ieee | catastrophic_wrong_content |
| book-1b3f5e632c87f2c1:mla9:clean | 9781484279359 | 9781484279366 | 9781484279366 | book | mla9 | catastrophic_wrong_content |

## Sample Failures

| Variant | Structure | Source Kind | Style | Type | Detected Style | Detected Type | Missing Fields | Stripped Fields |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| article-journal-1662e676706eb0ff:apa7:clean | structured | csl_rendered | apa7 | article-journal | apa7 | conference-paper | volume, issue | issn, issue, volume |
| article-journal-1662e676706eb0ff:chicago-notes-bib:clean | structured | csl_rendered | chicago-notes-bib | article-journal | chicago-notes-bib | conference-paper | volume, issue | issn, issue, volume |
| article-journal-1662e676706eb0ff:ieee:clean | structured | csl_rendered | ieee | article-journal | ieee | conference-paper | volume, issue | issn, issue, volume |
| article-journal-1662e676706eb0ff:mla9:clean | structured | csl_rendered | mla9 | article-journal | mla9 | conference-paper | volume, issue | issn, issue, volume |
| article-journal-1662e676706eb0ff:vancouver:clean | structured | csl_rendered | vancouver | article-journal | vancouver | conference-paper | volume, issue | issn, issue, volume |
| article-journal-022226b2452a4ba5:harvard-ctr:clean | structured | csl_rendered | harvard-ctr | article-journal | harvard-ctr | article-journal | journal/venue | institution, publisher |
| article-journal-022226b2452a4ba5:vancouver:clean | structured | csl_rendered | vancouver | article-journal | vancouver | article-journal | title | institution, publisher |
| article-journal-0a30dff9e18398c6:apa7:clean | structured | csl_rendered | apa7 | article-journal | apa7 | article-journal | authors | publisher |
| article-journal-0a30dff9e18398c6:harvard-ctr:clean | structured | csl_rendered | harvard-ctr | article-journal | harvard-ctr | article-journal | authors | publisher |
| article-journal-0a30dff9e18398c6:mla9:clean | structured | csl_rendered | mla9 | article-journal | mla9 | article-journal | authors | publisher |
| article-journal-0a30dff9e18398c6:vancouver:clean | structured | csl_rendered | vancouver | article-journal | vancouver | article-journal | authors | publisher |
| article-journal-0d603f677b1165f7:apa7:clean | structured | csl_rendered | apa7 | article-journal | apa7 | article-journal | journal/venue | publisher |
| article-journal-0d603f677b1165f7:chicago-notes-bib:clean | structured | csl_rendered | chicago-notes-bib | article-journal | chicago-notes-bib | article-journal | journal/venue | publisher |
| article-journal-0d603f677b1165f7:harvard-ctr:clean | structured | csl_rendered | harvard-ctr | article-journal | harvard-ctr | article-journal | journal/venue | publisher |
| article-journal-0d603f677b1165f7:ieee:clean | structured | csl_rendered | ieee | article-journal | ieee | article-journal | journal/venue | publisher |
| article-journal-0d603f677b1165f7:mla9:clean | structured | csl_rendered | mla9 | article-journal | mla9 | article-journal | journal/venue | publisher |
| article-journal-0d603f677b1165f7:vancouver:clean | structured | csl_rendered | vancouver | article-journal | vancouver | article-journal | journal/venue | publisher |
| article-journal-1662e676706eb0ff:harvard-ctr:clean | structured | csl_rendered | harvard-ctr | article-journal | harvard-ctr | article-journal | journal/venue | conferenceTitle, publisher |
| book-0ff60327bb45c84b:ieee:clean | structured | csl_rendered | ieee | book | ieee | book | title |  |
| book-1438f46fb88de13e:ieee:clean | structured | csl_rendered | ieee | book | ieee | book | title |  |
