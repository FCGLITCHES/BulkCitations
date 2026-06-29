import { describe, expect, it } from 'vitest';
import { createEmptyExtractedFields } from '../../../src/engine/utils/fields.js';
import { fieldOf } from '../../../src/engine/types/field.js';
import { classifyTypeHeuristically } from '../../../src/engine/utils/type-classification.js';

describe('classifyTypeHeuristically', () => {
  it('does not collapse DOI-bearing journal citations with locators into webpages', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.doi = fieldOf('10.1353/vcr.1997.0036', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1353/vcr.1997.0036', 'regex_fallback', 'test_stage', 0.92);
    fields.title = fieldOf("A Lady's Life in the Rocky Mountains", 'regex_fallback', 'test_stage', 0.9);

    expect(classifyTypeHeuristically({
      fields,
      raw: '[1]I. L. Bird, “A Lady’s Life in the Rocky Mountains,” Victorian Review, vol. 23, no. 2, pp. 167–167, 1997, doi: 10.1353/vcr.1997.0036.',
    })).toBe('article-journal');
  });

  it('classifies In ... (pp.) scholarly references as book chapters instead of webpages', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'The Major Rivers and the Genesis of the Recent Area of Ticks Ixodes persulcatus in Western Siberia',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.doi = fieldOf('10.1007/978-3-030-29061-0_16', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1007/978-3-030-29061-0_16', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Yakimenko, V. V. (2019). The Major Rivers and the Genesis of the Recent Area of Ticks Ixodes persulcatus in Western Siberia. In Parasitology Research Monographs (pp. 367–381). Springer International Publishing.',
    })).toBe('book-chapter');
  });

  it('classifies URL-backed site references as webpages instead of books', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Export of UDP Options Information in IP Flow Information Export (IPFIX)',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2025, 'regex_fallback', 'test_stage', 0.96);
    fields.url = fieldOf('https://www.rfc-editor.org/rfc/rfc9870.html', 'regex_fallback', 'test_stage', 0.92);
    fields.siteName = fieldOf('RFC Editor', 'regex_fallback', 'test_stage', 0.72);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Export of UDP Options Information in IP Flow Information Export (IPFIX). (2025). RFC Editor. https://www.rfc-editor.org/rfc/rfc9870.html',
    })).toBe('webpage');
  });

  it('treats site-name backed online references as webpages even when conferenceTitle spilled from propagation', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Built-in Functions', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2024, 'regex_fallback', 'test_stage', 0.96);
    fields.url = fieldOf(
      'https://docs.python.org/3/library/functions.html',
      'regex_fallback',
      'test_stage',
      0.92,
    );
    fields.siteName = fieldOf('Python Documentation', 'regex_fallback', 'test_stage', 0.82);
    fields.conferenceTitle = fieldOf(
      'Python Documentation. [Online]. Available',
      'regex_fallback',
      'test_stage',
      0.66,
    );

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Python Software Foundation (2024) Built-in Functions, Python Documentation. Python Software Foundation. Available at: https://docs.python.org/3/library/functions.html.',
    })).toBe('webpage');
  });

  it('classifies standards-like institutional citations as reports instead of books', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Lamps for road vehicles. Dimensional, electrical and luminous requirements',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2013, 'regex_fallback', 'test_stage', 0.96);
    fields.url = fieldOf('https://doi.org/10.3403/01032627', 'regex_fallback', 'test_stage', 0.92);
    fields.institution = fieldOf('BSI British Standards', 'regex_fallback', 'test_stage', 0.76);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'BSI British Standards. (2013). Lamps for road vehicles. Dimensional, electrical and luminous requirements. BSI British Standards. https://doi.org/10.3403/01032627',
    })).toBe('report');
  });

  it('classifies Spanish congress publication containers as conference papers instead of books', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Anafilaxia inducida por ejercicio: a propósito de un caso', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2023, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.48158/semg23-144', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.48158/semg23-144', 'regex_fallback', 'test_stage', 0.92);
    fields.conferenceTitle = fieldOf(
      'XXIX Congreso Nacional de Medicina General y de Familia y V Jornadas SEMG Andalucía Abstracts Publication',
      'regex_fallback',
      'test_stage',
      0.84,
    );

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Contreras, M. L., Vargas, J. M., Rodríguez, S., Laserna, C., Esteves, J. A., & Gajate, A. (2023). Anafilaxia inducida por ejercicio: a propósito de un caso. XXIX Congreso Nacional de Medicina General y de Familia y V Jornadas SEMG Andalucía Abstracts Publication. https://doi.org/10.48158/semg23-144',
    })).toBe('conference-paper');
  });

  it('keeps preprints.org and SSRN DOIs in the preprint bucket', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Chilean Student Teachers’ Willingness to Learn with Gamified Systems',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2023, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.20944/preprints202309.0516.v1', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.20944/preprints202309.0516.v1', 'regex_fallback', 'test_stage', 0.92);
    fields.repository = fieldOf('MDPI AG', 'regex_fallback', 'test_stage', 0.82);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Saavedra, E. G. (2023). Chilean Student Teachers’ Willingness to Learn with Gamified Systems. MDPI AG. https://doi.org/10.20944/preprints202309.0516.v1',
    })).toBe('preprint');
  });

  it('does not treat book-title volume text as journal locators', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Coletânea de Legislação Nacional e Internacional sobre Povos e Comunidades Tradicionais: Volume I - Normas Internacionais',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2022, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.48021/978-65-252-3979-8', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.48021/978-65-252-3979-8', 'regex_fallback', 'test_stage', 0.92);
    fields.isbn = fieldOf('9786525239798', 'regex_fallback', 'test_stage', 0.78);
    fields.publisher = fieldOf('Dialética', 'regex_fallback', 'test_stage', 0.72);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'TARREGA, M. C. V. B., SILVA, A. G., & LIMA NETO, R. B. (2022). Coletânea de Legislação Nacional e Internacional sobre Povos e Comunidades Tradicionais: Volume I - Normas Internacionais. Dialética. https://doi.org/10.48021/978-65-252-3979-8',
    })).toBe('book');
  });

  it('keeps Research Square and TechRxiv DOIs in the preprint bucket', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'An effective technique for solving generalized Cahn-Hilliard (C-H) problems',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2023, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.21203/rs.3.rs-2870128/v1', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.21203/rs.3.rs-2870128/v1', 'regex_fallback', 'test_stage', 0.92);
    fields.repository = fieldOf('Research Square Platform LLC', 'regex_fallback', 'test_stage', 0.82);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Hassan, A. et al. (2023). An effective technique for solving generalized Cahn-Hilliard (C-H) problems. Research Square Platform LLC. https://doi.org/10.21203/rs.3.rs-2870128/v1',
    })).toBe('preprint');
  });

  it('does not treat Springer chapter DOIs as conference proceedings by themselves', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Higher Order Neural Networks in a Unified Learning Scheme',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(1993, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1007/978-1-4471-2063-6_187', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1007/978-1-4471-2063-6_187', 'regex_fallback', 'test_stage', 0.92);
    fields.bookTitle = fieldOf("ICANN '93", 'regex_fallback', 'test_stage', 0.82);
    fields.isbn = fieldOf('9781447120636', 'regex_fallback', 'test_stage', 0.78);
    fields.publisher = fieldOf('Springer London', 'regex_fallback', 'test_stage', 0.74);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Bischoff, A., & Schürmann, B. (1993). Higher Order Neural Networks in a Unified Learning Scheme. In ICANN ’93 (pp. 679–682). Springer London. https://doi.org/10.1007/978-1-4471-2063-6_187',
    })).toBe('book-chapter');
  });

  it('keeps Springer proceedings chapters with chapter DOIs in the book-chapter bucket even when the container says proceedings', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Product Development Process Comparison within Automotive Supply Chain',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2012, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1007/978-1-4471-2819-9_4', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1007/978-1-4471-2819-9_4', 'regex_fallback', 'test_stage', 0.92);
    fields.bookTitle = fieldOf('Proceedings of the I-ESA Conferences', 'regex_fallback', 'test_stage', 0.82);
    fields.publisher = fieldOf('Springer London', 'regex_fallback', 'test_stage', 0.74);
    fields.isbn = fieldOf('9781447128199', 'regex_fallback', 'test_stage', 0.78);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Costa, Carlos Alberto, Marcos A. Luciano, Gabriel S. Milan, and Esequiel Berra de Mello. “Product Development Process Comparison within Automotive Supply Chain.” In Proceedings of the I-ESA Conferences. Springer London, 2012. https://doi.org/10.1007/978-1-4471-2819-9_4.',
    })).toBe('book-chapter');
  });

  it('keeps conference proceedings DOIs in the conference-paper bucket when a conference container exists', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Solution to security constrained LFC system using chaos based exponential PSO algorithm',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2016, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1049/cp.2016.1556', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1049/cp.2016.1556', 'regex_fallback', 'test_stage', 0.92);
    fields.conferenceTitle = fieldOf(
      '3rd International Conference on Electrical, Electronics, Engineering Trends, Communication, Optimization and Sciences (EEECOS 2016)',
      'regex_fallback',
      'test_stage',
      0.84,
    );

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Pain, S., & Acharjee, P. (2016). Solution to security constrained LFC system using chaos based exponential PSO algorithm. 3rd International Conference on Electrical, Electronics, Engineering Trends, Communication, Optimization and Sciences (EEECOS 2016). https://doi.org/10.1049/cp.2016.1556',
    })).toBe('conference-paper');
  });

  it('prefers grounded proceedings containers over journal hints that do not appear in the raw citation', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'A CONTRIBUIÇÃO DO ESTÁGIO SUPERVISIONADO DE TERAPIA OCUPACIONAL NA ATENÇÃO BÁSICA PARA O ENSINO APRENDIZADO',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2023, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.51161/ii-conbrasp/15864', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.51161/ii-conbrasp/15864', 'regex_fallback', 'test_stage', 0.92);
    fields.conferenceTitle = fieldOf(
      'Anais do II Congresso Brasileiro de Saúde Pública On-line',
      'regex_fallback',
      'test_stage',
      0.84,
    );
    fields.journal = fieldOf('Revista Multidisciplinar em Saúde', 'regex_fallback', 'test_stage', 0.72);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Acácio, M. da S., MOREIRA, S. L. D. B., SOUZA, M. A. D., BRAGA, T. R. D. S., & REIS, M. C. D. S. (2023). A CONTRIBUIÇÃO DO ESTÁGIO SUPERVISIONADO DE TERAPIA OCUPACIONAL NA ATENÇÃO BÁSICA PARA O ENSINO APRENDIZADO. Anais do II Congresso Brasileiro de Saúde Pública On-line. https://doi.org/10.51161/ii-conbrasp/15864',
    })).toBe('conference-paper');
  });

  it('keeps article-journal routing when symposium wording only appears inside the title and journal locators are grounded', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Opening Comments: from a video address to those attending Ralph Ellison at 100: A Centennial Symposium, March 8, 2014, Oklahoma City, OK',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2015, 'regex_fallback', 'test_stage', 0.96);
    fields.journal = fieldOf('American Studies', 'regex_fallback', 'test_stage', 0.84);
    fields.volume = fieldOf('54', 'regex_fallback', 'test_stage', 0.82);
    fields.issue = fieldOf('3', 'regex_fallback', 'test_stage', 0.82);
    fields.pages = fieldOf('153–156', 'regex_fallback', 'test_stage', 0.82);
    fields.issn = fieldOf('2153-6856', 'regex_fallback', 'test_stage', 0.8);
    fields.conferenceTitle = fieldOf(
      'Opening Comments: from a video address to those attending Ralph Ellison at 100: A Centennial Symposium, March 8,',
      'regex_fallback',
      'test_stage',
      0.7,
    );
    fields.doi = fieldOf('10.1353/ams.2015.0103', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1353/ams.2015.0103', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Callahan, J.F. (2015) “Opening Comments: from a video address to those attending Ralph Ellison at 100: A Centennial Symposium, March 8, 2014, Oklahoma City, OK,” American Studies, 54(3), pp. 153–156. Available at: https://doi.org/10.1353/ams.2015.0103.',
    })).toBe('article-journal');
  });

  it('treats journal-like conferenceTitle spill with locators and issn as article-journal', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      "Lovers' Legends: The Greek Gay Myths by Andrew Calimach (review)",
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2002, 'regex_fallback', 'test_stage', 0.96);
    fields.conferenceTitle = fieldOf(
      'Mouseion: Journal of the Classical Association of Canada',
      'regex_fallback',
      'test_stage',
      0.82,
    );
    fields.volume = fieldOf('46', 'regex_fallback', 'test_stage', 0.82);
    fields.issue = fieldOf('3', 'regex_fallback', 'test_stage', 0.82);
    fields.pages = fieldOf('413–414', 'regex_fallback', 'test_stage', 0.82);
    fields.issn = fieldOf('19135416', 'regex_fallback', 'test_stage', 0.8);
    fields.doi = fieldOf('10.1353/mou.2002.0027', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1353/mou.2002.0027', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Verstraete, B. (2002). Lovers’ Legends: The Greek Gay Myths by Andrew Calimach (review). Mouseion: Journal of the Classical Association of Canada, 46(3), 413–414. https://doi.org/10.1353/mou.2002.0027',
    })).toBe('article-journal');
  });

  it('treats semicolon-style law review containers with locators as article-journal even when conferenceTitle spilled', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2011, 'regex_fallback', 'test_stage', 0.96);
    fields.conferenceTitle = fieldOf('Bond Law Review 2011;23', 'regex_fallback', 'test_stage', 0.82);
    fields.publisher = fieldOf('Bond Law Review', 'regex_fallback', 'test_stage', 0.74);
    fields.volume = fieldOf('23', 'regex_fallback', 'test_stage', 0.82);
    fields.issue = fieldOf('1', 'regex_fallback', 'test_stage', 0.82);
    fields.issn = fieldOf('22024824', 'regex_fallback', 'test_stage', 0.8);
    fields.doi = fieldOf('10.53300/001c.5580', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.53300/001c.5580', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Tiwari, Neeraj. (2011). Merger Under The Regime of Competition Law: A Comparative Study of Indian Legal Framework With EC and UK. Bond Law Review 2011;23(1). https://doi.org/10.53300/001c.5580',
    })).toBe('article-journal');
  });

  it('treats journal-like bookTitle spill with DOI-backed pages as article-journal', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Pathology of Schistosomiasis japonica in Colonic Carcinoma',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2010, 'regex_fallback', 'test_stage', 0.96);
    fields.bookTitle = fieldOf('Pathology Research International', 'regex_fallback', 'test_stage', 0.8);
    fields.pages = fieldOf('1–4', 'regex_fallback', 'test_stage', 0.82);
    fields.doi = fieldOf('10.4061/2010/505436', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.4061/2010/505436', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Lim, C.S. et al. (2010) “Pathology of Schistosomiasis japonica in Colonic Carcinoma”, Pathology Research International, 2010, pp. 1–4. Available at: https://doi.org/10.4061/2010/505436.',
    })).toBe('article-journal');
  });

  it('treats locator-backed journal names spilled into bookTitle as article-journal instead of book-chapter', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Use of Folk Therapy in Congenital Pseudarthrosis of the Tibia',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2015, 'regex_fallback', 'test_stage', 0.96);
    fields.bookTitle = fieldOf('Dong Thap University Journal of Science, (13)', 'regex_fallback', 'test_stage', 0.8);
    fields.pages = fieldOf('100–103', 'regex_fallback', 'test_stage', 0.82);
    fields.doi = fieldOf('10.52714/dthu.13.6.2015.212', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.52714/dthu.13.6.2015.212', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Hoàng, A.Q. (2015) “Use of Folk Therapy in Congenital Pseudarthrosis of the Tibia”, Dong Thap University Journal of Science, (13), pp. 100–103. Available at: https://doi.org/10.52714/dthu.13.6.2015.212.',
    })).toBe('article-journal');
  });

  it('keeps repository-backed preprints out of the conference-paper bucket even when a noisy conferenceTitle leaks in', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      `Majid et al., "'A SWOC Analysis of Online Undergraduate Medical Education and its Impact on Cognitive Outcomes: Cross-Sectional Study' (Preprint),"`,
      'regex_fallback',
      'test_stage',
      0.86,
    );
    fields.year = fieldOf(2023, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.2196/preprints.47303', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.2196/preprints.47303', 'regex_fallback', 'test_stage', 0.92);
    fields.publisher = fieldOf('JMIR Publications Inc', 'regex_fallback', 'test_stage', 0.78);
    fields.institution = fieldOf('JMIR Publications Inc', 'regex_fallback', 'test_stage', 0.76);
    fields.repository = fieldOf('JMIR Publications Inc.', 'regex_fallback', 'test_stage', 0.82);
    fields.conferenceTitle = fieldOf('(Preprint). JMIR Publications Inc', 'regex_fallback', 'test_stage', 0.74);

    expect(classifyTypeHeuristically({
      fields,
      raw: `Majid, H. et al. (2023) "'A SWOC Analysis of Online Undergraduate Medical Education and its Impact on Cognitive Outcomes: Cross-Sectional Study' (Preprint)." JMIR Publications Inc. Available at: https://doi.org/10.2196/preprints.47303.`,
    })).toBe('preprint');
  });

  it('keeps repeated-owner report profiles in the report bucket when conference cues are absent', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('iThenticate Report for version 1', 'regex_fallback', 'test_stage', 0.88);
    fields.year = fieldOf(2023, 'regex_fallback', 'test_stage', 0.96);
    fields.publisher = fieldOf('Microbiology Society', 'regex_fallback', 'test_stage', 0.8);
    fields.institution = fieldOf('Microbiology Society', 'regex_fallback', 'test_stage', 0.8);
    fields.conferenceTitle = fieldOf('Microbiology Society', 'regex_fallback', 'test_stage', 0.72);
    fields.doi = fieldOf('10.1099/acmi.0.000667.v1.2', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1099/acmi.0.000667.v1.2', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Microbiology Society. (2023). iThenticate Report for version 1. Microbiology Society. https://doi.org/10.1099/acmi.0.000667.v1.2',
    })).toBe('report');
  });

  it('promotes recovered conference containers over article-journal routing when the conference title mirrors the venue', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Dauerhaftes Ansprechen auf Olaparib und endokrine Therapie bei einer Patientin mit metastasiertem luminalem Mammakarzinom und gBRCA-Mutation',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2020, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1055/s-0040-1714539', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1055/s-0040-1714539', 'regex_fallback', 'test_stage', 0.92);
    fields.conferenceTitle = fieldOf('Geburtshilfe und Frauenheilkunde', 'regex_fallback', 'test_stage', 0.84);
    fields.journal = fieldOf('Geburtshilfe und Frauenheilkunde', 'regex_fallback', 'test_stage', 0.8);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Elgaafary, S., M. Hlevnjak, M. Schulze, et al. "Dauerhaftes Ansprechen Auf Olaparib Und Endokrine Therapie Bei Einer Patientin Mit Metastasiertem Luminalem Mammakarzinom Und gBRCA-Mutation." Paper presented at Geburtshilfe und Frauenheilkunde. 2020. https://doi.org/10.1055/s-0040-1714539.',
    })).toBe('conference-paper');
  });

  it('does not treat article titles beginning with In as book or conference container cues', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('In Response', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2016, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1213/ane.0000000000001423', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1213/ane.0000000000001423', 'regex_fallback', 'test_stage', 0.92);
    fields.journal = fieldOf('Anesthesia & Analgesia', 'regex_fallback', 'test_stage', 0.82);
    fields.volume = fieldOf('123', 'regex_fallback', 'test_stage', 0.8);
    fields.issue = fieldOf('3', 'regex_fallback', 'test_stage', 0.78);
    fields.pages = fieldOf('799-800', 'regex_fallback', 'test_stage', 0.78);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Birnbach, D. J., Brull, S. J., & Prielipp, R. C. (2016). In Response. Anesthesia & Analgesia, 123(3), 799–800. https://doi.org/10.1213/ane.0000000000001423',
    })).toBe('article-journal');
  });

  it('treats DOI-backed ISBN books with publisher text in journal as books, not article-journal', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Ik bepaal', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2010, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1007/978-90-313-8345-0', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1007/978-90-313-8345-0', 'regex_fallback', 'test_stage', 0.92);
    fields.journal = fieldOf('Bohn Stafleu van Loghum', 'regex_fallback', 'test_stage', 0.72);
    fields.isbn = fieldOf('9789031383450', 'regex_fallback', 'test_stage', 0.78);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Zuidema-Cazemier, J. (2010). Ik bepaal. Bohn Stafleu van Loghum. https://doi.org/10.1007/978-90-313-8345-0',
    })).toBe('book');
  });

  it('does not treat publisher-plus-year spill as an article locator when volume is only the publication year', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Ludwig III. Kurfürst von der Pfalz und das Reich 1410–1427', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(1896, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1515/9783112466384', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1515/9783112466384', 'regex_fallback', 'test_stage', 0.92);
    fields.journal = fieldOf('De Gruyter', 'regex_fallback', 'test_stage', 0.72);
    fields.volume = fieldOf('1896', 'regex_fallback', 'test_stage', 0.72);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Eberhard, Wilhelm. Ludwig III. Kurfürst von der Pfalz und das Reich 1410–1427. De Gruyter, 1896. https://doi.org/10.1515/9783112466384.',
    })).toBe('book');
  });


  it('treats terse venue aliases in bookTitle as conference containers when locators and DOI are present', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Technology status and opportunities of VCSELs', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2003, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1109/iciprm.2002.1014379', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1109/iciprm.2002.1014379', 'regex_fallback', 'test_stage', 0.92);
    fields.bookTitle = fieldOf('IEEE', 'regex_fallback', 'test_stage', 0.82);
    fields.pages = fieldOf('295–297', 'regex_fallback', 'test_stage', 0.8);

    expect(classifyTypeHeuristically({
      fields,
      raw: '[1]K. D. Choquette, “Technology status and opportunities of VCSELs,” IEEE, 2003, pp. 295–297. doi: 10.1109/iciprm.2002.1014379.',
    })).toBe('conference-paper');
  });

  it('does not treat journal-like bookTitle leakage as a conference alias', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf("A Lady's Life in the Rocky Mountains", 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(1997, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1353/vcr.1997.0036', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1353/vcr.1997.0036', 'regex_fallback', 'test_stage', 0.92);
    fields.bookTitle = fieldOf('Victorian Review', 'regex_fallback', 'test_stage', 0.72);
    fields.journal = fieldOf('Victorian Review', 'regex_fallback', 'test_stage', 0.72);
    fields.volume = fieldOf('23', 'regex_fallback', 'test_stage', 0.84);
    fields.issue = fieldOf('2', 'regex_fallback', 'test_stage', 0.82);
    fields.pages = fieldOf('167–167', 'regex_fallback', 'test_stage', 0.8);

    expect(classifyTypeHeuristically({
      fields,
      raw: '[1]I. L. Bird, “A Lady’s Life in the Rocky Mountains,” Victorian Review, vol. 23, no. 2, pp. 167–167, 1997, doi: 10.1353/vcr.1997.0036.',
    })).toBe('article-journal');
  });

  it('does not let a placeholder doi root URL force book records into webpage mode', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Ik bepaal', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2010, 'regex_fallback', 'test_stage', 0.96);
    fields.url = fieldOf('https://doi.org/', 'regex_fallback', 'test_stage', 0.92);
    fields.journal = fieldOf('Bohn Stafleu van Loghum', 'regex_fallback', 'test_stage', 0.72);
    fields.isbn = fieldOf('9789031383450', 'regex_fallback', 'test_stage', 0.78);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Zuidema-Cazemier, J. (2010). Ik bepaal. Bohn Stafleu van Loghum. https://doi.org/',
    })).toBe('book');
  });

  it('prefers thesis when thesis cues coexist with a misleading conferenceTitle field', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Relações interfaciais de poli(dimetilsiloxano) com solidos inorganicos',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2021, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.47749/t/unicamp.1997.133750', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.47749/t/unicamp.1997.133750', 'regex_fallback', 'test_stage', 0.92);
    fields.institution = fieldOf('Universidade Estadual de Campinas', 'regex_fallback', 'test_stage', 0.82);
    fields.thesisType = fieldOf('Dissertation', 'regex_fallback', 'test_stage', 0.84);
    fields.conferenceTitle = fieldOf(
      'Dissertation. Universidade Estadual de Campinas',
      'regex_fallback',
      'test_stage',
      0.6,
    );

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Botter Junior, W. (2021). Relações interfaciais de poli(dimetilsiloxano) com solidos inorganicos. Dissertation. Universidade Estadual de Campinas. https://doi.org/10.47749/t/unicamp.1997.133750.',
    })).toBe('thesis');
  });

  it('treats acronym publisher tails with report-like citation structure as reports instead of conference papers', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Le partage du financement des services de l’agglomération de Montréal en 2020: État des lieux, analyse et éléments de comparaison',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2022, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.54932/cvub5177', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.54932/cvub5177', 'regex_fallback', 'test_stage', 0.92);
    fields.publisher = fieldOf('CIRANO', 'regex_fallback', 'test_stage', 0.76);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Vaillancourt, F., & Magnan, M. (2022). Le partage du financement des services de l’agglomération de Montréal en 2020: État des lieux, analyse et éléments de comparaison. CIRANO. https://doi.org/10.54932/cvub5177',
    })).toBe('report');
  });

  it('treats siteName plus a plain web URL as a webpage even when quoted-title styles look container-like', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Array.Prototype.Map().', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2024, 'regex_fallback', 'test_stage', 0.96);
    fields.url = fieldOf(
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map',
      'regex_fallback',
      'test_stage',
      0.92,
    );
    fields.siteName = fieldOf('MDN Web Docs', 'regex_fallback', 'test_stage', 0.8);
    fields.publisher = fieldOf('MDN Web Docs', 'regex_fallback', 'test_stage', 0.7);
    fields.institution = fieldOf('Mozilla Contributors', 'regex_fallback', 'test_stage', 0.7);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Mozilla Contributors. “Array.Prototype.Map().” MDN Web Docs, Mozilla Contributors, 2024, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map.',
    })).toBe('webpage');
  });

  it('does not let webpage site names carried in bookTitle drift into the report bucket', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'The Transport Layer Security (TLS) Protocol Version 1.3',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2018, 'regex_fallback', 'test_stage', 0.96);
    fields.url = fieldOf('https://www.rfc-editor.org/rfc/rfc8446', 'regex_fallback', 'test_stage', 0.92);
    fields.siteName = fieldOf('RFC Editor', 'regex_fallback', 'test_stage', 0.82);
    fields.bookTitle = fieldOf('RFC Editor', 'regex_fallback', 'test_stage', 0.74);
    fields.institution = fieldOf('Internet Engineering Task Force', 'regex_fallback', 'test_stage', 0.76);
    fields.publisher = fieldOf('Internet Engineering Task Force', 'regex_fallback', 'test_stage', 0.72);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Internet Engineering Task Force. “The Transport Layer Security (TLS) Protocol Version 1.3.” RFC Editor, Internet Engineering Task Force, 2018. https://www.rfc-editor.org/rfc/rfc8446.',
    })).toBe('webpage');
  });

  it('prefers webpages over reports when quoted-title web citations carry repeated owner names', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('State: A Component’s Memory', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2024, 'regex_fallback', 'test_stage', 0.96);
    fields.url = fieldOf('https://react.dev/learn/state-a-components-memory', 'regex_fallback', 'test_stage', 0.92);
    fields.siteName = fieldOf('React', 'regex_fallback', 'test_stage', 0.82);
    fields.bookTitle = fieldOf('React', 'regex_fallback', 'test_stage', 0.74);
    fields.institution = fieldOf('React Team', 'regex_fallback', 'test_stage', 0.76);
    fields.publisher = fieldOf('React Team', 'regex_fallback', 'test_stage', 0.72);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'React Team. “State: A Component’s Memory.” React, React Team, 2024. https://react.dev/learn/state-a-components-memory.',
    })).toBe('webpage');
  });

  it('treats repeated institutional owners with short continuation fragments as reports instead of book chapters', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Lamps for road vehicles. Dimensional, electrical and luminous requirements',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2013, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.3403/01032627', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.3403/01032627', 'regex_fallback', 'test_stage', 0.92);
    fields.bookTitle = fieldOf('Dimensional', 'regex_fallback', 'test_stage', 0.6);
    fields.institution = fieldOf('BSI British Standards', 'regex_fallback', 'test_stage', 0.76);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'BSI British Standards. (2013). Lamps for road vehicles. Dimensional, electrical and luminous requirements. BSI British Standards. https://doi.org/10.3403/01032627',
    })).toBe('report');
  });

  it('treats bare non-publisher proceedings containers with DOIs as conference papers instead of books', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Multi-robot Synchronous Control Based on Multi-thread',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2018, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.2991/cmsa-18.2018.71', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.2991/cmsa-18.2018.71', 'regex_fallback', 'test_stage', 0.92);
    fields.publisher = fieldOf('Advances in Intelligent Systems Research', 'regex_fallback', 'test_stage', 0.72);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Xiong, P., Long, B., Lu, Z., Liu, X., & Jiang, Y. (2018). Multi-robot Synchronous Control Based on Multi-thread. Advances in Intelligent Systems Research. https://doi.org/10.2991/cmsa-18.2018.71',
    })).toBe('conference-paper');
  });

  it('keeps institutional publisher groups in the report bucket instead of downgrading them to books', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Side-by-Side Comparison of Six Recommendations Solutions', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2010, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1571/ca11-11-10cc', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1571/ca11-11-10cc', 'regex_fallback', 'test_stage', 0.92);
    fields.institution = fieldOf('Patricia Seybold Group', 'regex_fallback', 'test_stage', 0.8);
    fields.publisher = fieldOf('Patricia Seybold Group', 'regex_fallback', 'test_stage', 0.74);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Aldrich, S. (2010). Side-by-Side Comparison of Six Recommendations Solutions. Patricia Seybold Group. https://doi.org/10.1571/ca11-11-10cc',
    })).toBe('report');
  });

  it('treats institutional journal echoes with repeated owners as reports instead of article-journal citations', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Practice for Selection of Blood for in vitro Evaluation of Blood Pumps', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2013, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1520/f1830-97r13', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1520/f1830-97r13', 'regex_fallback', 'test_stage', 0.92);
    fields.journal = fieldOf('ASTM International', 'regex_fallback', 'test_stage', 0.74);
    fields.institution = fieldOf('ASTM International', 'regex_fallback', 'test_stage', 0.84);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'ASTM International. (2013). Practice for Selection of Blood for in vitro Evaluation of Blood Pumps. ASTM International. https://doi.org/10.1520/f1830-97r13',
    })).toBe('report');
  });

  it('classifies bare patent identifiers and patent urls as patents instead of unknown', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Web page ranking for page query across public and private', 'regex_fallback', 'test_stage', 0.84);
    fields.year = fieldOf(2006, 'regex_fallback', 'test_stage', 0.96);
    fields.url = fieldOf('https://patents.google.com/patent/US20060235842A1/en', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: '[1]Web page ranking for page query across public and private. US20060235842A1, 2006.',
    })).toBe('patent');
  });

  it('does not let SSRN DOI preprints drift into conference or book buckets', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2023, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.2139/ssrn.4577205', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.2139/ssrn.4577205', 'regex_fallback', 'test_stage', 0.92);
    fields.repository = fieldOf('Elsevier BV', 'regex_fallback', 'test_stage', 0.82);

    expect(classifyTypeHeuristically({
      fields,
      raw: '[1]Awang NA, Mahmud NNHEBN, Zulkefli NUHH. Optical Trapping Using Mode-Locked Fiber Laser Au-Np Coated Side-Polished Fiber 2023. https://doi.org/10.2139/ssrn.4577205.',
    })).toBe('preprint');
  });

  it('does not let conference DOIs with patent-like suffixes collapse conference papers into patents', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Decomposing the implementation of complex engineering problem-solving skills on Python-based artificial intelligence and big data',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2022, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.59499/ep235765321', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.59499/ep235765321', 'regex_fallback', 'test_stage', 0.92);
    fields.conferenceTitle = fieldOf(
      'International Organization Center of Academic Research',
      'regex_fallback',
      'test_stage',
      0.82,
    );

    expect(classifyTypeHeuristically({
      fields,
      raw: '[1]Li D, Zhang B. DECOMPOSING THE IMPLEMENTATION OF COMPLEX ENGINEERING PROBLEM-SOLVING SKILLS ON PYTHON-BASED ARTIFICIAL INTELLIGENCE AND BIG DATA, International Organization Center of Academic Research; 2022. https://doi.org/10.59499/ep235765321.',
    })).toBe('conference-paper');
  });

  it('does not treat title-embedded year ranges as article pages for DOI-backed books', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('English Women’s Spiritual Utopias, 1400-1700', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2024, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1007/978-3-031-61854-3', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1007/978-3-031-61854-3', 'regex_fallback', 'test_stage', 0.92);
    fields.publisher = fieldOf('Springer International Publishing', 'regex_fallback', 'test_stage', 0.82);
    fields.pages = fieldOf('1400–1700', 'regex_fallback', 'test_stage', 0.55);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Verini, S. (2024). English Women’s Spiritual Utopias, 1400-1700. Springer International Publishing. https://doi.org/10.1007/978-3-031-61854-3',
    })).toBe('book');
  });

  it('keeps geophysical abstracts survey citations in the report bucket', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Geophysical abstracts', 'regex_fallback', 'test_stage', 0.9);
    fields.publisher = fieldOf('US Geological Survey', 'regex_fallback', 'test_stage', 0.82);
    fields.year = fieldOf(1955, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.3133/70194121', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.3133/70194121', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Smith, J. Geophysical abstracts. US Geological Survey; 1955. https://doi.org/10.3133/70194121',
    })).toBe('report');
  });

  it('does not let review articles with strong journal locators drift into the report bucket', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Curiosity House: The Shrunken Head by Lauren Oliver (review)',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2015, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1353/bcc.2015.0839', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1353/bcc.2015.0839', 'regex_fallback', 'test_stage', 0.92);
    fields.journal = fieldOf("Bulletin of the Center for Children's Books", 'regex_fallback', 'test_stage', 0.82);
    fields.volume = fieldOf('69', 'regex_fallback', 'test_stage', 0.8);
    fields.issue = fieldOf('3', 'regex_fallback', 'test_stage', 0.8);
    fields.pages = fieldOf('158-158', 'regex_fallback', 'test_stage', 0.8);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Quealy-Gainer, K. (2015) “Curiosity House: The Shrunken Head by Lauren Oliver (review),” Bulletin of the Center for Children’s Books, 69(3), pp. 158–158. Available at: https://doi.org/10.1353/bcc.2015.0839.',
    })).toBe('article-journal');
  });

  it('treats legacy Springer chapter DOIs as book chapters even when the only container spill is journal-like', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Molecular diagnostics of inherited retinal dystrophies', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2003, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.1007/1-4020-0614-4_85', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1007/1-4020-0614-4_85', 'regex_fallback', 'test_stage', 0.92);
    fields.publisher = fieldOf('Springer Netherlands', 'regex_fallback', 'test_stage', 0.82);
    fields.journal = fieldOf('Advances in Experimental Medicine and Biology', 'regex_fallback', 'test_stage', 0.76);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'den Hollander AI. Molecular diagnostics of inherited retinal dystrophies. Advances in Experimental Medicine and Biology. Springer Netherlands; 2003. https://doi.org/10.1007/1-4020-0614-4_85.',
    })).toBe('book-chapter');
  });

  it('does not treat placeholder DOI host stubs in raw text as meaningful webpage URLs', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('English Women’s Spiritual Utopias, 1400-1700', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2024, 'regex_fallback', 'test_stage', 0.96);
    fields.publisher = fieldOf('Springer International Publishing', 'regex_fallback', 'test_stage', 0.82);
    fields.url = fieldOf('https://doi.org/.', 'regex_fallback', 'test_stage', 0.4);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Verini, S. (2024). English Women’s Spiritual Utopias, 1400-1700. Springer International Publishing. https://doi.org/.',
    })).toBe('book');
  });

  it('does not let book-series titles beginning with Studies in override strong book-chapter signals', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('The Effects of a Right of Withdrawal on Consumers’ Willingness to Purchase Online', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2020, 'regex_fallback', 'test_stage', 0.96);
    fields.bookTitle = fieldOf('Studies in European Economic Law and Regulation', 'regex_fallback', 'test_stage', 0.86);
    fields.publisher = fieldOf('Springer International Publishing', 'regex_fallback', 'test_stage', 0.82);
    fields.pages = fieldOf('71–113', 'regex_fallback', 'test_stage', 0.8);
    fields.isbn = fieldOf('9783030540012', 'regex_fallback', 'test_stage', 0.82);
    fields.doi = fieldOf('10.1007/978-3-030-54001-2_3', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.1007/978-3-030-54001-2_3', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Wallinga, M. (2020). The Effects of a Right of Withdrawal on Consumers’ Willingness to Purchase Online. Studies in European Economic Law and Regulation. Springer International Publishing, pp. 71–113. Available at: https://doi.org/10.1007/978-3-030-54001-2_3.',
    })).toBe('book-chapter');
  });

  it('ignores PMID-sized webpage locator spill when a real RFC webpage URL is present', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('The Transport Layer Security (TLS) Protocol Version 1.3', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2018, 'regex_fallback', 'test_stage', 0.96);
    fields.journal = fieldOf('Internet Engineering Task Force', 'regex_fallback', 'test_stage', 0.76);
    fields.siteName = fieldOf('RFC Editor', 'regex_fallback', 'test_stage', 0.82);
    fields.institution = fieldOf('https://www.rfc-editor.org/rfc/rfc8446 PMID:99999999', 'regex_fallback', 'test_stage', 0.4);
    fields.pages = fieldOf('99999999', 'regex_fallback', 'test_stage', 0.4);
    fields.pmid = fieldOf('99999999', 'regex_fallback', 'test_stage', 0.96);
    fields.url = fieldOf('https://www.rfc-editor.org/rfc/rfc8446', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Internet Engineering Task Force. (2018). The Transport Layer Security (TLS) Protocol Version 1.3. Internet Engineering Task Force. RFC Editor. https://www.rfc-editor.org/rfc/rfc8446 PMID:99999999',
    })).toBe('webpage');
  });

  it('prefers webpages over article-journal when the journal field only echoes the site and owner labels', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('Web Content Accessibility Guidelines (WCAG) 2.2', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(2023, 'regex_fallback', 'test_stage', 0.96);
    fields.url = fieldOf('https://www.w3.org/TR/WCAG22/', 'regex_fallback', 'test_stage', 0.92);
    fields.institution = fieldOf('World Wide Web Consortium', 'regex_fallback', 'test_stage', 0.82);
    fields.siteName = fieldOf('W3C', 'regex_fallback', 'test_stage', 0.82);
    fields.journal = fieldOf('W3C, World Wide Web Consortium', 'regex_fallback', 'test_stage', 0.68);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'World Wide Web Consortium. (2023). Web Content Accessibility Guidelines (WCAG) 2.2. World Wide Web Consortium. W3C. https://www.w3.org/TR/WCAG22/',
    })).toBe('webpage');
  });

  it('keeps isbn-backed institutional annual reports in the book bucket', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf('International Monetary Fund Annual Report 1986', 'regex_fallback', 'test_stage', 0.9);
    fields.year = fieldOf(1986, 'regex_fallback', 'test_stage', 0.96);
    fields.doi = fieldOf('10.5089/9781616351984.011', 'regex_fallback', 'test_stage', 0.98);
    fields.url = fieldOf('https://doi.org/10.5089/9781616351984.011', 'regex_fallback', 'test_stage', 0.92);
    fields.isbn = fieldOf('9781616351984', 'regex_fallback', 'test_stage', 0.82);
    fields.journal = fieldOf('International Monetary Fund', 'regex_fallback', 'test_stage', 0.72);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'International Monetary Fund. (1986). International Monetary Fund Annual Report 1986. International Monetary Fund. https://doi.org/10.5089/9781616351984.011',
    })).toBe('book');
  });

  it('treats sparse preprint owner profiles with placeholder DOI tails as preprints instead of books', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Ripv1, a potential antibacterial protein encoded in the common potato',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2023, 'regex_fallback', 'test_stage', 0.96);
    fields.publisher = fieldOf('Elsevier BV', 'regex_fallback', 'test_stage', 0.82);
    fields.url = fieldOf('https://doi.org/', 'regex_fallback', 'test_stage', 0.35);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Chen, H., Zeng, Y., Yang, Y., Zhang, S., Li, J., Li, Y., Zhang, J., & Zhao, B. (2023). Ripv1, a potential antibacterial protein encoded in the common potato. Elsevier BV. https://doi.org/',
    })).toBe('preprint');
  });

  it('prefers thesis over webpage when accented thesis and access cues coexist with a DOI URL', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Relações interfaciais de poli(dimetilsiloxano) com sólidos inorgânicos',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2021, 'regex_fallback', 'test_stage', 0.96);
    fields.siteName = fieldOf('Avàilàblé àt', 'regex_fallback', 'test_stage', 0.42);
    fields.publisher = fieldOf(
      'Univérsidàdé Estàduàl dé Càmpinàs, Dissértàtion',
      'regex_fallback',
      'test_stage',
      0.5,
    );
    fields.url = fieldOf(
      'https://doi.org/10.47749/t/unicamp.1997.133750',
      'regex_fallback',
      'test_stage',
      0.92,
    );

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Botter Junior, W. (2021). Relações interfaciais de poli(dimetilsiloxano) com sólidos inorgânicos. Dissértàtion. Univérsidàdé Estàduàl dé Càmpinàs. Avàilàblé àt: https://doi.org/10.47749/t/unicamp.1997.133750.',
    })).toBe('thesis');
  });

  it('ignores RFC locator artifacts that look like bare PMID-sized page numbers even without a pmid field', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Export of UDP Options Information in IP Flow Information Export (IPFIX)',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2025, 'regex_fallback', 'test_stage', 0.96);
    fields.siteName = fieldOf('RFC Editor', 'regex_fallback', 'test_stage', 0.82);
    fields.institution = fieldOf('Internet Engineering Task Force', 'regex_fallback', 'test_stage', 0.8);
    fields.pages = fieldOf('99999999', 'regex_fallback', 'test_stage', 0.35);
    fields.url = fieldOf(
      'https://www.rfc-editor.org/rfc/rfc9870.html',
      'regex_fallback',
      'test_stage',
      0.92,
    );

    expect(classifyTypeHeuristically({
      fields,
      raw: 'Internet Engineering Task Force. (2025). Export of UDP Options Information in IP Flow Information Export (IPFIX). RFC Editor. https://www.rfc-editor.org/rfc/rfc9870.html 99999999',
    })).toBe('webpage');
  });

  it('treats accented standards-style conference spill as report evidence instead of conference evidence', () => {
    const fields = createEmptyExtractedFields('test_stage', 'regex_fallback');
    fields.title = fieldOf(
      'Practice for Selection of Blood for in vitro Evaluation of Blood Pumps',
      'regex_fallback',
      'test_stage',
      0.9,
    );
    fields.year = fieldOf(2013, 'regex_fallback', 'test_stage', 0.96);
    fields.publisher = fieldOf('ASTM Intérnàtionàl', 'regex_fallback', 'test_stage', 0.84);
    fields.conferenceTitle = fieldOf('ASTM Spécificàtion F1830', 'regex_fallback', 'test_stage', 0.48);
    fields.url = fieldOf('https://doi.org/10.1520/f1830-97r13', 'regex_fallback', 'test_stage', 0.92);

    expect(classifyTypeHeuristically({
      fields,
      raw: 'ASTM Intérnàtionàl. (2013). Practice for Selection of Blood for in vitro Evaluation of Blood Pumps. ASTM Spécificàtion F1830. ASTM Intérnàtionàl. https://doi.org/10.1520/f1830-97r13.',
    })).toBe('report');
  });
});
