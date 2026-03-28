import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAdapters } from './adapters.js';
import { parseAuthorsForStyle } from './utils.js';

const { extractor, classifier } = createDefaultAdapters();

describe('default extractor institutional heuristics', () => {
  afterEach(() => {
    delete process.env.ENABLE_LLM_EXTRACTOR;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_EXTRACT_MODEL;
    vi.unstubAllGlobals();
  });

  it('extracts corporate report references into title, year, and institution', async () => {
    const result = await extractor.extract(
      'World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization; 2023.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.authors).toEqual(['World Health Organization']);
    expect(result.parsed.title).toBe('Global tuberculosis report 2023');
    expect(result.parsed.year).toBe('2023');
    expect(result.parsed.publisher).toBe('World Health Organization');
    expect(result.parsed.institution).toBe('World Health Organization');
    expect(result.fieldConfidence.authors).toBeGreaterThanOrEqual(0.9);
    expect(result.fieldConfidence.publisher).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps guideline identifiers out of the main title', async () => {
    const result = await extractor.extract(
      'National Institute for Health and Care Excellence. Depression in adults: treatment and management. NICE Guideline [NG222]. London: NICE; 2022.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.title).toBe('Depression in adults: treatment and management');
    expect(result.parsed.edition).toBe('NICE Guideline [NG222]');
    expect(result.parsed.publisher).toBe('NICE');
    expect(result.parsed.year).toBe('2022');
  });

  it('extracts website-like institutional references with available-from URLs', async () => {
    const result = await extractor.extract(
      'OpenAI. GPT-5.1 system card. 2026. Available from: https://openai.com/research/gpt-5-1.',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('website');
    expect(result.parsed.title).toBe('GPT-5.1 system card');
    expect(result.parsed.year).toBe('2026');
    expect(result.parsed.url).toBe('https://openai.com/research/gpt-5-1');
    expect(result.fieldConfidence.title).toBeGreaterThanOrEqual(0.9);
  });

  it('treats title-led website references as titles instead of inventing corporate authors', async () => {
    const result = await extractor.extract(
      'Intelligent clinical trials. (2020). https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-trials/DI_Intelligent-clinical-.',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('website');
    expect(result.parsed.title).toBe('Intelligent clinical trials');
    expect(result.parsed.year).toBe('2020');
    expect(result.parsed.url).toBe('https://www2.deloitte.com/content/dam/insights/us/articles/22934_intelligent-clinical-trials/DI_Intelligent-clinical-');
    expect(result.parsed.authors ?? []).toHaveLength(0);
  });

  it('keeps wrapped scholarly website references as website records with a clean title, full URL, and derived DOI hint', async () => {
    const result = await extractor.extract(
      'Tapping into the drug discovery potential of AI . (2021). https://www.nature.com/articles/d43747-021-\n00045-7.',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('website');
    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.parsed.title).toBe('Tapping into the drug discovery potential of AI');
    expect(result.parsed.year).toBe('2021');
    expect(result.parsed.url).toBe('https://www.nature.com/articles/d43747-021-00045-7');
    expect(result.parsed.doi).toBe('10.1038/d43747-021-00045-7');
    expect(result.parsed.authors ?? []).toHaveLength(0);
    expect(result.fieldConfidence.authors).toBeLessThanOrEqual(0.2);
  });

  it('extracts harvard website references with viewed dates as websites without leaking the access tail into the title', async () => {
    const result = await extractor.extract(
      "Therapeutic Signals Lab 2023, 'Dose response ranking for translational pharmacology: case SDE-HVW-001', Pharmacology Standards Network, viewed 22 Mar 2026. Available at: https://stress.example.org/hvw/071.",
      'auto',
      {},
    );

    expect(result.referenceType).toBe('website');
    expect(result.parsed.authors).toEqual(['Therapeutic Signals Lab']);
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-HVW-001');
    expect(result.parsed.year).toBe('2023');
    expect(result.parsed.url).toBe('https://stress.example.org/hvw/071');
    expect(result.parsed.institution).toBe('Pharmacology Standards Network');
  });

  it('extracts chicago notes website references with quoted titles as websites instead of journals', async () => {
    const result = await extractor.extract(
      'Center for Translational Therapeutics. "Dose response ranking for translational pharmacology: case SDE-CNW-001." Drug Evidence Hub. Accessed 22 Mar 2026. https://stress.example.org/cnw/121.',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('website');
    expect(result.parsed.authors).toEqual(['Center for Translational Therapeutics']);
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-CNW-001');
    expect(result.parsed.year).toBeUndefined();
    expect(result.parsed.url).toBe('https://stress.example.org/cnw/121');
    expect(result.parsed.journal).toBeUndefined();
    expect(result.parsed.institution).toBe('Drug Evidence Hub');
  });

  it('keeps chicago author-date institutional report tails out of website false positives', async () => {
    const result = await extractor.extract(
      'Precision Molecule Institute. 2017. Dose response ranking for translational pharmacology: case SDE-CDR-001. Toronto: Open Metrics Press. https://stress.example.org/cdr/101',
      'chicago',
      { detectionConfidence: 0.93 },
    );

    expect(result.referenceType).toBe('report');
    expect(result.parsed.authors).toEqual(['Precision Molecule Institute']);
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-CDR-001');
    expect(result.parsed.year).toBe('2017');
    expect(result.parsed.publisher).toBe('Open Metrics Press');
    expect(result.parsed.placeOfPublication).toBe('Toronto');
    expect(result.parsed.url).toBe('https://stress.example.org/cdr/101');
  });

  it('extracts IEEE manual-style website references as websites and keeps the version separate from the title', async () => {
    const result = await extractor.extract(
      '[181] National Dosing Review Office, "Dose response ranking for translational pharmacology: case SDE-IEW-001," Drug Evidence Hub, ver. 2.0, 2013. [Online]. Available: https://stress.example.org/iew/181',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('website');
    expect(result.parsed.authors).toEqual(['National Dosing Review Office']);
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-IEW-001');
    expect(result.parsed.year).toBe('2013');
    expect(result.parsed.url).toBe('https://stress.example.org/iew/181');
    expect(result.parsed.institution).toBe('Drug Evidence Hub');
    expect(result.parsed.edition).toBe('ver. 2.0');
  });

  it('detects IEEE quoted website manuals as IEEE instead of drifting to APA', async () => {
    const reference = '[182] Precision Molecule Institute, "Trial design routing for preclinical analytics: case SDE-IEW-002," Adaptive Methods Portal, ver. 3.1, 2015. [Online]. Available: https://stress.example.org/iew/182';
    const detection = await classifier.detectStyle(reference);
    const result = await extractor.extract(
      reference,
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('ieee');
    expect(result.detectedStyle).toBe('ieee');
    expect(result.referenceType).toBe('website');
    expect(result.parsed.authors).toEqual(['Precision Molecule Institute']);
    expect(result.parsed.title).toBe('Trial design routing for preclinical analytics: case SDE-IEW-002');
    expect(result.parsed.institution).toBe('Adaptive Methods Portal');
    expect(result.parsed.edition).toBe('ver. 3.1');
  });

  it('extracts APA corporate report author-year references into report metadata instead of collapsing them into website fields', async () => {
    const result = await extractor.extract(
      'Clinical Design Observatory (2021). Dose response ranking for translational pharmacology: case SDE-APAR-001 (Report No. APAR-RPT-001). Toronto: Blue Harbor Research. https://stress.example.org/apar/021',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.authors).toEqual(['Clinical Design Observatory']);
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-APAR-001');
    expect(result.parsed.year).toBe('2021');
    expect(result.parsed.publisher).toBe('Blue Harbor Research');
    expect(result.parsed.placeOfPublication).toBe('Toronto');
    expect(result.parsed.url).toBe('https://stress.example.org/apar/021');
    expect(result.parsed.edition).toBe('Report No. APAR-RPT-001');
  });

  it('detects APA corporate unit reports as APA and keeps the report branch selected', async () => {
    const reference = 'Global Trial Methods Unit (2023). Trial design routing for preclinical analytics: case SDE-APAR-002 (Report No. APAR-RPT-002). Amsterdam: Open Metrics Press. https://stress.example.org/apar/022';
    const detection = await classifier.detectStyle(reference);
    const result = await extractor.extract(
      reference,
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('apa');
    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.authors).toEqual(['Global Trial Methods Unit']);
    expect(result.parsed.title).toBe('Trial design routing for preclinical analytics: case SDE-APAR-002');
    expect(result.parsed.publisher).toBe('Open Metrics Press');
    expect(result.parsed.placeOfPublication).toBe('Amsterdam');
    expect(result.parsed.edition).toBe('Report No. APAR-RPT-002');
  });

  it('extracts simple MLA book tails without a place of publication', async () => {
    const result = await extractor.extract(
      'Novak, Pavel. Dose response ranking for translational pharmacology: case SDE-MLB-001. Blue Harbor Research, 2021.',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('book');
    expect(result.parsed.authors).toEqual(['Novak, P.']);
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-MLB-001');
    expect(result.parsed.year).toBe('2021');
    expect(result.parsed.publisher).toBe('Blue Harbor Research');
    expect(result.parsed.placeOfPublication).toBeUndefined();
  });

  it('extracts two-word institutional report authors instead of collapsing them into the title', async () => {
    const result = await extractor.extract(
      'United Nations. The sustainable development goals report 2023. New York: United Nations; 2023.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.authors).toEqual(['United Nations']);
    expect(result.parsed.title).toBe('The sustainable development goals report 2023');
    expect(result.parsed.publisher).toBe('United Nations');
    expect(result.parsed.year).toBe('2023');
  });

  it('keeps guideline-like report titles as titles instead of misclassifying them as metadata', async () => {
    const result = await extractor.extract(
      'European Medicines Agency. Guideline on medical literature monitoring. Amsterdam: EMA; 2020.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.parsed.authors).toEqual(['European Medicines Agency']);
    expect(result.parsed.title).toBe('Guideline on medical literature monitoring');
    expect(result.parsed.publisher).toBe('EMA');
    expect(result.parsed.year).toBe('2020');
  });

  it('extracts acronym-led organizations and preserves their report titles', async () => {
    const result = await extractor.extract(
      'UN Women. Progress of the world’s women 2019–2020: families in a changing world. New York: UN Women; 2019.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('institutional_heuristic_raw');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.authors).toEqual(['UN Women']);
    expect(result.parsed.title).toBe("Progress of the world's women 2019-2020: families in a changing world");
    expect(result.parsed.publisher).toBe('UN Women');
    expect(result.parsed.year).toBe('2019');
  });

  it('keeps version metadata separate from handbook titles in institutional book-like references', async () => {
    const result = await extractor.extract(
      'Cochrane Collaboration. Cochrane handbook for systematic reviews of interventions. Version 6.3; 2022.',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('book');
    expect(result.parsed.authors).toEqual(['Cochrane Collaboration']);
    expect(result.parsed.title).toBe('Cochrane handbook for systematic reviews of interventions');
    expect(result.parsed.edition).toBe('Version 6.3');
    expect(result.parsed.year).toBe('2022');
  });

  it('repairs mojibake before extraction so diacritics and page ranges survive parsing', async () => {
    const result = await extractor.extract(
      'LÃ³pez, C., FernÃ¡ndez, J., & RamÃ­rez, E. (2010). Mrna vaccine technology: mechanisms and applications. Cell, 70(7), 113â€“730. https://doi.org/10.1007/s10994-021-06047-x',
      'auto',
      {},
    );

    const canonicalAuthors = parseAuthorsForStyle(result.parsed.authors ?? [], 'apa').authors;

    expect(canonicalAuthors).toMatchObject([
      { last: 'López', initials: 'C.' },
      { last: 'Fernández', initials: 'J.' },
      { last: 'Ramírez', initials: 'E.' },
    ]);
    expect(result.parsed.pages).toBe('113-730');
  });

  it('keeps acronym-led group authors intact after extractor pre-normalization', async () => {
    const result = await extractor.extract(
      'IBM Research Team (2019). Explainable artificial intelligence: a systematic review. Environmental Science & Technology, 63(3), 98â€“652. https://doi.org/10.1001/jama.2021.1234',
      'auto',
      {},
    );

    const canonicalAuthors = parseAuthorsForStyle(result.parsed.authors ?? [], 'apa').authors;

    expect(canonicalAuthors).toContainEqual(expect.objectContaining({
      literal: 'IBM Research Team',
      last: 'IBM Research Team',
    }));
    expect(result.parsed.pages).toBe('98-652');
  });

  it('rescues Vancouver-style author-colon-title references into structured journal metadata', async () => {
    const result = await extractor.extract(
      'Skalic M, Jiménez J, Sabbadin D, De Fabritiis G: Shape-based generative modeling for de novo drug design. J Chem Inf Model. 2019, 59:1205-14. 10.1021/acs.jcim.8b00706',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('journal');
    expect(result.parsed.authors).toEqual(['Skalic M', 'Jiménez J', 'Sabbadin D', 'De Fabritiis G']);
    expect(result.parsed.title).toBe('Shape-based generative modeling for de novo drug design');
    expect(result.parsed.journal).toBe('J Chem Inf Model');
    expect(result.parsed.year).toBe('2019');
    expect(result.parsed.volume).toBe('59');
    expect(result.parsed.pages).toBe('1205-14');
    expect(result.parsed.doi).toBe('10.1021/acs.jcim.8b00706');
  });

  it('prioritizes strong colon-led Vancouver detection even when the input is numbered and multiline', async () => {
    const result = await extractor.extract(
      '16. Skalic M, Jiménez J, Sabbadin D, De Fabritiis G: Shape-based generative modeling for de novo drug design . J\nChem Inf Model. 2019, 59:1205-14. 10.1021/acs.jcim.8b00706',
      'auto',
      {},
    );

    expect(result.parsed.authors).toEqual(['Skalic M', 'Jiménez J', 'Sabbadin D', 'De Fabritiis G']);
    expect(result.parsed.title).toBe('Shape-based generative modeling for de novo drug design');
    expect(result.parsed.journal).toBe('J Chem Inf Model');
    expect(result.parsed.year).toBe('2019');
    expect(result.fieldConfidence.authors).toBeGreaterThanOrEqual(0.88);
  });

  it('repairs broken year-volume tails and hyphen-wrapped DOIs before journal extraction', async () => {
    const natMed = await extractor.extract(
      'Cruz Rivera S, Liu X, Chan AW, Denniston AK, Calvert MJ: Guidelines for clinical trial protocols for interventions involving artificial intelligence: the SPIRIT-AI extension. Nat Med. 2020â€, 26:1351-6â€3. 10.1038/s41591-020-1037-7',
      'auto',
      {},
    );
    expect(natMed.referenceType).toBe('journal');
    expect(natMed.parsed.title).toBe('Guidelines for clinical trial protocols for interventions involving artificial intelligence: the SPIRIT-AI extension');
    expect(natMed.parsed.journal).toBe('Nat Med');
    expect(natMed.parsed.year).toBe('2020');
    expect(natMed.parsed.volume).toBe('26');
    expect(natMed.parsed.pages).toBe('1351-63');
    expect(natMed.parsed.doi).toBe('10.1038/s41591-020-1037-7');

    const splitDoi = await extractor.extract(
      'Rodríguez-Pérez R, Bajorath J: Evolution of support vector machine and regression modeling in chemoinformatics and drug discovery. J Comput Aided Mol Des. 2022, 36:355-62. 10.1007/s10822-022- 00442-9',
      'auto',
      {},
    );
    expect(splitDoi.referenceType).toBe('journal');
    expect(splitDoi.parsed.title).toBe('Evolution of support vector machine and regression modeling in chemoinformatics and drug discovery');
    expect(splitDoi.parsed.journal).toBe('J Comput Aided Mol Des');
    expect(splitDoi.parsed.year).toBe('2022');
    expect(splitDoi.parsed.volume).toBe('36');
    expect(splitDoi.parsed.pages).toBe('355-62');
    expect(splitDoi.parsed.doi).toBe('10.1007/s10822-022-00442-9');
  });

  it('extracts quoted-title journal article locators before the deterministic parser can collapse them into the title', async () => {
    const result = await extractor.extract(
      'Page, Matthew J, Joanne E McKenzie, Patrick M Bossuyt. "The PRISMA 2020 statement: an updated guideline for reporting systematic reviews." BMJ 372 (2021): n71.',
      'auto',
      {},
    );

    expect(result.parsed.title).toBe('The PRISMA 2020 statement: an updated guideline for reporting systematic reviews');
    expect(result.parsed.journal).toBe('BMJ');
    expect(result.parsed.volume).toBe('372');
    expect(result.parsed.year).toBe('2021');
    expect(result.parsed['article-number']).toBe('n71');
    expect(result.parsed.authors?.[0]).toBe('Page, Matthew J');
    expect(result.warnings).toContain('quoted-title-journal-locator-heuristic');
  });

  it('extracts quoted-title journal references with explicit issue markers before the parser swallows the venue tail', async () => {
    const result = await extractor.extract(
      'Baron, Reuben M., and David A. Kenny. "The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations.." Journal of Personality and Social Psychology 51, no. 6 (1986): 1173-1182.',
      'auto',
      {},
    );

    expect(result.parsed.title).toBe('The moderator-mediator variable distinction in social psychological research: Conceptual, strategic, and statistical considerations');
    expect(result.parsed.journal).toBe('Journal of Personality and Social Psychology');
    expect(result.parsed.volume).toBe('51');
    expect(result.parsed.issue).toBe('6');
    expect(result.parsed.year).toBe('1986');
    expect(result.parsed.pages).toBe('1173-1182');
    expect(result.warnings).toContain('quoted-title-journal-locator-heuristic');
  });

  it('extracts conference containers from quoted-title in-source references without folding venue text into authors', async () => {
    const result = await extractor.extract(
      'Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database using wireless technologies." In Computational Intelligence and Computing Research (ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015. DOI: https://doi.org/10.1109/iccic.2015.7435818',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('conference');
    expect(result.parsed.title).toBe('An algorithm for accessing traffic database using wireless technologies');
    expect(result.parsed.conferenceTitle).toBe('2015 IEEE International Conference on Computational Intelligence and Computing Research (ICCIC)');
    expect(result.parsed.publisher).toBe('IEEE');
    expect(result.parsed.pages).toBe('1-4');
    expect(result.parsed.year).toBe('2015');
    expect(result.parsed.doi).toBe('10.1109/iccic.2015.7435818');
    expect(result.canonicalAuthors).toMatchObject([
      { last: 'Aljohani', first: 'Mohammed' },
      { last: 'Alam', first: 'Tanweer' },
    ]);
  });

  it('extracts chapter containers and publisher tails from quoted-title in-source references', async () => {
    const result = await extractor.extract(
      'Shapiro, Jonathan. "Genetic algorithms in machine learning." In Advanced Course on Arti- ficial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
      'auto',
      {},
    );

    expect(result.selectedBranch).toBe('in_source_heuristic_raw');
    expect(result.referenceType).toBe('chapter');
    expect(result.parsed.title).toBe('Genetic algorithms in machine learning');
    expect(result.parsed.bookTitle).toBe('Advanced Course on Artificial Intelligence');
    expect(result.parsed.publisher).toBe('Berlin, Heidelberg: Springer Berlin Heidelberg');
    expect(result.parsed.placeOfPublication).toBe('Berlin, Heidelberg');
    expect(result.parsed.pages).toBe('146-168');
    expect(result.parsed.year).toBe('1999');
    expect(result.canonicalAuthors).toMatchObject([
      { last: 'Shapiro', first: 'Jonathan' },
    ]);
  });

  it('normalizes extracted year fragments down to the publication year', async () => {
    const result = await extractor.extract(
      '[10] Tabassum M, Mathew K, A genetic algorithm analysis towards optimization solutions, International Journal of Digital Information and Wireless Communications (IJDIWC), 2014 Jan 1, 4(1), 124-42.',
      'auto',
      {},
    );

    expect(result.parsed.year).toBe('2014');
    expect(result.parsed.authors).toEqual(['Tabassum M', 'Mathew K']);
    expect(result.parsed.title).toBe('A genetic algorithm analysis towards optimization solutions');
    expect(result.parsed.journal).toBe('International Journal of Digital Information and Wireless Communications (IJDIWC)');
    expect(result.parsed.volume).toBe('4');
    expect(result.parsed.issue).toBe('1');
    expect(result.parsed.pages).toBe('124-42');
    expect(result.warnings).toContain('compact-journal-tail-heuristic');
  });
});

describe('style detection and source-type regressions', () => {
  it('keeps numbered Vancouver journals out of year-anchored locator-title fallbacks', async () => {
    const result = await extractor.extract(
      '[267] Kurt B. Drug-induced stuttering associated with venlafaxineolanzapine combination: A rare pharmacodynamic interaction. Dusunen Adam: Journal of Psychiatry and Neurological Sciences. 2025;:277-278. doi:10.14744/dajpns.2025.00305',
      'auto',
      {},
    );

    expect(result.selectedBranch).not.toBe('year_anchored_fallback_raw');
    expect(result.referenceType).toBe('journal');
    expect(result.parsed.title).toBe('Drug-induced stuttering associated with venlafaxineolanzapine combination: A rare pharmacodynamic interaction');
    expect(result.parsed.journal).toBe('Dusunen Adam: Journal of Psychiatry and Neurological Sciences');
    expect(result.parsed.year).toBe('2025');
    expect(result.parsed.pages).toBe('277-278');
    expect(result.parsed.doi).toBe('10.14744/dajpns.2025.00305');
  });

  it('keeps locator-only metadata out of MLA journal titles with article numbers', async () => {
    const result = await extractor.extract(
      'R., Rajalakshmi, Chinnappa A. Uthaiah, Ramya C. M., SubbaRao V. Madhunapantula, Paramahans V. Salimath, Praveen K., Srinath K. M., and Kishor M. R.. "Comparative assessment of cognitive impairment and oxidative stress markers among vitamin D insufficient elderly patients with and without type 2 diabetes mellitus (T2DM)." PLOS ONE, vol. 17, no. 6, 2022, pp. e0269394. doi: 10.1371/journal.pone.0269394',
      'auto',
      {},
    );

    expect(result.selectedBranch).not.toBe('year_anchored_fallback_raw');
    expect(result.referenceType).toBe('journal');
    expect(result.parsed.title).toBe('Comparative assessment of cognitive impairment and oxidative stress markers among vitamin D insufficient elderly patients with and without type 2 diabetes mellitus (T2DM)');
    expect(result.parsed.journal).toBe('PLOS ONE');
    expect(result.parsed.volume).toBe('17');
    expect(result.parsed.issue).toBe('6');
    expect(result.parsed['article-number'] ?? result.parsed.pages).toBeTruthy();
    expect(result.parsed.doi).toBe('10.1371/journal.pone.0269394');
  });

  it('keeps quoted conference containers out of book-tail selection when the venue is a proceedings container', async () => {
    const result = await extractor.extract(
      'Correia, C, N Almeida, F Portela, D Gomes, A Fernandes, A Rosa, and P Figueiredo. “ENDOSCOPIC DRAINAGE OF PANCREATIC AND PERI-PANCREATIC COLLECTIONS: A RETROSPECTIVE ANALYSIS.” In Endoscopy. © Georg Thieme Verlag KG, 2020. https://doi.org/10.1055/s-0040–1704732',
      'auto',
      { debugEnabled: true },
    );

    expect(result.debug?.winner_adapter_id).not.toBe('heuristic:book_tail');
    expect(result.selectedBranch).not.toBe('year_anchored_fallback_raw');
    expect(result.referenceType).toBe('conference');
    expect(result.parsed.title).toBe('ENDOSCOPIC DRAINAGE OF PANCREATIC AND PERI-PANCREATIC COLLECTIONS: A RETROSPECTIVE ANALYSIS');
    expect(result.parsed.conferenceTitle).toBe('Endoscopy');
    expect(result.parsed.doi).toBe('10.1055/s-0040-1704732');
  });

  it('parses numbered simple dissertation tails as theses with clean institution fields', async () => {
    const result = await extractor.extract(
      '[27] Φέρρα, Γκόλφω. Police interviews with children in Greece. National Documentation Centre (EKT), 2026. Dissertation. https://doi.org/10.12681/eadd/60873',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('thesis');
    expect(result.parsed.title).toBe('Police interviews with children in Greece');
    expect(result.parsed.institution).toBe('National Documentation Centre (EKT)');
    expect(result.parsed.year).toBe('2026');
    expect(result.parsed.doi).toBe('10.12681/eadd/60873');
  });

  it('rejects author-year-publisher-tail fallback for wrapped APA journals with volume and issue metadata', async () => {
    const result = await extractor.extract(
      'Foley, John F. (2013). IKK Goes BAD. Science Signaling, 6(260). https://doi.org/10.1126/scisignal.2004004',
      'auto',
      {},
    );

    expect(result.selectedBranch).not.toBe('year_anchored_fallback_raw');
    expect(result.referenceType).toBe('journal');
    expect(result.parsed.title).toBe('IKK Goes BAD');
    expect(result.parsed.journal).toBe('Science Signaling');
    expect(result.parsed.volume).toBe('6');
    expect(result.parsed.issue).toBe('260');
    expect(result.parsed.doi).toBe('10.1126/scisignal.2004004');
  });

  it('keeps Harvard smart-punctuation journals out of publisher-tail fallback', async () => {
    const result = await extractor.extract(
      'Ceci, SJ and Bruck, M, 2009. Do IRBs Pass the Minimal Harm Test?. Perspectives on Psychological Science, 4(1), pp.28–29. https://doi.org/10.1111/j.1745–6924.2009.01084.x',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('journal');
    expect(result.parsed.title).toBe('Do IRBs Pass the Minimal Harm Test?');
    expect(result.parsed.journal).toBe('Perspectives on Psychological Science');
    expect(result.parsed.volume).toBe('4');
    expect(result.parsed.issue).toBe('1');
    expect(result.parsed.pages).toBe('28-29');
    expect(result.parsed.doi).toBe('10.1111/j.1745-6924.2009.01084.x');
  });

  it('detects MLA books as MLA instead of collapsing them into APA', async () => {
    const detection = await classifier.detectStyle(
      'Smith, John. The Craft of Testing. Routledge, 2019.',
    );
    const result = await extractor.extract(
      'Smith, John. The Craft of Testing. Routledge, 2019.',
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('mla');
    expect(result.detectedStyle).toBe('mla');
    expect(result.referenceType).toBe('book');
    expect(result.parsed.title).toBe('The Craft of Testing');
    expect(result.parsed.publisher).toBe('Routledge');
    expect(result.parsed.year).toBe('2019');
  });

  it('extracts MLA book chapters as chapters with edited-book metadata', async () => {
    const result = await extractor.extract(
      'Doe, Jane. "Testing Chapters Well." The Handbook of Modern QA, edited by John Smith, Routledge, 2021, pp. 44-58.',
      'auto',
      {},
    );

    expect(result.detectedStyle).toBe('mla');
    expect(result.referenceType).toBe('chapter');
    expect(result.parsed.title).toBe('Testing Chapters Well');
    expect(result.parsed.bookTitle).toBe('The Handbook of Modern QA');
    expect(result.parsed.editor).toBe('John Smith');
    expect(result.parsed.publisher).toBe('Routledge');
    expect(result.parsed.pages).toBe('44-58');
  });

  it('detects Chicago books as Chicago instead of defaulting to APA', async () => {
    const detection = await classifier.detectStyle(
      'Smith, John. The Craft of Testing. Chicago: University of Chicago Press, 2019.',
    );

    expect(detection.style).toBe('chicago');
  });

  it('extracts Chicago book chapters as chapters instead of books or journals', async () => {
    const result = await extractor.extract(
      'Doe, Jane. "Testing Chapters Well." In The Handbook of Modern QA, edited by John Smith, 44-58. London: Routledge, 2021.',
      'auto',
      {},
    );

    expect(result.detectedStyle).toBe('chicago');
    expect(result.referenceType).toBe('chapter');
    expect(result.parsed.bookTitle).toBe('The Handbook of Modern QA');
    expect(result.parsed.editor).toBe('John Smith');
    expect(result.parsed.placeOfPublication).toBe('London');
    expect(result.parsed.publisher).toBe('Routledge');
    expect(result.parsed.pages).toBe('44-58');
  });

  it('detects and extracts Harvard books as books', async () => {
    const detection = await classifier.detectStyle(
      'Smith, J 2019, The craft of testing, Routledge, London.',
    );
    const result = await extractor.extract(
      'Smith, J 2019, The craft of testing, Routledge, London.',
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('harvard');
    expect(result.detectedStyle).toBe('harvard');
    expect(result.referenceType).toBe('book');
    expect(result.parsed.title).toBe('The craft of testing');
    expect(result.parsed.publisher).toBe('Routledge');
    expect(result.parsed.placeOfPublication).toBe('London');
  });

  it('keeps Harvard book editions separate from the publisher', async () => {
    const result = await extractor.extract(
      'van Dalen P and Brooks E 2013, Dose response ranking for translational pharmacology: case SDE-HVB-001, 3nd ed., Meridian Academic, Toronto.',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('book');
    expect(result.parsed.authors).toEqual(['van Dalen, P.', 'Brooks, E.']);
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-HVB-001');
    expect(result.parsed.edition).toBe('3nd ed.');
    expect(result.parsed.publisher).toBe('Meridian Academic');
    expect(result.parsed.placeOfPublication).toBe('Toronto');
  });

  it('detects and extracts Harvard journals without leaking author-year text into the venue', async () => {
    const detection = await classifier.detectStyle(
      "Smith, J 2021, 'Testing the system', Journal of Applied QA, vol. 12, no. 3, pp. 44-58.",
    );
    const result = await extractor.extract(
      "Smith, J 2021, 'Testing the system', Journal of Applied QA, vol. 12, no. 3, pp. 44-58.",
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('harvard');
    expect(result.detectedStyle).toBe('harvard');
    expect(result.referenceType).toBe('journal');
    expect(result.parsed.title).toBe('Testing the system');
    expect(result.parsed.journal).toBe('Journal of Applied QA');
    expect(result.parsed.volume).toBe('12');
    expect(result.parsed.issue).toBe('3');
    expect(result.parsed.pages).toBe('44-58');
  });

  it('extracts Harvard website references as websites with institution and URL intact', async () => {
    const result = await extractor.extract(
      "Therapeutic Signals Lab 2023, 'Dose response ranking for translational pharmacology', Pharmacology Standards Network, viewed 22 Mar 2026, https://stress.example.org/hvw/071.",
      'auto',
      {},
    );

    expect(result.referenceType).toBe('website');
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology');
    expect(result.parsed.institution).toBe('Pharmacology Standards Network');
    expect(result.parsed.url).toBe('https://stress.example.org/hvw/071');
  });

  it('extracts compact-author Harvard journals instead of collapsing them into Vancouver blobs', async () => {
    const detection = await classifier.detectStyle(
      "Berg N, Adams R and Santos L 2015, 'Dose response ranking for translational pharmacology: case SDE-HVJ-001', Computational Therapeutics, vol. 14, no. 4, pp. 482-498, doi: 10.7001/hvj.051.",
    );
    const result = await extractor.extract(
      "Berg N, Adams R and Santos L 2015, 'Dose response ranking for translational pharmacology: case SDE-HVJ-001', Computational Therapeutics, vol. 14, no. 4, pp. 482-498, doi: 10.7001/hvj.051.",
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('harvard');
    expect(result.detectedStyle).toBe('harvard');
    expect(result.referenceType).toBe('journal');
    expect(result.parsed.authors).toEqual(['Berg, N.', 'Adams, R.', 'Santos, L.']);
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-HVJ-001');
    expect(result.parsed.journal).toBe('Computational Therapeutics');
    expect(result.parsed.volume).toBe('14');
    expect(result.parsed.issue).toBe('4');
    expect(result.parsed.pages).toBe('482-498');
    expect(result.parsed.doi).toBe('10.7001/hvj.051');
  });

  it('extracts Harvard conference proceedings with compact authors as conferences', async () => {
    const detection = await classifier.detectStyle(
      "Berg N, Adams R and Santos L 2021, 'Dose response ranking for translational pharmacology: case SDE-HVC-001', in Proceedings of the Congress on Translational Pharmacology, London, pp. 55-68, Blue Harbor Research.",
    );
    const result = await extractor.extract(
      "Berg N, Adams R and Santos L 2021, 'Dose response ranking for translational pharmacology: case SDE-HVC-001', in Proceedings of the Congress on Translational Pharmacology, London, pp. 55-68, Blue Harbor Research.",
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('harvard');
    expect(result.referenceType).toBe('conference');
    expect(result.parsed.conferenceTitle).toBe('Proceedings of the Congress on Translational Pharmacology');
    expect(result.parsed.publisher).toBe('Blue Harbor Research');
    expect(result.parsed.pages).toBe('55-68');
  });

  it('extracts Chicago author-date journals without misclassifying them as IEEE', async () => {
    const detection = await classifier.detectStyle(
      'Rossi, Luca, Sara Al-Harbi, and Leila Haddad. 2019. "Dose response ranking for translational pharmacology: case SDE-CDA-001." Computational Therapeutics 9, no. 4: 727-746. https://doi.org/10.7001/cda.091.',
    );
    const result = await extractor.extract(
      'Rossi, Luca, Sara Al-Harbi, and Leila Haddad. 2019. "Dose response ranking for translational pharmacology: case SDE-CDA-001." Computational Therapeutics 9, no. 4: 727-746. https://doi.org/10.7001/cda.091.',
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('chicago');
    expect(result.detectedStyle).toBe('chicago');
    expect(result.referenceType).toBe('journal');
    expect(result.parsed.authors).toEqual(['Rossi, L.', 'Al-Harbi, S.', 'Haddad, L.']);
    expect(result.parsed.journal).toBe('Computational Therapeutics');
    expect(result.parsed.volume).toBe('9');
    expect(result.parsed.issue).toBe('4');
    expect(result.parsed.pages).toBe('727-746');
  });

  it('extracts Chicago author-date institutional reports as reports instead of books or websites', async () => {
    const detection = await classifier.detectStyle(
      'Precision Molecule Institute. 2017. Dose response ranking for translational pharmacology: case SDE-CDR-001. Toronto: Open Metrics Press. https://stress.example.org/cdr/101.',
    );
    const result = await extractor.extract(
      'Precision Molecule Institute. 2017. Dose response ranking for translational pharmacology: case SDE-CDR-001. Toronto: Open Metrics Press. https://stress.example.org/cdr/101.',
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('chicago');
    expect(result.referenceType).toBe('report');
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-CDR-001');
    expect(result.parsed.publisher).toBe('Open Metrics Press');
    expect(result.parsed.institution).toBe('Precision Molecule Institute');
    expect(result.parsed.url).toBe('https://stress.example.org/cdr/101');
  });

  it('extracts APA dissertations as theses without leaking the institutional note into the title', async () => {
    const detection = await classifier.detectStyle(
      "O'Rourke, N. (2019). Dose response ranking for translational pharmacology: case SDE-APAT-001 (Doctoral dissertation, North Coast University). https://stress.example.org/apat/031",
    );
    const result = await extractor.extract(
      "O'Rourke, N. (2019). Dose response ranking for translational pharmacology: case SDE-APAT-001 (Doctoral dissertation, North Coast University). https://stress.example.org/apat/031",
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('apa');
    expect(result.referenceType).toBe('thesis');
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-APAT-001');
    expect(result.parsed.institution).toBe('North Coast University');
    expect(result.parsed.url).toBe('https://stress.example.org/apat/031');
  });

  it('extracts MLA dissertations as theses instead of treating the institution as a journal', async () => {
    const result = await extractor.extract(
      'Weber, Jonas. "Dose response ranking for translational pharmacology: case SDE-MLT-001." North Coast University, 2019. PhD dissertation.',
      'auto',
      {},
    );

    expect(result.detectedStyle).toBe('mla');
    expect(result.referenceType).toBe('thesis');
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-MLT-001');
    expect(result.parsed.institution).toBe('North Coast University');
  });

  it('rescues numbered biomedical colon stress cases without mangling inverted author pairs', async () => {
    const result = await extractor.extract(
      '6. Author006, A. Builder006, B.: Stress corpus biomedical colon scenario 006. Biomed Res Notes. 2020;15(2):20-28. doi:10.5555/stress-006',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('journal');
    expect(result.parsed.authors).toEqual(['Author006, A.', 'Builder006, B.']);
    expect(result.parsed.title).toBe('Stress corpus biomedical colon scenario 006');
    expect(result.parsed.journal).toBe('Biomed Res Notes');
    expect(result.parsed.volume).toBe('15');
    expect(result.parsed.issue).toBe('2');
    expect(result.parsed.pages).toBe('20-28');
    expect(result.parsed.doi).toBe('10.5555/stress-006');
  });

  it('extracts compact Vancouver journals without leaking the title into the last author slot', async () => {
    const result = await extractor.extract(
      '191. Saeed O, Clark M, Suzuki H, Novak P. Dose response ranking for translational pharmacology: case SDE-VJC-001. Computational Therapeutics. 2023;19(4):1110-23. doi:10.7001/vjc.191',
      'auto',
      {},
    );

    expect(result.detectedStyle).toBe('vancouver');
    expect(result.referenceType).toBe('journal');
    expect(result.parsed.authors).toEqual(['Saeed, O.', 'Clark, M.', 'Suzuki, H.', 'Novak, P.']);
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-VJC-001');
    expect(result.parsed.journal).toBe('Computational Therapeutics');
    expect(result.parsed.volume).toBe('19');
    expect(result.parsed.issue).toBe('4');
    expect(result.parsed.pages).toBe('1110-23');
  });

  it('extracts numbered Vancouver guideline websites with institutional authors and clean titles', async () => {
    const result = await extractor.extract(
      '232. Adaptive Medicines Taskforce. Trial design routing for preclinical analytics: case SDE-VWW-002. Pharmacology Standards Network. 2017. Available from: https://stress.example.org/vww/232',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('website');
    expect(result.parsed.authors).toEqual(['Adaptive Medicines Taskforce']);
    expect(result.parsed.title).toBe('Trial design routing for preclinical analytics: case SDE-VWW-002');
    expect(result.parsed.institution).toBe('Pharmacology Standards Network');
    expect(result.parsed.year).toBe('2017');
    expect(result.parsed.url).toBe('https://stress.example.org/vww/232');
  });

  it('extracts IEEE conference proceedings without folding the venue and DOI into the conference title', async () => {
    const result = await extractor.extract(
      '[171] N. Berg, R. Adams, and L. Santos, "Dose response ranking for translational pharmacology: case SDE-IEC-001," in Proceedings of the Congress on Translational Pharmacology, Singapore, 2015, pp. 70-82, doi: 10.7001/iec.171.',
      'auto',
      {},
    );

    expect(result.detectedStyle).toBe('ieee');
    expect(result.referenceType).toBe('conference');
    expect(result.parsed.authors).toEqual(['Berg, N.', 'Adams, R.', 'Santos, L.']);
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-IEC-001');
    expect(result.parsed.conferenceTitle).toBe('Proceedings of the Congress on Translational Pharmacology');
    expect(result.parsed.placeOfPublication).toBe('Singapore');
    expect(result.parsed.year).toBe('2015');
    expect(result.parsed.pages).toBe('70-82');
    expect(result.parsed.doi).toBe('10.7001/iec.171');
  });

  it('extracts IEEE books without scrambling author, title, or year fields', async () => {
    const result = await extractor.extract(
      '[5] J. Smith, The Craft of Testing. New York: IEEE Press, 2019.',
      'auto',
      {},
    );

    expect(result.detectedStyle).toBe('ieee');
    expect(result.referenceType).toBe('book');
    expect(result.parsed.authors).toEqual(['Smith, J.']);
    expect(result.parsed.title).toBe('The Craft of Testing');
    expect(result.parsed.placeOfPublication).toBe('New York');
    expect(result.parsed.publisher).toBe('IEEE Press');
    expect(result.parsed.year).toBe('2019');
  });

  it('extracts IEEE conference abstracts without a place as conferences instead of chapters', async () => {
    const reference = '122. S Razavi, E Masangkay, N Chelikam, U Kelly-Tolley, L Pierce, R Malek, and A Padiar, "E-158 Safety of cerebral angiography in private outpatient clinical setting," in Electronic Poster Abstracts, pp. A114-A115, 2020. doi: 10.1136/neurintsurg-2020-snis.190';
    const detection = await classifier.detectStyle(reference);
    const result = await extractor.extract(
      reference,
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('ieee');
    expect(result.detectedStyle).toBe('ieee');
    expect(result.referenceType).toBe('conference');
    expect(result.parsed.title).toBe('E-158 Safety of cerebral angiography in private outpatient clinical setting');
    expect(result.parsed.conferenceTitle).toBe('Electronic Poster Abstracts');
    expect(result.parsed.pages).toBe('A114-A115');
    expect(result.parsed.year).toBe('2020');
    expect(result.parsed.doi).toBe('10.1136/neurintsurg-2020-snis.190');
    expect(result.canonicalAuthors?.[0]).toMatchObject({ last: 'Razavi', initials: 'S.' });
    expect(result.canonicalAuthors?.[3]).toMatchObject({ last: 'Kelly-Tolley', initials: 'U.' });
  });

  it('detects full-name IEEE journal references as IEEE and preserves compound surnames', async () => {
    const reference = 'Alenka Erjavec Škerget, "Poroke med krvnimi sorodniki: genetske in / ali pravne ovire," Pomurska obzorja, vol. 1, no. 1, pp. 29-34, 2022. doi: 10.18690/pomurska-obzorja.1.1.29-34.2014';
    const detection = await classifier.detectStyle(reference);
    const result = await extractor.extract(
      reference,
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('ieee');
    expect(result.detectedStyle).toBe('ieee');
    expect(result.referenceType).toBe('journal');
    expect(result.parsed.title).toBe('Poroke med krvnimi sorodniki: genetske in / ali pravne ovire');
    expect(result.parsed.journal).toBe('Pomurska obzorja');
    expect(result.parsed.volume).toBe('1');
    expect(result.parsed.issue).toBe('1');
    expect(result.parsed.pages).toBe('29-34');
    expect(result.parsed.year).toBe('2022');
    expect(result.canonicalAuthors?.[0]).toMatchObject({ last: 'Erjavec Škerget' });
  });

  it('extracts IEEE journals with full-name single authors and empty volume slots without collapsing the surname', async () => {
    const reference = '482. Alberto Morales Ospina, "Nomofobia y el nivel productividad de las organizaciones," Libros IC, vol. , pp. 107-122, 2022. doi: 10.15765/librosic.v1i1.12';
    const detection = await classifier.detectStyle(reference);
    const result = await extractor.extract(
      reference,
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('ieee');
    expect(result.detectedStyle).toBe('ieee');
    expect(result.referenceType).toBe('journal');
    expect(result.parsed.title).toBe('Nomofobia y el nivel productividad de las organizaciones');
    expect(result.parsed.journal).toBe('Libros IC');
    expect(result.parsed.pages).toBe('107-122');
    expect(result.parsed.year).toBe('2022');
    expect(result.parsed.doi).toBe('10.15765/librosic.v1i1.12');
    expect(result.canonicalAuthors?.[0]).toMatchObject({ last: 'Morales Ospina' });
  });

  it('extracts IEEE journals with nested quoted titles without swallowing the title tail into the venue', async () => {
    const reference = 'Philip J. W. Roberts and P. Reid Matthews, "Closure to " Dynamics of Jets in Two-Layer Stratified Fluids " by Philip J. W. Roberts and P. Reid Matthews (September, 1984, Vol. 110, No. 4)," Journal of Hydraulic Engineering, vol. 112, no. 11, pp. 1110-1113, 1986. doi: 10.1061/(asce)0733-9429(1986)112:11(1110)';
    const detection = await classifier.detectStyle(reference);
    const result = await extractor.extract(
      reference,
      detection.style ?? 'auto',
      { detectionConfidence: detection.confidence },
    );

    expect(detection.style).toBe('ieee');
    expect(result.detectedStyle).toBe('ieee');
    expect(result.referenceType).toBe('journal');
    expect(result.parsed.title).toBe('Closure to " Dynamics of Jets in Two-Layer Stratified Fluids " by Philip J. W. Roberts and P. Reid Matthews (September, 1984, Vol. 110, No. 4)');
    expect(result.parsed.journal).toBe('Journal of Hydraulic Engineering');
    expect(result.parsed.volume).toBe('112');
    expect(result.parsed.issue).toBe('11');
    expect(result.parsed.pages).toBe('1110-1113');
    expect(result.parsed.year).toBe('1986');
    expect(result.parsed.doi).toBe('10.1061/(asce)0733-9429(1986)112:11(1110)');
    expect(result.canonicalAuthors ?? []).toMatchObject([
      { last: 'Roberts', initials: 'P. J. W.' },
      { last: 'Matthews', initials: 'P. R.' },
    ]);
  });

  it('treats MLA website references with bare www URLs as websites instead of journals', async () => {
    const result = await extractor.extract(
      'OpenAI. "GPT-5.1 system card." OpenAI Research, www.openai.com/research/gpt-5-1. Accessed 27 Mar. 2026.',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('website');
    expect(result.parsed.url).toBe('https://www.openai.com/research/gpt-5-1');
  });

  it('extracts plain Harvard sentence journals with issue-only locators as journals', async () => {
    const result = await extractor.extract(
      "394. COŞKUN, D, 2020. Şîa'nın Siyasallaşma Sürecinde Seyyid Kıvâmeddin Marâşî. Journal of Turkish Research Institute, (67), pp.481-491. https://doi.org/10.14222/turkiyat4249",
      'auto',
      {},
    );

    expect(result.referenceType).toBe('journal');
    expect(result.parsed.authors?.[0]).toMatch(/^COŞKUN,\s*D\.?$/);
    expect(result.parsed.title).toBe("Şîa'nın Siyasallaşma Sürecinde Seyyid Kıvâmeddin Marâşî");
    expect(result.parsed.journal).toBe('Journal of Turkish Research Institute');
    expect(result.parsed.volume).toBe('67');
    expect(result.parsed.pages).toBe('481-491');
    expect(result.parsed.doi).toBe('10.14222/turkiyat4249');
  });

  it('extracts sentence-style doctoral dissertations as theses', async () => {
    const result = await extractor.extract(
      '18. Κωτσοβόλου, Σ, 2014. Σύνθεση και μελέτη νέων βιοδραστικών λιπιδίων. Doctoral dissertation. National Documentation Centre (EKT). https://doi.org/10.12681/eadd/21756',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('thesis');
    expect(result.parsed.title).toBe('Σύνθεση και μελέτη νέων βιοδραστικών λιπιδίων');
    expect(result.parsed.institution).toBe('National Documentation Centre (EKT)');
    expect(result.parsed.year).toBe('2014');
    expect(result.parsed.doi).toBe('10.12681/eadd/21756');
  });

  it('extracts trailing-year dissertation sentences as theses', async () => {
    const result = await extractor.extract(
      'Ko, Weiting. Towards the total synthesis of trichoether A. Doctoral dissertation, Nanyang Technological University, 2021. https://doi.org/10.32657/10356/151700',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('thesis');
    expect(result.parsed.title).toBe('Towards the total synthesis of trichoether A');
    expect(result.parsed.institution).toBe('Nanyang Technological University');
    expect(result.parsed.year).toBe('2021');
    expect(result.parsed.doi).toBe('10.32657/10356/151700');
  });

  it('classifies person-authored institutional publisher tails as reports when the year is in the lead', async () => {
    const result = await extractor.extract(
      "Miller, Sebastián J. & Caruso, Germán (2014). Quake'n and Shake'n...Forever! Long-Run Effects of Natural Disasters: A Case Study on the 1970 Ancash Earthquake. Inter-American Development Bank. doi: 10.18235/0011658",
      'auto',
      {},
    );

    expect(result.referenceType).toBe('report');
    expect(result.parsed.title).toBe("Quake'n and Shake'n...Forever! Long-Run Effects of Natural Disasters: A Case Study on the 1970 Ancash Earthquake");
    expect(result.parsed.publisher).toBe('Inter-American Development Bank');
    expect(result.parsed.year).toBe('2014');
    expect(result.parsed.doi).toBe('10.18235/0011658');
  });

  it('classifies Vancouver institutional publisher tails as reports instead of journals', async () => {
    const result = await extractor.extract(
      'Kliesen KL, Owyang MT, Jackson LE, Bokun KO. FRED-SD: A Real-Time Database for State-Level Data with Forecasting Applications. Federal Reserve Bank of St. Louis; 2020. doi:10.20955/wp.2020.031',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('report');
    expect(result.parsed.title).toBe('FRED-SD: A Real-Time Database for State-Level Data with Forecasting Applications');
    expect(result.parsed.publisher).toBe('Federal Reserve Bank of St. Louis');
    expect(result.parsed.year).toBe('2020');
    expect(result.parsed.doi).toBe('10.20955/wp.2020.031');
  });

  it('extracts bare MLA chapters without edited-by metadata', async () => {
    const result = await extractor.extract(
      'Uecker, Heiko. "Sandel, Cora: Kranes konditori: Interiør med Figurer." Kindlers Literatur Lexikon (KLL), pp. 1-2. J.B. Metzler, 2020. https://doi.org/10.1007/978-3-476-05728-0_20923-1',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('chapter');
    expect(result.parsed.title).toBe('Sandel, Cora: Kranes konditori: Interiør med Figurer');
    expect(result.parsed.bookTitle).toBe('Kindlers Literatur Lexikon (KLL)');
    expect(result.parsed.publisher).toBe('J.B. Metzler');
    expect(result.parsed.pages).toBe('1-2');
    expect(result.parsed.year).toBe('2020');
  });

  it('extracts In: chapter tails with publisher-year data split across sentences', async () => {
    const result = await extractor.extract(
      'Haller H, Abecker A. Designing a Knowledge Mapping Tool for Knowledge Workers. In: Lecture Notes in Computer Science. p. 660-669. Springer Berlin Heidelberg; 2010. doi:10.1007/978-3-642-15387-7_69',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('chapter');
    expect(result.parsed.title).toBe('Designing a Knowledge Mapping Tool for Knowledge Workers');
    expect(result.parsed.bookTitle).toBe('Lecture Notes in Computer Science');
    expect(result.parsed.publisher).toBe('Springer Berlin Heidelberg');
    expect(result.parsed.pages).toBe('660-669');
    expect(result.parsed.year).toBe('2010');
    expect(result.parsed.doi).toBe('10.1007/978-3-642-15387-7_69');
  });

  it('extracts real chicago in-source chapters with mixed inverted author leads and bare page spans', async () => {
    const result = await extractor.extract(
      'Iliuk, I. A., I. V. Baranova, and K. P. Postovitenko. "Post-infectiou cough hypersensitivity syndrom: modern problem solving." In NEW TRENDS AND UNSOLVED ISSUES IN MEDICINE, 44-48. Izdevnieciba “Baltija Publishing”, 2022. https://doi.org/10.30525/978-9934-26-226-5-11',
      'chicago',
      {},
    );

    expect(result.selectedBranch).toBe('in_source_heuristic_raw');
    expect(result.referenceType).toBe('chapter');
    expect(result.parsed.title).toBe('Post-infectiou cough hypersensitivity syndrom: modern problem solving');
    expect(result.parsed.bookTitle).toBe('NEW TRENDS AND UNSOLVED ISSUES IN MEDICINE');
    expect(result.parsed.pages).toBe('44-48');
    expect(result.parsed.publisher).toBe('Izdevnieciba "Baltija Publishing"');
    expect(result.parsed.year).toBe('2022');
    expect(result.parsed.doi).toBe('10.30525/978-9934-26-226-5-11');
    expect(result.canonicalAuthors).toMatchObject([
      { last: 'Iliuk', initials: 'I. A.' },
      { last: 'Baranova', initials: 'I. V.' },
      { last: 'Postovitenko', initials: 'K. P.' },
    ]);
  });

  it('extracts numbered full-name IEEE books with publisher-year tails', async () => {
    const result = await extractor.extract(
      '[11] Miriam Goebel-Stengel and Andreas Stengel, Ratgeber Reizdarmsyndrom: Behandlungsmöglichkeiten und was Sie selbst tun können. Springer Berlin Heidelberg, 2022. doi: 10.1007/978-3-662-64525-3',
      'auto',
      {},
    );

    expect(result.referenceType).toBe('book');
    expect(result.parsed.title).toBe('Ratgeber Reizdarmsyndrom: Behandlungsmöglichkeiten und was Sie selbst tun können');
    expect(result.parsed.publisher).toBe('Springer Berlin Heidelberg');
    expect(result.parsed.year).toBe('2022');
    expect(result.parsed.doi).toBe('10.1007/978-3-662-64525-3');
  });

  it('extracts real IEEE proceedings references with mixed full-name author leads without falling back to year-anchored blobs', async () => {
    const result = await extractor.extract(
      'Paschoalinoto, Nelson Wilson, Jorge Ferrer, Ed Claudio Bordinassi, Vanessa Seriacopi, Adalto de Farias, Marcelo Otavio dos Santos, and Gilmar Batalha. "DEVELOPING A MQL VALVE FOR Ti-6Al-4V ALLOY MILLING WITH DIFFERENT CUTTING OIL AND GRAPHITE MIXING RATIO." Proceedings of the 27th International Congress of Mechanical Engineering, 2025. ABCM. https://doi.org/10.26678/abcm.cobem2023.cob2023-0316',
      'auto',
      {},
    );

    expect(result.detectedStyle).toBe('ieee');
    expect(result.selectedBranch).not.toBe('year_anchored_fallback_raw');
    expect(result.referenceType).toBe('conference');
    expect(result.parsed.title).toBe('DEVELOPING A MQL VALVE FOR Ti-6Al-4V ALLOY MILLING WITH DIFFERENT CUTTING OIL AND GRAPHITE MIXING RATIO');
    expect(result.parsed.conferenceTitle).toBe('Proceedings of the 27th International Congress of Mechanical Engineering');
    expect(result.parsed.publisher).toBe('ABCM');
    expect(result.parsed.year).toBe('2025');
    expect(result.parsed.doi).toBe('10.26678/abcm.cobem2023.cob2023-0316');
    expect(result.canonicalAuthors?.[0]).toMatchObject({
      last: 'Paschoalinoto',
      initials: 'N. W.',
    });
  });

  it('skips IEEE LLM fallback when the per-batch budget cap is already reached', async () => {
    process.env.ENABLE_LLM_EXTRACTOR = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_EXTRACT_MODEL = 'gpt-5.4-nano';
    const fetchMock = vi.fn(() => {
      throw new Error('fetch should not be called when the IEEE fallback budget is exhausted');
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const result = await extractor.extract(
      'Paschoalinoto, Nelson Wilson, Jorge Ferrer, Ed Claudio Bordinassi, Vanessa Seriacopi, Adalto de Farias, Marcelo Otavio dos Santos, and Gilmar Batalha. "DEVELOPING A MQL VALVE FOR Ti-6Al-4V ALLOY MILLING WITH DIFFERENT CUTTING OIL AND GRAPHITE MIXING RATIO." Proceedings of the 27th International Congress of Mechanical Engineering, 2025. ABCM. https://doi.org/10.26678/abcm.cobem2023.cob2023-0316',
      'auto',
      {
        batchSize: 50,
        llmBudget: {
          maxCalls: 90,
          totalCalls: 8,
          splitCalls: 0,
          extractCalls: 8,
          capReached: false,
        },
      },
    );

    expect(result.llmFallbackAttempted).toBe(true);
    expect(result.llmFallbackSkippedByBudget).toBe(true);
    expect(result.llmFallbackAccepted).toBe(false);
    expect(result.llmFallbackReason).toBe('weak_first_author');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed on invalid IEEE GPT-5.4 nano fallback output and keeps the deterministic parse', async () => {
    process.env.ENABLE_LLM_EXTRACTOR = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_EXTRACT_MODEL = 'gpt-5.4-nano';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"authors":[{"last":""}]}',
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    const result = await extractor.extract(
      '[183] "Dose response ranking for translational pharmacology: case SDE-IEW-003," Drug Evidence Hub, ver. 2.0, 2013. [Online]. Available: https://stress.example.org/iew/183',
      'ieee',
      {
        batchSize: 50,
        llmBudget: {
          maxCalls: 90,
          totalCalls: 0,
          splitCalls: 0,
          extractCalls: 0,
          capReached: false,
        },
      },
    );

    expect(result.llmFallbackAttempted).toBe(true);
    expect(result.llmFallbackAccepted).toBe(false);
    expect(result.llmFallbackReason).toBe('llm_invalid_or_failed');
    expect(result.extractorPath).toBe('deterministic');
    expect(result.referenceType).toBe('website');
    expect(result.parsed.title).toBe('Dose response ranking for translational pharmacology: case SDE-IEW-003');
  });
});

describe('default resolution provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies a dissertation filter for thesis source types in Crossref title search', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { items: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    const resolutionProvider = createDefaultAdapters().resolutionProvider;
    const result = await resolutionProvider.searchCrossrefByTitle({
      title: 'Example doctoral dissertation',
      firstAuthorSurname: 'Smith',
      year: 2024,
      sourceType: 'thesis',
    }, 5);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((fetchMock as any).mock.calls[0]?.[0])).toContain('type%3Adissertation');
  });

  it('does not repeat the same Crossref query when no source-type filter is available', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { items: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    const resolutionProvider = createDefaultAdapters().resolutionProvider;
    const result = await resolutionProvider.searchCrossrefByTitle({
      title: 'Untyped reference',
      firstAuthorSurname: 'Smith',
      year: 2024,
      sourceType: 'unknown',
    }, 5);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
