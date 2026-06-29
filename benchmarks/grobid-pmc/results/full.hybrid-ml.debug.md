# Grobid-Style Benchmark Debug

- Mode: full
- Profile: hybrid-ml

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
| title | 6864 | 6855 | 0.9987 | false | false |
| url | 6864 | 6824 | 0.9942 | false | false |
| year | 6864 | 6843 | 0.9969 | false | false |
| journal/venue | 6072 | 6000 | 0.9881 | false | false |
| doi | 5280 | 5074 | 0.961 | false | false |
| authors | 4686 | 4681 | 0.9989 | false | false |
| firstAuthor | 4686 | 4681 | 0.9989 | false | false |
| publisher | 2298 | 2194 | 0.9547 | false | false |
| pages | 1602 | 1600 | 0.9988 | false | false |
| institution | 1560 | 1495 | 0.9583 | false | false |
| isbn | 1482 | 1352 | 0.9123 | false | true |
| bookTitle | 792 | 760 | 0.9596 | false | false |
| patent | 792 | 792 | 1 | false | false |
| siteName | 792 | 749 | 0.9457 | false | true |
| issn | 774 | 755 | 0.9755 | false | false |
| conferenceTitle | 762 | 718 | 0.9423 | false | true |
| volume | 750 | 750 | 1 | false | false |
| issue | 744 | 740 | 0.9946 | false | false |
| repository | 738 | 712 | 0.9648 | false | false |
| thesisType | 738 | 732 | 0.9919 | false | false |

## Contract Samples

| Variant | Required Fields | Expected Keys | Predicted Keys | Missing Required |
| --- | --- | --- | --- | --- |
| article-journal-1b52ebbd29cf8532:vancouver:noisy | title, year, journal/venue, volume, issue | authors, doi, firstAuthor, issn, issue, journal/venue, title, url, volume, year | authors, firstAuthor, journal/venue, title, url, volume, year | issue |
| article-journal-5c9948d5633cc6fa:harvard-ctr:noisy | title, journal/venue, issue, pages | authors, doi, firstAuthor, issn, issue, journal/venue, pages, title, url, year | authors, firstAuthor, journal/venue, pages, title, url, year | issue |
| article-journal-8453c54e9f6ae5b4:ieee:clean | title, year, doi, url, journal/venue, issue, pages | authors, doi, firstAuthor, issn, issue, journal/venue, pages, title, url, year | authors, bookTitle, doi, firstAuthor, journal/venue, pages, publisher, title, url, year | issue |
| conference-paper-13ce715a5e621bcf:apa7:clean | title, year, doi, url, conferenceTitle, journal/venue | authors, conferenceTitle, doi, firstAuthor, journal/venue, publisher, title, url, year | authors, doi, firstAuthor, issn, journal/venue, title, url, year | conferenceTitle |
| conference-paper-13ce715a5e621bcf:harvard-ctr:clean | title, year, doi, url, publisher | authors, conferenceTitle, doi, firstAuthor, journal/venue, publisher, title, url, year | authors, doi, firstAuthor, issn, journal/venue, title, url, year | publisher |
| conference-paper-13ce715a5e621bcf:chicago-notes-bib:clean | authors, title, year, doi, url, conferenceTitle, journal/venue | authors, conferenceTitle, doi, firstAuthor, journal/venue, publisher, title, url, year | authors, doi, firstAuthor, issn, journal/venue, title, url, year | conferenceTitle |
| conference-paper-13ce715a5e621bcf:vancouver:clean | title, year, doi, url, publisher | authors, conferenceTitle, doi, firstAuthor, journal/venue, publisher, title, url, year | authors, doi, firstAuthor, issn, journal/venue, title, url, year | publisher |
| conference-paper-13ce715a5e621bcf:ieee:clean | title, year, doi, url, publisher | authors, conferenceTitle, doi, firstAuthor, journal/venue, publisher, title, url, year | authors, doi, firstAuthor, issn, journal/venue, title, url, year | publisher |
| conference-paper-13ce715a5e621bcf:mla9:clean | authors, title, year, doi, url, conferenceTitle, journal/venue | authors, conferenceTitle, doi, firstAuthor, journal/venue, publisher, title, url, year | authors, doi, firstAuthor, issn, journal/venue, title, url, year | conferenceTitle |
| conference-paper-24d94ecbd989dc7d:apa7:clean | title, year, doi, url, conferenceTitle, journal/venue | authors, conferenceTitle, doi, firstAuthor, journal/venue, publisher, title, url, year | authors, doi, firstAuthor, issn, journal/venue, title, url, year | conferenceTitle |
| conference-paper-24d94ecbd989dc7d:harvard-ctr:clean | title, year, doi, url, publisher | authors, conferenceTitle, doi, firstAuthor, journal/venue, publisher, title, url, year | authors, doi, firstAuthor, issn, journal/venue, title, url, year | publisher |
| conference-paper-24d94ecbd989dc7d:harvard-ctr:noisy | title, publisher | authors, conferenceTitle, doi, firstAuthor, journal/venue, publisher, title, url, year | authors, conferenceTitle, firstAuthor, journal/venue, title, url, year | publisher |

## Clean Structure Breakdown

| Structure | Compared | Soft Instance F1 | Macro Soft F1 |
| --- | --- | --- | --- |
| structured | 6000 | 0.9282 | 0.9581 |
| unstructured | 0 | 0 | 0 |

## Priority Fields

| Field | Soft F1 (balanced score) | Missing Expected | Unsupported Predicted | TP (matched expected) | FP (wrong predicted) | FN (missed expected) |
| --- | --- | --- | --- | --- | --- | --- |
| isbn | 0.32 | 52 | 10 | 240 | 968 | 52 |
| conferenceTitle | 0.9738 | 27 | 742 | 632 | 7 | 27 |
| authors | 0.9739 | 0 | 0 | 3912 | 210 | 0 |
| publisher | 0.9807 | 47 | 2991 | 1905 | 28 | 47 |
| title | 0.9852 | 0 | 0 | 5825 | 175 | 0 |
| institution | 0.986 | 18 | 540 | 1371 | 21 | 18 |
| bookTitle | 0.9871 | 16 | 24 | 649 | 1 | 16 |
| journal/venue | 0.9914 | 7 | 0 | 5243 | 84 | 7 |
| issn | 0.9949 | 7 | 7 | 677 | 0 | 7 |
| repository | 0.9955 | 6 | 0 | 660 | 0 | 6 |
| siteName | 0.9985 | 0 | 671 | 664 | 2 | 0 |
| patent | 0.9992 | 0 | 0 | 665 | 1 | 0 |
| year | 0.9998 | 0 | 0 | 5998 | 2 | 0 |
| url | 0.9999 | 0 | 0 | 5999 | 1 | 0 |
| doi | 1 | 0 | 0 | 4668 | 0 | 0 |

## Accuracy

- Type Accuracy: 0.9878 (5927/6000)
- Style Accuracy: 0.9373 (5624/6000)
- Style Family Accuracy: 0.9775 (5865/6000)

## Adversarial Pair Accuracy

| Pair | Styles | Accuracy | Correct | Compared |
| --- | --- | --- | --- | --- |
| apa7_vs_harvard-ctr | apa7 vs harvard-ctr | 0.892 | 1784 | 2000 |
| mla9_vs_chicago-notes-bib | mla9 vs chicago-notes-bib | 0.9285 | 1857 | 2000 |
| vancouver_vs_ieee | vancouver vs ieee | 0.9915 | 1983 | 2000 |

## Priority Cells

| Style | Type | Compared | Soft Instance F1 |
| --- | --- | --- | --- |
| harvard-ctr | article-journal | 115 | 0.8348 |
| ieee | book | 108 | 0.8519 |
| chicago-notes-bib | book-chapter | 111 | 0.8649 |
| mla9 | book-chapter | 111 | 0.8649 |
| vancouver | book-chapter | 111 | 0.8919 |
| mla9 | article-journal | 115 | 0.8957 |
| chicago-notes-bib | preprint | 111 | 0.9009 |
| mla9 | preprint | 111 | 0.9009 |
| mla9 | thesis | 111 | 0.9009 |
| apa7 | book | 108 | 0.9074 |
| chicago-notes-bib | book | 108 | 0.9074 |
| mla9 | book | 108 | 0.9074 |

## Top Style Mismatches

| Expected | Detected | Count |
| --- | --- | --- |
| mla9 | unknown | 116 |
| apa7 | unknown | 112 |
| apa7 | harvard-ctr | 103 |
| mla9 | chicago-notes-bib | 14 |
| vancouver | unknown | 9 |
| chicago-notes-bib | mla9 | 9 |
| vancouver | ieee | 7 |
| mla9 | harvard-ctr | 2 |
| chicago-notes-bib | apa7 | 1 |
| chicago-notes-bib | harvard-ctr | 1 |
| harvard-ctr | unknown | 1 |
| ieee | vancouver | 1 |

## Style Failure Examples

### mla9 -> unknown

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| conference-paper-4981b50cef6fc24c:mla9:clean | conference-paper | conference-paper | input_style_uncertain, missing_preferred_fields | Edwards, Robert. “Baryon Resonance Determination Using LQCD.” 2013, BARYONS 2013, Glasgow, U.K., June 24, 2013, https://doi.org/10.2172/1992065. |
| book-chapter-755b9b0c6a5d1aa8:mla9:clean | book-chapter | book-chapter | input_style_uncertain, missing_preferred_fields | Griffiths, Jane, and Adam Hanna. “Introduction.” Architectural Space and the Imagination, Springer International Publishing, 2020, pp. 1–16, https://doi.org/10.1007/978-3-030-36067-2_1. |
| book-chapter-87f22682f4598d1c:mla9:clean | book-chapter | book-chapter | input_style_uncertain, missing_preferred_fields | Scholtz, Bauke, and Arjan Tijms. “Extensions.” The Definitive Guide to Jakarta Faces in Jakarta EE 10, Apress, 2022, pp. 499–518, https://doi.org/10.1007/978-1-4842-7310-4_15. |
| thesis-384ffb193c34a59f:mla9:clean | thesis | thesis | input_style_uncertain, missing_preferred_fields | Melo Franco, Eliane. Estudo “in Vitro” Do Bochecho Pre-Escovação Plax Na Reatividade Do Fluor Com Esmalte Dental Humano. 2021, https://doi.org/10.47749/t/unicamp.1992.51275. Universidade Estadual de Campinas, Dissertation. |

### apa7 -> unknown

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| book-d0b190d49a80f3c8:apa7:clean | book | book | uncertain_publisher, input_style_uncertain, missing_preferred_fields | Bachrach, U., Saxena, A. K., Saxena, M., Leurs, R., Timmerman, H., Lee, B., Ciardelli, T. L., Margaglione, M., Grandone, E., Di Minno, G., Schultz, R. M., Whittake, V. P., Männistö, P. T., Ulmanen, I., Lundström, K., Taskinen, J., Tenhunen, J., Tilgmann, C., Kaakkola, S., & Wechter, W. J. (1992). Progress in Drug Research / Fortschritte der Arzneimittelforschung / Progrès des recherches pharmaceutiques. Birkhäuser Basel. https://doi.org/10.1007/978-3-0348-7144-0 |
| webpage-00a35ae549875b24:apa7:clean | webpage | webpage | input_style_uncertain, missing_preferred_fields | Export of UDP Options Information in IP Flow Information Export (IPFIX). (2025). RFC Editor. https://www.rfc-editor.org/rfc/rfc9870.html |
| webpage-02d23a55c7f1c255:apa7:clean | webpage | webpage | uncertain_institution, input_style_uncertain, missing_preferred_fields | Internet Engineering Task Force. (2018). The Transport Layer Security (TLS) Protocol Version 1.3. Internet Engineering Task Force. RFC Editor. https://www.rfc-editor.org/rfc/rfc8446 |
| webpage-06336e77ec7fe31e:apa7:clean | webpage | webpage | input_style_uncertain, missing_preferred_fields | TLS Encrypted Client Hello. (2026). RFC Editor. https://www.rfc-editor.org/rfc/rfc9849.html |

### apa7 -> harvard-ctr

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| thesis-0184f09544078184:apa7:clean | thesis | thesis | input_style_uncertain, missing_preferred_fields | Botter Junior, W. (2021). Relações interfaciais de poli(dimetilsiloxano) com solidos inorganicos [Dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.1997.133750 |
| thesis-028faba376d4c6fa:apa7:clean | thesis | thesis | input_style_uncertain, missing_preferred_fields | Antonio Fonseca Machado, P. (2021). Algebras geradas por menores de matrizes cataleticas [Dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.1997.114219 |
| thesis-0334154149e8210e:apa7:clean | thesis | thesis | input_style_uncertain, missing_preferred_fields | Albers, U. (2022). Evolution and treatment of vitamin B12 deficiency as a risk factor for (cognitive and functional) neurodegenerative diseases in institutionalized elderly = Evolución y tratamiento de la deficiencia de vitamina B12 como factor de riesgo de enfermedades neurodegenerativas (cognitivas y funcionales) en las personas mayores institucionalizadas. [Dissertation, Universidad Politecnica de Madrid - University Library]. https://doi.org/10.20868/upm.thesis.14629 |
| thesis-04c5599adab2e26d:apa7:clean | thesis | thesis | input_style_uncertain, missing_preferred_fields | Inácio Prado, P. (2021). Diferenciação morfologica em função da planta hospdeira em Tomoplagia tripunctata e Tomoplagia incompleta (Diptera: Tephritidae) [Dissertation, Universidade Estadual de Campinas]. https://doi.org/10.47749/t/unicamp.1994.74931 |

### mla9 -> chicago-notes-bib

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| conference-paper-455b7336e1577097:mla9:clean | conference-paper | conference-paper | input_style_uncertain, missing_preferred_fields, render_style_fallback | Ent, Rolf. “Nuclear Physics at the Electron Ion Collider.” 2016, NAPAC2016, Chicago, IL, USA, October 9–14, 2016, https://doi.org/10.2172/1987321. |
| webpage-02d23a55c7f1c255:mla9:clean | webpage | webpage | uncertain_institution, input_style_uncertain, missing_preferred_fields, render_style_fallback | Internet Engineering Task Force. “The Transport Layer Security (TLS) Protocol Version 1.3.” RFC Editor, Internet Engineering Task Force, 2018, https://www.rfc-editor.org/rfc/rfc8446. |
| webpage-27947c124fa1d625:mla9:clean | webpage | webpage | input_style_uncertain, missing_preferred_fields, render_style_fallback | Mozilla Contributors. “Array.Prototype.Map().” MDN Web Docs, Mozilla Contributors, 2024, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map. |
| webpage-36eb4b0ea5a8c520:mla9:clean | webpage | webpage | input_style_uncertain, missing_preferred_fields, render_style_fallback | React Team. “State: A Component’s Memory.” React, React Team, 2024, https://react.dev/learn/state-a-components-memory. |

### vancouver -> unknown

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| article-journal-678ddffaa1e4eded:vancouver:clean | article-journal | article-journal | input_style_uncertain, missing_preferred_fields | [1]Зябриков ВВ. Систематизация ценностей деловой культуры России. Creative Economy 2015;9:1191. https://doi.org/10.18334/ce.9.9.1923. |
| article-journal-90b31f8da8ebd833:vancouver:clean | article-journal | article-journal | input_style_uncertain, missing_preferred_fields | [1]Rino R, Aryadi M, Abidin Z. STRATEGI PENGELOLAAN PROGRAM PERHUTANAN SOSIAL DI KESATUAN PENGELOLAAN HUTAN LINDUNG SENGAYAM. Jurnal Hutan Tropis 2025;13:12. https://doi.org/10.20527/jht.v13i1.22176. |
| webpage-27947c124fa1d625:vancouver:clean | webpage | webpage | input_style_uncertain, missing_preferred_fields | [1]Mozilla Contributors. Array.prototype.map(). MDN Web Docs 2024. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map. |
| webpage-36eb4b0ea5a8c520:vancouver:clean | webpage | webpage | input_style_uncertain, missing_preferred_fields | [1]React Team. State: A Component’s Memory. React 2024. https://react.dev/learn/state-a-components-memory. |

### chicago-notes-bib -> mla9

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| preprint-013a98d4a636ccea:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Awang, Noor Azura, Nik Noor Haryatul Eleena Bt N. Mahmud, and Noor Ummi Hazirah Hani Zulkefli. “Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber.” Preprint, Elsevier BV, 2023. https://doi.org/10.2139/ssrn.4577205. |
| preprint-0438341024d575b7:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Hassan, A., A. A. M. Arafa, S. Z. Rida, M. A. Dagher, and Hamed M. El Sherbiny. “An Effective Technique for Solving Generalized Cahn-Hilliard (C-H) Problems.” Preprint, Research Square Platform LLC, 2023. https://doi.org/10.21203/rs.3.rs-2870128/v1. |
| preprint-0658a1475e8a5845:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Brizuela-Torres, Diego, Yves Zinngrebe, Mark D. A. Rounsevell, and Calum Brown. “Thirty Years of Drivers and Patterns of Land Use Change Across the Amazon Biome.” Preprint, Elsevier BV, 2023. https://doi.org/10.2139/ssrn.4591009. |
| preprint-19ff91e02f546e21:chicago-notes-bib:clean | preprint | preprint | input_style_uncertain, missing_preferred_fields | Shen, Yusheng, and Kassandra M. Ori-McKenney. “Microtubule-Associated Proteins Orchestrate the Tubulin Code for Cellular Adaptation.” Preprint, Elsevier BV, 2023. https://doi.org/10.2139/ssrn.4502784. |

### vancouver -> ieee

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| thesis-1340436e0a9391fe:vancouver:clean | thesis | thesis | input_style_uncertain, missing_preferred_fields | [1]CAROLINA PEREIRA CASTELO BRANCO A. A ATITUDE E PERCEPÇÃO DO CONSUMIDOR EM RELAÇÃO A MARCAS ESPORTIVAS. Dissertation. Faculdades Catolicas, 2023. https://doi.org/10.17771/pucrio.acad.63534. |
| thesis-190e82686045c380:vancouver:clean | thesis | thesis | input_style_uncertain, missing_preferred_fields | [1]Silva NF de. Body weight prediction of crossbred beef cattle through the image processing and machine learning algorithms. Dissertation. Pro-Reitoria de Pesquisa e Pos-Graduacai - UFV, 2023. https://doi.org/10.47328/ufvbbt.2022.729. |
| thesis-3fc1fec9b1d96054:vancouver:clean | thesis | thesis | input_style_uncertain, missing_preferred_fields | [1]GONCALVES BEZERRA N. PLANEJAMENTO E GESTÃO DE CARREIRA: UM ESTUDO SOBRE A CARREIRA DO PROFISSIONAL DE XADREZ. Dissertation. Faculdades Catolicas, 2023. https://doi.org/10.17771/pucrio.acad.63352. |
| thesis-51459f4646813bfe:vancouver:clean | thesis | thesis | input_style_uncertain, missing_preferred_fields | [1]Casanova E. Síntese de fala aplicada à geração de conjunto de dados para reconhecimento automático de fala. Dissertation. Universidade de Sao Paulo, Agencia USP de Gestao da Informacao Academica (AGUIA), 2022. https://doi.org/10.11606/t.55.2022.tde-02092022-142539. |

### mla9 -> harvard-ctr

| Variant | Type | Detected Type | Warnings | Citation |
| --- | --- | --- | --- | --- |
| thesis-73dce4c3787011a9:mla9:clean | thesis | thesis | missing_preferred_fields | Correa Coelho, Ricardo. A Linguagem Da Campanha Para a Prefeitura de São Paulo de 1985. 2021, https://doi.org/10.47749/t/unicamp.1991.36978. Universidade Estadual de Campinas, Dissertation. |
| thesis-78297b0273bda4b3:mla9:clean | thesis | thesis | missing_preferred_fields | Ahearn, Rosemary. Moreton Island Community and Culture 1850-1995. 2022, https://doi.org/10.14264/996ecf4. University of Queensland Library, Dissertation. |


## Top Type Mismatches

| Expected | Detected | Count |
| --- | --- | --- |
| conference-paper | article-journal | 27 |
| report | conference-paper | 18 |
| book-chapter | article-journal | 10 |
| book-chapter | conference-paper | 6 |
| article-journal | preprint | 6 |
| preprint | book | 5 |
| article-journal | book-chapter | 1 |

## Stripped Fields By Detected Type

| Detected Type | Field | Count |
| --- | --- | --- |
| patent | siteName | 665 |
| webpage | publisher | 663 |
| preprint | publisher | 657 |
| patent | conferenceTitle | 648 |
| report | publisher | 601 |
| patent | publisher | 554 |
| article-journal | publisher | 491 |
| preprint | institution | 202 |
| conference-paper | institution | 188 |
| preprint | journal | 90 |
| article-journal | institution | 66 |
| book-chapter | institution | 54 |
| article-journal | conferenceTitle | 46 |
| preprint | conferenceTitle | 36 |
| book-chapter | journal | 30 |
| book | institution | 30 |
| thesis | publisher | 25 |
| report | journal | 24 |
| conference-paper | volume | 17 |
| article-journal | bookTitle | 16 |
| book-chapter | volume | 13 |
| report | pages | 12 |
| article-journal | isbn | 10 |
| book-chapter | issn | 7 |

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
| article-journal-1ebb4ae09cabd7dc:apa7:clean | Novos usos e desafios para os videojogos: streaming, questões de género e assédio online | Novos usos e desafios para os videojogos: streaming | Novos usos e desafios para os videojogos: streaming | article-journal | apa7 | truncated_value |
| article-journal-30130aae973bbc7b:vancouver:clean | Vers une gestion intégrée de l’eau dans l’Empire romain ed. by E. Hermon (review) | Vers une gestion intégrée de l'eau dans l'Empire romain ed | Vers une gestion intégrée de l'eau dans l'Empire romain ed | article-journal | vancouver | truncated_value |
| article-journal-35882be2624f3136:apa7:clean | ANALISIS BEBAN KERJA PADA PT. BPR SUBANG GEMI NASTITI (PERSERODA) KANTOR PUSAT OPERASIONAL DI KOTA SUBANG | ANALISIS BEBAN KERJA PADA PT. | ANALISIS BEBAN KERJA PADA PT. | article-journal | apa7 | truncated_value |
| article-journal-35882be2624f3136:chicago-notes-bib:clean | ANALISIS BEBAN KERJA PADA PT. BPR SUBANG GEMI NASTITI (PERSERODA) KANTOR PUSAT OPERASIONAL DI KOTA SUBANG | ANALISIS BEBAN KERJA PADA PT. | ANALISIS BEBAN KERJA PADA PT. | article-journal | chicago-notes-bib | truncated_value |

### year

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| webpage-4ddf66c98a8c5d1d:ieee:clean | 2026 | 3161 | 3161 | webpage | ieee | publication_year_missed |
| webpage-96bf2d72a36a00b0:ieee:clean | 2025 | 2000 | 2000 | webpage | ieee | publication_year_missed |

### journal/venue

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| article-journal-022226b2452a4ba5:harvard-ctr:clean | Ab Imperio | Galbreath, Ainius Lašas, Jeremy W. Lamoreaux (review)," Ab Imperio | Galbreath, Ainius Lašas, Jeremy W. Lamoreaux (review)," Ab Imperio | article-journal | harvard-ctr | catastrophic_wrong_content |
| article-journal-0d603f677b1165f7:apa7:clean | Bond Law Review | Bond Law Review 2011;23 | Bond Law Review 2011;23 | article-journal | apa7 | catastrophic_wrong_content |
| article-journal-0d603f677b1165f7:chicago-notes-bib:clean | Bond Law Review | Bond Law Review 2011;23 | Bond Law Review 2011;23 | article-journal | chicago-notes-bib | catastrophic_wrong_content |
| article-journal-0d603f677b1165f7:harvard-ctr:clean | Bond Law Review | Bond Law Review 2011;23 | Bond Law Review 2011;23 | article-journal | harvard-ctr | catastrophic_wrong_content |
| article-journal-0d603f677b1165f7:ieee:clean | Bond Law Review | Bond Law Review 2011;23 | Bond Law Review 2011;23 | article-journal | ieee | catastrophic_wrong_content |

### conferenceTitle

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| conference-paper-13ce715a5e621bcf:apa7:clean | Proceedings of the 51 Brasilian Congress of Engineering Education |  | Proceedings of the 51 Brasilian Congress of Engineering Education | article-journal | apa7 | wrong_type_field |
| conference-paper-13ce715a5e621bcf:chicago-notes-bib:clean | Proceedings of the 51 Brasilian Congress of Engineering Education |  | Proceedings of the 51 Brasilian Congress of Engineering Education | article-journal | chicago-notes-bib | wrong_type_field |
| conference-paper-13ce715a5e621bcf:harvard-ctr:clean | Proceedings of the 51 Brasilian Congress of Engineering Education |  | Proceedings of the 51 Brasilian Congress of Engineering Education | article-journal | harvard-ctr | wrong_type_field |
| conference-paper-13ce715a5e621bcf:ieee:clean | Proceedings of the 51 Brasilian Congress of Engineering Education |  | Proceedings of the 51 Brasilian Congress of Engineering Education | article-journal | ieee | wrong_type_field |
| conference-paper-13ce715a5e621bcf:mla9:clean | Proceedings of the 51 Brasilian Congress of Engineering Education |  | Proceedings of the 51 Brasilian Congress of Engineering Education | article-journal | mla9 | wrong_type_field |

### bookTitle

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| book-chapter-35cca959339406b4:chicago-notes-bib:clean | Studies in European Economic Law and Regulation |  |  | article-journal | chicago-notes-bib | wrong_type_field |
| book-chapter-35cca959339406b4:harvard-ctr:clean | Studies in European Economic Law and Regulation |  |  | article-journal | harvard-ctr | wrong_type_field |
| book-chapter-35cca959339406b4:ieee:clean | Studies in European Economic Law and Regulation |  |  | article-journal | ieee | wrong_type_field |
| book-chapter-35cca959339406b4:mla9:clean | Studies in European Economic Law and Regulation |  |  | article-journal | mla9 | wrong_type_field |
| book-chapter-35cca959339406b4:vancouver:clean | Studies in European Economic Law and Regulation |  |  | article-journal | vancouver | wrong_type_field |

### publisher

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| book-chapter-0ae11ce81d7289e2:vancouver:clean | Springer London | 93, Springer London | 93, Springer London | book-chapter | vancouver | catastrophic_wrong_content |
| book-chapter-243d55931c289bb9:chicago-notes-bib:clean | J.B. Metzler | Metzler | Metzler | book-chapter | chicago-notes-bib | catastrophic_wrong_content |
| book-chapter-243d55931c289bb9:ieee:clean | J.B. Metzler | Metzler | Metzler | book-chapter | ieee | catastrophic_wrong_content |
| book-chapter-243d55931c289bb9:mla9:clean | J.B. Metzler | Metzler | Metzler | book-chapter | mla9 | catastrophic_wrong_content |
| book-chapter-243d55931c289bb9:vancouver:clean | J.B. Metzler | Metzler | Metzler | book-chapter | vancouver | catastrophic_wrong_content |

### institution

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| report-28f49c1d5c54b87c:apa7:clean | Office of Scientific and Technical Information (OSTI) | [Spreadsheets | [Spreadsheets | report | apa7 | catastrophic_wrong_content |
| report-2bc0bd580128ad0b:apa7:clean | KRPOCH |  | International Scientific and Practical Conference: Psychological and Pedagogical Problems of Modern Specialist Formation | conference-paper | apa7 | wrong_type_field |
| report-2bc0bd580128ad0b:chicago-notes-bib:clean | KRPOCH |  | International Scientific and Practical Conference: Psychological and Pedagogical Problems of Modern Specialist Formation | conference-paper | chicago-notes-bib | wrong_type_field |
| report-2bc0bd580128ad0b:harvard-ctr:clean | KRPOCH |  | (2017) International Scientific and Practical Conference: Psychological and Pedagogical Problems of Modern Specialist Formation | conference-paper | harvard-ctr | wrong_type_field |
| report-2bc0bd580128ad0b:ieee:clean | KRPOCH |  | International Scientific and Practical Conference: Psychological and Pedagogical Problems of Modern Specialist Formation | conference-paper | ieee | wrong_type_field |

### url

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| patent-a9805b55f76c7f43:vancouver:clean | https://patents.google.com/patent/CN115327949B/en | https://patents.google.com/patent/EP4443440B1/en | https://patents.google.com/patent/EP4443440B1/en | patent | vancouver | catastrophic_wrong_content |

### issn

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| article-journal-8453c54e9f6ae5b4:ieee:clean | 1812-7339 |  | 18127339 | book-chapter | ieee | wrong_type_field |
| article-journal-948e45242169643f:apa7:clean | 1556-5068 |  |  | preprint | apa7 | wrong_type_field |
| article-journal-948e45242169643f:chicago-notes-bib:clean | 1556-5068 |  |  | preprint | chicago-notes-bib | wrong_type_field |
| article-journal-948e45242169643f:harvard-ctr:clean | 1556-5068 |  |  | preprint | harvard-ctr | wrong_type_field |
| article-journal-948e45242169643f:ieee:clean | 1556-5068 |  |  | preprint | vancouver | wrong_type_field |

### isbn

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| book-02d8e99e33e0b5e2:apa7:clean | 9783319189376 | 9783319189383 | 9783319189383 | book | apa7 | catastrophic_wrong_content |
| book-02d8e99e33e0b5e2:chicago-notes-bib:clean | 9783319189376 | 9783319189383 | 9783319189383 | book | chicago-notes-bib | catastrophic_wrong_content |
| book-02d8e99e33e0b5e2:harvard-ctr:clean | 9783319189376 | 9783319189383 | 9783319189383 | book | harvard-ctr | catastrophic_wrong_content |
| book-02d8e99e33e0b5e2:ieee:clean | 9783319189376 | 9783319189383 | 9783319189383 | book | ieee | catastrophic_wrong_content |
| book-02d8e99e33e0b5e2:mla9:clean | 9783319189376 | 9783319189383 | 9783319189383 | book | mla9 | catastrophic_wrong_content |

### patent

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| patent-a9805b55f76c7f43:harvard-ctr:clean | EP4443440B1 | CN115327949B | CN115327949B | patent | harvard-ctr | catastrophic_wrong_content |

### siteName

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| webpage-7634ff49da72156a:ieee:clean | PostgreSQL Documentation | postgresql.org | postgresql.org | webpage | ieee | catastrophic_wrong_content |
| webpage-7634ff49da72156a:vancouver:clean | PostgreSQL Documentation | postgresql.org | postgresql.org | webpage | unknown | catastrophic_wrong_content |

### repository

| Variant | Expected | Predicted | Raw Predicted | Detected Type | Detected Style | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| preprint-8efc0b2edb9a748e:apa7:clean | Optica Publishing Group |  |  | book | apa7 | wrong_type_field |
| preprint-8efc0b2edb9a748e:chicago-notes-bib:clean | Optica Publishing Group |  |  | preprint | chicago-notes-bib | container_missing |
| preprint-8efc0b2edb9a748e:harvard-ctr:clean | Optica Publishing Group |  |  | book | harvard-ctr | wrong_type_field |
| preprint-8efc0b2edb9a748e:ieee:clean | Optica Publishing Group |  |  | book | ieee | wrong_type_field |
| preprint-8efc0b2edb9a748e:mla9:clean | Optica Publishing Group |  |  | book | mla9 | wrong_type_field |

## Sample Failures

| Variant | Structure | Source Kind | Style | Type | Detected Style | Detected Type | Missing Fields | Stripped Fields |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| article-journal-35882be2624f3136:ieee:clean | structured | csl_rendered | ieee | article-journal | ieee | article-journal | title, journal/venue | conferenceTitle, institution, publisher |
| article-journal-35882be2624f3136:mla9:clean | structured | csl_rendered | mla9 | article-journal | mla9 | article-journal | title, journal/venue | conferenceTitle, institution, publisher |
| article-journal-4f240355be96cf4a:mla9:clean | structured | csl_rendered | mla9 | article-journal | mla9 | article-journal | journal/venue, volume | conferenceTitle, publisher |
| article-journal-8453c54e9f6ae5b4:ieee:clean | structured | csl_rendered | ieee | article-journal | ieee | book-chapter | journal/venue, issue | issn, issue, journal, volume |
| book-chapter-35cca959339406b4:chicago-notes-bib:clean | structured | csl_rendered | chicago-notes-bib | book-chapter | chicago-notes-bib | article-journal | bookTitle, publisher | isbn, publisher |
| book-chapter-35cca959339406b4:harvard-ctr:clean | structured | csl_rendered | harvard-ctr | book-chapter | harvard-ctr | article-journal | bookTitle, publisher | isbn, publisher |
| book-chapter-35cca959339406b4:ieee:clean | structured | csl_rendered | ieee | book-chapter | ieee | article-journal | bookTitle, publisher | isbn, publisher |
| book-chapter-35cca959339406b4:mla9:clean | structured | csl_rendered | mla9 | book-chapter | mla9 | article-journal | bookTitle, publisher | isbn, publisher |
| book-chapter-35cca959339406b4:vancouver:clean | structured | csl_rendered | vancouver | book-chapter | vancouver | article-journal | bookTitle, publisher | isbn, publisher |
| book-chapter-73959f361b975d3c:vancouver:clean | structured | csl_rendered | vancouver | book-chapter | vancouver | book-chapter | bookTitle, journal/venue |  |
| book-chapter-7c12d5836a8bf3f8:chicago-notes-bib:clean | structured | csl_rendered | chicago-notes-bib | book-chapter | chicago-notes-bib | article-journal | bookTitle, publisher | isbn, publisher |
| book-chapter-7c12d5836a8bf3f8:harvard-ctr:clean | structured | csl_rendered | harvard-ctr | book-chapter | harvard-ctr | article-journal | bookTitle, publisher | isbn, publisher |
| book-chapter-7c12d5836a8bf3f8:ieee:clean | structured | csl_rendered | ieee | book-chapter | ieee | article-journal | bookTitle, publisher | isbn, publisher |
| book-chapter-7c12d5836a8bf3f8:mla9:clean | structured | csl_rendered | mla9 | book-chapter | mla9 | article-journal | bookTitle, publisher | isbn, publisher |
| book-chapter-7c12d5836a8bf3f8:vancouver:clean | structured | csl_rendered | vancouver | book-chapter | vancouver | article-journal | bookTitle, publisher | isbn, publisher |
| book-chapter-9cf6ab99ace9bad7:apa7:clean | structured | csl_rendered | apa7 | book-chapter | apa7 | conference-paper | bookTitle, journal/venue | bookTitle, institution |
| book-chapter-9cf6ab99ace9bad7:chicago-notes-bib:clean | structured | csl_rendered | chicago-notes-bib | book-chapter | chicago-notes-bib | conference-paper | bookTitle, journal/venue | bookTitle, institution |
| book-chapter-9cf6ab99ace9bad7:harvard-ctr:clean | structured | csl_rendered | harvard-ctr | book-chapter | harvard-ctr | conference-paper | bookTitle, journal/venue | bookTitle, institution |
| book-chapter-9cf6ab99ace9bad7:ieee:clean | structured | csl_rendered | ieee | book-chapter | ieee | conference-paper | bookTitle, journal/venue | bookTitle, institution |
| book-chapter-9cf6ab99ace9bad7:mla9:clean | structured | csl_rendered | mla9 | book-chapter | mla9 | conference-paper | bookTitle, journal/venue | bookTitle, institution |
