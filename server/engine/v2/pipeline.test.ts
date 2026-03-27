import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAdapters } from './adapters.js';
import { pdfCopyNegativeFixtures, pdfCopySingleFixtures } from './fixtures/pdfCopyFixtures.js';
import { processV2Conversion } from './pipeline.js';

const processV2 = (req: any, opt?: any) => processV2Conversion(req, opt);

describe('v2 pipeline', () => {
  afterEach(() => {
    delete process.env.ENABLE_GROBID_EXTRACTOR;
    delete process.env.GROBID_URL;
    delete process.env.ENABLE_LLM_EXTRACTOR;
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });

  it('builds a canonical response with provenance, stage logs, and duplicate metadata', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: [
        'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
        'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: true,
      group: false,
      debug: false,
    });

    expect(response.job_id).toBeTruthy();
    expect(response.citations.length).toBe(3);
    expect(response.citations.some((citation) => citation.stageLog.some((entry) => entry.stageId === 'extract'))).toBe(true);
    expect(response.duplicates.length).toBe(1);
    expect(response.citations.filter((citation) => citation.status === 'merged')).toHaveLength(1);
    expect(response.citations.filter((citation) => citation.status === 'duplicate')).toHaveLength(2);
    expect(response.citations[1].duplicate?.duplicateOf).toBeTruthy();
    expect(response.exports.txt).toContain(`/api/v2/jobs/${response.job_id}/export?format=txt`);
    expect(response.processingPath.stagesRun).toContain('respond');
    expect(response.stats.input_count).toBe(2);
    expect(response.stats.unique_count).toBe(1);
    expect(response.stats.duplicate_count).toBe(1);
  });

  it('records per-stage timings and exposes a slowest-first phase summary', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: 'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    const stageTimings = response.processingPath.stageTimings ?? [];
    const slowestStages = response.processingPath.slowestStages ?? [];

    expect(stageTimings.length).toBeGreaterThanOrEqual(response.processingPath.stagesRun.length);
    expect(stageTimings.find((entry) => entry.stageId === 'respond')).toEqual(expect.objectContaining({
      status: 'success',
      durationMs: expect.any(Number),
    }));
    expect(stageTimings.find((entry) => entry.stageId === 'group')).toEqual(expect.objectContaining({
      status: 'skipped',
      durationMs: 0,
    }));
    expect(stageTimings.find((entry) => entry.stageId === 'extract')?.timeoutMs).toBeGreaterThan(0);
    expect(slowestStages.map((entry) => entry.durationMs)).toEqual(
      [...slowestStages.map((entry) => entry.durationMs)].sort((left, right) => right - left),
    );
  });

  it('omits the debug envelope unless debug mode is explicitly enabled', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: 'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: false,
    });

    expect(response.debug).toBeUndefined();
  });

  it('recovers the healthcare regression fixture without pseudo-authors and preserves conference venue data', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: [
        'Gomes, M.A.S., Kovaleski, J.L., Pagani, R.N. and da Silva, V.L., 2022. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology, 46(7), pp.608-616.',
        'Shailaja K, Seetharamulu B, Jabbar MA. Machine learning in healthcare: A review. In 2018 Second International Conference on Electronics, Communication and Aerospace Technology (ICECA) 2018 Mar 29 (pp. 910-914). IEEE.',
        'Topol, Eric. "High-performance medicine: the convergence of human and artificial intelligence." Nature Medicine 25, no. 1 (2019): 44-56.',
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    expect(response.citations).toHaveLength(3);

    const first = response.citations[0];
    expect(first.extraction?.selectedBranch).toBe('deterministic_raw');
    expect(['alternating_pairs', 'inverted_or_generic']).toContain(first.extraction?.authorParserMode);
    expect(first.rendered?.formatted).toContain('Gomes, M. A. S');
    expect(first.rendered?.formatted).toContain('Kovaleski, J. L');
    expect(first.rendered?.formatted).toContain('Pagani, R. N');
    expect(first.rendered?.formatted).toContain('da Silva, V. L');
    expect(first.rendered?.formatted).not.toMatch(/\bM\.\s*A,\s*G\b/i);
    expect(first.authors.value).toHaveLength(4);
    expect(first.stageDebug?.extract).toBeTruthy();

    const conference = response.citations[1];
    expect(conference.referenceType).toBe('conference');
    expect(conference.conferenceTitle.value).toContain('International Conference on Electronics, Communication and Aerospace Technology');
    expect(conference.rendered?.formatted).toContain('International Conference on Electronics, Communication and Aerospace Technology');

    const chicago = response.citations[2];
    expect(chicago.authors.value[0]?.last).toBe('Topol');
    expect(chicago.authors.value[0]?.initials).toBe('E.');
    expect(chicago.rendered?.formatted).toContain('Topol, E.');

    expect(response.debug?.enabled).toBe(true);
    expect(response.debug?.citations[0]?.stages.extract).toBeTruthy();
  });

  it('renders conference and chapter container heuristics without dropping the recovered venue context', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: [
        'Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database using wireless technologies." In Computational Intelligence and Computing Research (ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015. DOI: https://doi.org/10.1109/iccic.2015.7435818',
        'Shapiro, Jonathan. "Genetic algorithms in machine learning." In Advanced Course on Arti- ficial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
        '[10] Tabassum M, Mathew K, A genetic algorithm analysis towards optimization solutions, International Journal of Digital Information and Wireless Communications (IJDIWC), 2014 Jan 1, 4(1), 124-42.',
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: false,
    });

    const conference = response.citations[0];
    expect(conference.rendered?.formatted).toContain('Aljohani, M., & Alam, T. (2015).');
    expect(conference.rendered?.formatted).toContain('In 2015 IEEE International Conference on Computational Intelligence and Computing Research (ICCIC)');
    expect(conference.rendered?.formatted).toContain('(pp. 1-4)');
    expect(conference.rendered?.formatted).toContain('IEEE.');

    const chapter = response.citations[1];
    expect(chapter.rendered?.formatted).toContain('In Advanced Course on Artificial Intelligence (pp. 146-168)');
    expect(chapter.rendered?.formatted).toContain('Berlin, Heidelberg: Springer Berlin Heidelberg.');

    const compactJournal = response.citations[2];
    expect(compactJournal.rendered?.formatted).toContain('International Journal of Digital Information and Wireless Communications (IJDIWC)');
    expect(compactJournal.rendered?.formatted).not.toContain('Jan 1');
  });

  it('keeps long APA author lists with ellipsis ready instead of collapsing title and venue parsing', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: [
        'Page, M. J., McKenzie, J. E., Bossuyt, P. M., Boutron, I., Hoffmann, T. C., Mulrow, C. D., Shamseer, L., Tetzlaff, J. M., Akl, E. A., Brennan, S. E., Chou, R., Glanville, J., Grimshaw, J. M., Hrobjartsson, A., Lalu, M. M., Li, T., Loder, E. W., Mayo-Wilson, E., McDonald, S., ... Moher, D. (2021). The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ, 372, n71. https://doi.org/10.1136/bmj.n71',
        'Arute, F., Arya, K., Babbush, R., Bacon, D., Bardin, J. C., Barends, R., Biswas, R., Boixo, S., Brandao, F. G. S. L., Buell, D. A., Burkett, B., Chen, Y., Chen, Z., Chiaro, B., Collins, R., Courtney, W., Dunsworth, A., Farhi, E., Foxen, B., ... Martinis, J. M. (2019). Quantum supremacy using a programmable superconducting processor. Nature, 574(7779), 505-510. https://doi.org/10.1038/s41586-019-1666-5',
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    const prisma = response.citations[0];
    expect(prisma.title.value).toBe('The PRISMA 2020 statement: an updated guideline for reporting systematic reviews');
    expect(prisma.journal.value).toBe('BMJ');
    expect(prisma.doi.value).toBe('10.1136/bmj.n71');
    expect(prisma.authors.value).toHaveLength(20);
    expect(prisma.quality?.bucket).toBe('ready');

    const supremacy = response.citations[1];
    expect(supremacy.title.value).toBe('Quantum supremacy using a programmable superconducting processor');
    expect(supremacy.journal.value).toBe('Nature');
    expect(supremacy.volume.value).toBe('574');
    expect(supremacy.issue.value).toBe('7779');
    expect(supremacy.pages.value).toBe('505-510');
    expect(supremacy.doi.value).toBe('10.1038/s41586-019-1666-5');
    expect(supremacy.authors.value).toHaveLength(20);
    expect(supremacy.quality?.bucket).toBe('ready');
  });

  it('keeps compact Vancouver titles with colons from leaking title text into the last author slot', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: [
        'Watson JD, Crick FHC. Molecular structure of nucleic acids: a structure for deoxyribose nucleic acid. Nature. 1953;171(4356):737-738. doi:10.1038/171737a0',
        'Kahneman D, Tversky A. Prospect theory: an analysis of decision under risk. Econometrica. 1979;47(2):263-291. doi:10.2307/1914185',
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    const watson = response.citations[0];
    expect(watson.authors.value.slice(0, 2).map((author) => author.last)).toEqual(['Watson', 'Crick']);
    expect(watson.title.value).toBe('Molecular structure of nucleic acids: a structure for deoxyribose nucleic acid');
    expect(watson.journal.value).toBe('Nature');
    expect(watson.quality?.bucket).toBe('ready');

    const kahneman = response.citations[1];
    expect(kahneman.authors.value.slice(0, 2).map((author) => author.last)).toEqual(['Kahneman', 'Tversky']);
    expect(kahneman.title.value).toBe('Prospect theory: an analysis of decision under risk');
    expect(kahneman.journal.value).toBe('Econometrica');
    expect(kahneman.quality?.bucket).toBe('ready');
  });

  it('deduplicates only the true mixed-format duplicate pair in a broader mixed-style citation set', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: [
        'Gomes, M.A.S., Kovaleski, J.L., Pagani, R.N. and da Silva, V.L., 2022. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology, 46(7), pp.608-616.',
        'Gomes MA, Kovaleski JL, Pagani RN, da Silva VL. Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology. 2022 Oct 3;46(7):608-16.',
        'Adams, K. L., and R. Chen. "A survey of graph neural networks in medicine." Journal of Medical Informatics, vol. 51, no. 2, 2022, pp. 101-119.',
        'McCoy, L. G., Banja, J. D., Ghassemi, M., & Celi, L. A. (2020). Ensuring machine learning for healthcare works for all. BMJ Health & Care Informatics, 27(3), e100237.',
        'Shailaja K, Seetharamulu B, Jabbar MA. Machine learning in healthcare: A review. In 2018 Second International Conference on Electronics, Communication and Aerospace Technology (ICECA) 2018 Mar 29 (pp. 910-914). IEEE.',
        'Rajkomar A, Dean J, Kohane I. Machine learning in medicine. New England Journal of Medicine. 2019;380(14):1347-1358.',
        'Topol, Eric. "High-performance medicine: the convergence of human and artificial intelligence." Nature Medicine 25, no. 1 (2019): 44-56.',
        'Esteva A, Kuprel B, Novoa RA, Ko J, Swetter SM, Blau HM, Thrun S. Dermatologist-level classification of skin cancer with deep neural networks. Nature. 2017 Feb 2;542(7639):115-118.',
        'Obermeyer, Ziad, and Ezekiel J. Emanuel. "Predicting the future-big data, machine learning, and clinical medicine." The New England Journal of Medicine 375, no. 13 (2016): 1216-1219.',
        'C. J. Kelly, A. Karthikesalingam, M. Suleyman, G. Corrado, and D. King, "Key challenges for delivering clinical impact with artificial intelligence," BMC Medicine, vol. 17, no. 1, p. 195, 2019.',
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: true,
      group: false,
      debug: true,
    });

    expect(response.stats.input_count).toBe(10);
    expect(response.stats.duplicate_count).toBe(1);
    expect(response.duplicates).toHaveLength(1);
    expect(response.citations.filter((citation) => citation.status === 'duplicate')).toHaveLength(2);
    expect(response.citations.filter((citation) => citation.status === 'merged')).toHaveLength(1);

    const merged = response.citations.find((citation) => citation.status === 'merged');
    expect(merged?.title.value).toBe('Machine learning applied to healthcare: a conceptual review');
    expect(merged?.authors.value[0]?.last).toBe('Gomes');

    const activeTitles = response.citations
      .filter((citation) => citation.status === 'active')
      .map((citation) => citation.title.value);
    expect(activeTitles).toContain('A survey of graph neural networks in medicine');
    expect(activeTitles).toContain('Machine learning in medicine');
    expect(activeTitles).toContain('High-performance medicine: the convergence of human and artificial intelligence');
  });

  it('deduplicates already-rendered mixed-format variants of the same citation', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: [
        'Gomes, M. A. S., Kovaleski, J. L., Pagani, R. N.., da Silva, V. L.. (2022). Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology, 46(7), 608–616.',
        'Gomes, M. A., Kovaleski, J. L., Pagani, R. N., & da Silva, V. L. (2022). Machine learning applied to healthcare: a conceptual review. Journal of Medical Engineering & Technology, 46(7), 608–616.',
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: true,
      group: false,
      debug: true,
    });

    expect(response.stats.input_count).toBe(2);
    expect(response.stats.duplicate_count).toBe(1);
    expect(response.duplicates).toHaveLength(1);

    const merged = response.citations.find((citation) => citation.status === 'merged');
    expect(merged).toBeTruthy();
    expect(merged?.title.value).toBe('Machine learning applied to healthcare: a conceptual review');
    expect(merged?.journal.value).toBe('Journal of Medical Engineering & Technology');
    expect(merged?.volume.value).toBe('46');
    expect(merged?.issue.value).toBe('7');
    expect(merged?.pages.value).toMatch(/608[-–]616/);
  });

  it('does not call Semantic Scholar in the active enrichment path', async () => {
    const adapters = createDefaultAdapters();
    const authorityLookupCalls: string[] = [];
    const resolutionProvider = {
      ...adapters.resolutionProvider,
      lookupByDoi: vi.fn(async () => []),
      searchCrossrefByTitle: vi.fn(async () => []),
      searchPubmedByTitle: vi.fn(async () => []),
      searchOpenAlexByTitle: vi.fn(async () => []),
    };
    const authorityLookup = {
      ...adapters.authorityLookup,
      async lookup(citation: any) {
        authorityLookupCalls.push(citation.id);
        throw new Error('Semantic Scholar should not be called in the active enrichment path');
      },
    };

    const { response } = await processV2({
      sourceType: 'text',
      content: 'Example Preprint Team. Foundation models for triage. 2024.',
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: true,
      dedup: false,
      group: false,
    }, {
      adapters: {
        ...adapters,
        authorityLookup,
        resolutionProvider,
      },
    });

    expect(authorityLookupCalls).toHaveLength(0);
    expect(response.citations[0]?.enrichment?.sourceUsed).toBe('skipped');
  });

  it('isolates extractor failures to a single citation instead of failing the whole stage', async () => {
    const adapters = createDefaultAdapters();
    const baseExtractor = adapters.extractor;
    const extractor = {
      ...baseExtractor,
      async extract(input: string, inputStyle: string, options?: Parameters<typeof baseExtractor.extract>[2]) {
        if (input.includes('Trigger extract failure')) {
          throw new Error('simulated extractor failure');
        }
        return baseExtractor.extract(input, inputStyle, options);
      },
    };

    const { response } = await processV2({
      sourceType: 'text',
      content: [
        'Smith, J. (2020). Stable citation. Journal of Quality, 10(2), 11-19.',
        'Doe, A. (2021). Trigger extract failure. Journal of Quality, 11(1), 20-29.',
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
    }, {
      adapters: {
        ...adapters,
        extractor,
      },
    });

    expect(response.citations).toHaveLength(2);
    expect(response.processingPath.partialResult).toBe(true);
    expect(response.processingPath.fallbacksUsed).toContain('extract:item-error');
    const failedCitation = response.citations.find((citation) => citation.raw.includes('Trigger extract failure'));
    expect(failedCitation?.stageLog.some((entry) => entry.stageId === 'extract' && entry.status === 'warning')).toBe(true);
  });

  it('keeps verified citations ready even when the verified provider record does not supply a venue', async () => {
    const adapters = createDefaultAdapters();
    const extractor = {
      ...adapters.extractor,
      async extract() {
        return {
          parsed: {
            authors: ['Page, Matthew J'],
            title: 'The PRISMA 2020 statement: an updated guideline for reporting systematic reviews',
            year: '2021',
            doi: '10.1136/bmj.n71',
          },
          referenceType: 'journal' as const,
          method: 'deterministic' as const,
          fallbackUsed: false,
          extractorPath: 'deterministic' as const,
          selectedBranch: 'deterministic_raw' as const,
          selectionReason: 'test_stub',
          authorParserMode: 'structured_pairs',
          rejectedCandidates: [],
          fieldConfidence: {
            authors: 0.95,
            title: 0.95,
            year: 0.95,
            doi: 0.98,
            journal: 0.1,
          },
          warnings: [],
        };
      },
    };
    const resolutionProvider = {
      ...adapters.resolutionProvider,
      lookupByDoi: vi.fn(async () => [{
        provider: 'crossref' as const,
        title: 'The PRISMA 2020 statement: an updated guideline for reporting systematic reviews',
        authors: ['Page MJ'],
        year: 2021,
        doi: '10.1136/bmj.n71',
        sourceType: 'journal',
      }] as any),
      searchCrossrefByTitle: vi.fn(async () => []),
      searchPubmedByTitle: vi.fn(async () => []),
      searchOpenAlexByTitle: vi.fn(async () => []),
    };
    const cache = {
      ...adapters.cache,
      get: vi.fn(async () => ({
        status: 'verified' as const,
        provider: 'crossref',
        matchStrategy: 'crossref_doi' as const,
        candidateCount: 1,
        acceptedCandidate: {
          provider: 'crossref',
          title: 'The PRISMA 2020 statement: an updated guideline for reporting systematic reviews',
          authors: ['Page, Matthew J'],
          year: 2021,
          doi: '10.1136/bmj.n71',
          sourceType: 'journal',
        },
        rejectedReasons: [],
        yearToleranceApplied: false,
      })),
      set: vi.fn(async () => undefined),
    };

    const { response } = await processV2({
      sourceType: 'text',
      content: 'Page, M. J. (2021). The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. https://doi.org/10.1136/bmj.n71',
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: true,
      dedup: false,
      group: false,
    }, {
      adapters: {
        ...adapters,
        cache,
        extractor,
        resolutionProvider,
      },
    });

    const citation = response.citations[0];
    expect(citation?.resolution?.status).toBe('verified');
    const venueIssue = citation?.validationIssues.find((issue) => issue.code === 'missing_required_venue');
    if (venueIssue) {
      expect(venueIssue.severity).toBe('info');
    }
    expect(citation?.quality?.bucket).toBe('ready');
    expect(citation?.quality?.flags).toContain('verified_missing_venue');
  });

  it('uses the grobid extractor path when the local sidecar is enabled and wins routing', async () => {
    process.env.ENABLE_GROBID_EXTRACTOR = 'true';
    process.env.GROBID_URL = 'http://localhost:8070';

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/processCitation')) {
        return new Response([
          '<biblStruct>',
          '<analytic>',
          '<title level="a">Structured extraction from local GROBID</title>',
          '<author><persName><forename type="first">Jane</forename><surname>Smith</surname></persName></author>',
          '</analytic>',
          '<monogr>',
          '<title level="j">Journal of Quality</title>',
          '<imprint><date when="2020"/><biblScope unit="volume">10</biblScope><biblScope unit="issue">2</biblScope><biblScope unit="page" from="11" to="19"/></imprint>',
          '</monogr>',
          '<idno type="DOI">10.1000/example</idno>',
          '</biblStruct>',
        ].join(''), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any);

    const { response } = await processV2({
      sourceType: 'text',
      content: 'Smith J Structured extraction from local GROBID Journal of Quality 2020 10 2 11-19',
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    expect(response.citations[0]?.extraction?.extractorPath).toBe('grobid');
    expect(response.processingPath.extractorPathsUsed).toContain('grobid');
    expect(response.citations[0]?.title.value).toBe('Structured extraction from local GROBID');
  });

  it('does not call grobid when the sidecar is disabled', async () => {
    delete process.env.ENABLE_GROBID_EXTRACTOR;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ENABLE_LLM_EXTRACTOR;

    const adapters = createDefaultAdapters();
    const fetchMock = vi.fn(async () => {
      throw new Error('fetch should not be called when both GROBID and LLM are disabled');
    });

    vi.stubGlobal('fetch', fetchMock as any);

    const result = await adapters.extractor.extract(
      'Smith, J. (2020). The future of testing. Journal of Quality, 10(2), 11-19.',
      'auto',
      {
        inputProfile: { structure: 'structured', estimatedCount: 1 } as any,
        detectionConfidence: 0.95,
        batchSize: 1,
      },
    );

    expect(result.extractorPath).toBe('deterministic');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still routes weak citations to grobid inside large batches', async () => {
    process.env.ENABLE_GROBID_EXTRACTOR = 'true';
    process.env.GROBID_URL = 'http://localhost:8070';

    const adapters = createDefaultAdapters();
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/processCitation')) {
        return new Response([
          '<biblStruct>',
          '<analytic>',
          '<title level="a">Recovered by GROBID in large batch</title>',
          '<author><persName><forename type="first">Jane</forename><surname>Smith</surname></persName></author>',
          '</analytic>',
          '<monogr>',
          '<title level="j">Journal of Quality</title>',
          '<imprint><date when="2020"/><biblScope unit="volume">10</biblScope><biblScope unit="issue">2</biblScope><biblScope unit="page" from="11" to="19"/></imprint>',
          '</monogr>',
          '</biblStruct>',
        ].join(''), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as any);

    const result = await adapters.extractor.extract(
      'Smith J Recovered by GROBID in large batch Journal of Quality 2020 10 2 11-19',
      'auto',
      {
        inputProfile: { structure: 'semi_structured', estimatedCount: 200 } as any,
        detectionConfidence: 0.4,
        batchSize: 200,
      },
    );

    expect(result.extractorPath).toBe('grobid');
    expect(result.parsed.title).toBe('Recovered by GROBID in large batch');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('retries weak parses with forced grobid extraction before strict resolution', async () => {
    process.env.ENABLE_GROBID_EXTRACTOR = 'true';
    delete process.env.ENABLE_LLM_EXTRACTOR;

    const adapters = createDefaultAdapters();
    const baseExtractor = adapters.extractor;
    const extractor = {
      ...baseExtractor,
      extract: vi.fn(async (_input: string, _inputStyle: string, options?: Parameters<typeof baseExtractor.extract>[2]) => {
        if (options?.forceGrobid) {
          return {
            parsed: {
              authors: ['Smith, Jane'],
              title: 'Recovered by forced GROBID fallback',
              year: '2020',
              journal: 'Journal of Quality',
              volume: '10',
              issue: '2',
              pages: '11-19',
            },
            referenceType: 'journal' as const,
            method: 'deterministic' as const,
            fallbackUsed: true,
            extractorPath: 'grobid' as const,
            selectedBranch: 'deterministic_raw' as const,
            selectionReason: 'forced_unresolved_recovery',
            fieldConfidence: {
              authors: 0.95,
              title: 0.95,
              year: 0.95,
              journal: 0.92,
              volume: 0.9,
              issue: 0.9,
              pages: 0.9,
            },
            warnings: [],
          };
        }

        return {
          parsed: {
            title: 'Recovered',
            year: '2020',
          },
          referenceType: 'journal' as const,
          method: 'deterministic' as const,
          fallbackUsed: false,
          extractorPath: 'deterministic' as const,
          selectedBranch: 'deterministic_raw' as const,
          selectionReason: 'weak_selected_parse',
          fieldConfidence: {
            authors: 0.1,
            title: 0.65,
            year: 0.9,
            journal: 0.1,
          },
          warnings: [],
        };
      }),
    };
    const resolutionProvider = {
      ...adapters.resolutionProvider,
      lookupByDoi: vi.fn(async () => []),
      searchCrossrefByTitle: vi.fn(async (query) => {
        if (query.title === 'Recovered by forced GROBID fallback') {
          return [{
            provider: 'crossref' as const,
            title: 'Recovered by forced GROBID fallback',
            authors: ['Smith, Jane'],
            year: 2020,
            venue: 'Journal of Quality',
            volume: '10',
            issue: '2',
            pages: '11-19',
            sourceType: 'journal-article',
          }] as any;
        }
        return [];
      }),
      searchPubmedByTitle: vi.fn(async () => []),
      searchOpenAlexByTitle: vi.fn(async () => []),
    };

    const { response } = await processV2({
      sourceType: 'text',
      content: 'Recovered 2020',
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: true,
      dedup: false,
      group: false,
      debug: true,
    }, {
      adapters: {
        ...adapters,
        extractor,
        resolutionProvider,
      },
    });

    expect(extractor.extract).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ forceGrobid: true }),
    );
    expect(response.citations[0]?.extraction?.extractorPath).toBe('grobid');
    expect(response.citations[0]?.resolution?.status).toBe('verified');
    expect(response.citations[0]?.rendered?.formatted).toContain('Recovered by forced GROBID fallback');
  });

  it('keeps strong local parses ready when Crossref finds no exact match', async () => {
    const adapters = createDefaultAdapters();
    const extractor = {
      ...adapters.extractor,
      async extract() {
        return {
          parsed: {
            authors: ['Smith, Jane', 'Doe, Robert'],
            title: 'Neural network optimization in low-resource environments',
            year: '2023',
            journal: 'Journal of Artificial Intelligence Research',
            volume: '45',
            issue: '2',
            pages: '112-128',
          },
          referenceType: 'journal' as const,
          method: 'deterministic' as const,
          fallbackUsed: false,
          extractorPath: 'deterministic' as const,
          selectedBranch: 'deterministic_raw' as const,
          selectionReason: 'test_strong_local_parse',
          fieldConfidence: {
            authors: 0.96,
            title: 0.96,
            year: 0.95,
            journal: 0.93,
            volume: 0.91,
            issue: 0.9,
            pages: 0.92,
          },
          warnings: [],
        };
      },
    };
    const resolutionProvider = {
      ...adapters.resolutionProvider,
      lookupByDoi: vi.fn(async () => []),
      searchCrossrefByTitle: vi.fn(async () => []),
      searchPubmedByTitle: vi.fn(async () => []),
      searchOpenAlexByTitle: vi.fn(async () => []),
    };

    const { response } = await processV2({
      sourceType: 'text',
      content: 'Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research, 45(2), 112-128.',
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: true,
      dedup: false,
      group: false,
    }, {
      adapters: {
        ...adapters,
        extractor,
        resolutionProvider,
      },
    });

    expect(response.citations[0]?.resolution?.status).toBe('no_exact_match');
    expect(response.citations[0]?.quality?.overall).toBeGreaterThanOrEqual(0.95);
    expect(response.citations[0]?.quality?.bucket).toBe('ready');
  });

  it('sanitizes embedded locator tails from polluted venue fields before rendering', async () => {
    const adapters = createDefaultAdapters();
    const extractor = {
      ...adapters.extractor,
      async extract() {
        return {
          parsed: {
            authors: ['Cox, D. R.'],
            title: 'Regression models and life-tables',
            year: '1972',
            journal: 'Journal of the Royal Statistical Society, Series B 34(2):187-220',
            volume: '34',
            issue: '2',
            pages: '187-220',
          },
          referenceType: 'journal' as const,
          method: 'deterministic' as const,
          fallbackUsed: false,
          extractorPath: 'deterministic' as const,
          selectedBranch: 'deterministic_raw' as const,
          selectionReason: 'test_embedded_locator_tail',
          fieldConfidence: {
            authors: 0.95,
            title: 0.95,
            year: 0.95,
            journal: 0.92,
            volume: 0.92,
            issue: 0.9,
            pages: 0.92,
          },
          warnings: [],
        };
      },
    };

    const { response } = await processV2({
      sourceType: 'text',
      content: 'Cox, D. R. (1972). Regression models and life-tables. Journal of the Royal Statistical Society, Series B 34(2):187-220.',
      inputStyle: 'auto',
      outputStyle: 'chicago-ad',
      enrich: false,
      dedup: false,
      group: false,
    }, {
      adapters: {
        ...adapters,
        extractor,
      },
    });

    const formatted = response.citations[0]?.rendered?.formatted ?? '';
    expect(formatted).toContain('Journal of the Royal Statistical Society, Series B');
    expect(formatted).not.toContain('Series B 34(2):187-220');
    expect(formatted.match(/187[-\u2013]220/g)).toHaveLength(1);
  });

  it('treats crossref rate limits as informational instead of review damage', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.crossref.org')) {
        return new Response('', { status: 429 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any);

    const { response } = await processV2({
      sourceType: 'text',
      content: 'McCoy, L. G., Banja, J. D., Ghassemi, M., & Celi, L. A. (2020). Ensuring machine learning for healthcare works for all. BMJ Health & Care Informatics, 27(3), e100237. https://doi.org/10.1136/bmjhci-2020-100237',
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: true,
      dedup: false,
      group: false,
    });

    expect(response.citations[0]?.validationIssues.some((issue) => issue.code === 'authority_rate_limited')).toBe(true);
    expect(response.citations[0]?.quality?.flags).not.toContain('review');
    expect(response.citations[0]?.quality?.overall).toBeGreaterThan(0.7);
  });

  it('profiles explicit doi lists during ingestion', async () => {
    const { response } = await processV2({
      sourceType: 'doi_list',
      content: [
        'https://doi.org/10.1000/xyz123',
        'doi:10.1000/abc456',
      ].join('\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
    });

    expect(response.inputProfile?.structure).toBe('structured');
    expect(response.inputProfile?.inputType).toBe('doi_list');
    expect(response.inputProfile?.estimatedCount).toBe(2);
  });

  it('fails fast when ingest normalization collapses the input to empty content', async () => {
    await expect(processV2({
      sourceType: 'text',
      content: '   \n \n   ',
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
    })).rejects.toThrow('empty_input_after_normalization');
  });

  it('renders unresolved fallback output instead of blank text when canonical fields are missing', async () => {
    const adapters = createDefaultAdapters();
    const extractor = {
      ...adapters.extractor,
      async extract() {
        return {
          parsed: {},
          referenceType: 'unknown' as const,
          method: 'deterministic' as const,
          fallbackUsed: false,
          extractorPath: 'deterministic' as const,
          selectedBranch: 'deterministic_raw' as const,
          selectionReason: 'test_unresolved_render_fallback',
          fieldConfidence: {},
          warnings: [],
        };
      },
    };

    const { response } = await processV2({
      sourceType: 'text',
      content: 'Trigger fallback raw citation',
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
    }, {
      adapters: {
        ...adapters,
        extractor,
      },
    });

    expect(response.citations[0]?.rendered?.formatted).toBe('[Unresolved reference]. Trigger fallback raw citation.');
    expect(response.citations[0]?.quality?.bucket).toBe('action_needed');
  });

  it('maps thesis institution metadata into institutionMapping for dissertation-style citations', async () => {
    const adapters = createDefaultAdapters();
    const extractor = {
      ...adapters.extractor,
      async extract() {
        return {
          parsed: {
            authors: ["O'Rourke, N."],
            title: 'Dose response ranking for translational pharmacology',
            year: '2019',
            publisher: 'North Coast University',
            url: 'https://stress.example.org/apat/031',
          },
          referenceType: 'thesis' as const,
          method: 'deterministic' as const,
          fallbackUsed: false,
          extractorPath: 'deterministic' as const,
          selectedBranch: 'deterministic_raw' as const,
          selectionReason: 'test_thesis_institution_mapping',
          fieldConfidence: {
            authors: 0.95,
            title: 0.95,
            year: 0.95,
            publisher: 0.9,
            url: 0.9,
          },
          warnings: [],
        };
      },
    };

    const { response } = await processV2({
      sourceType: 'text',
      content: "O'Rourke, N. (2019). Dose response ranking for translational pharmacology.",
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
    }, {
      adapters: {
        ...adapters,
        extractor,
      },
    });

    expect(response.citations[0]?.referenceType).toBe('thesis');
    expect(response.citations[0]?.institution.value).toBe('North Coast University');
    expect(response.citations[0]?.institutionMapping).toMatchObject({
      mapped: true,
      source: 'parsed_publisher',
      originalValue: 'North Coast University',
    });
  });

  it('profiles book-heavy, doi-heavy, and OCR-like input signals during ingestion', async () => {
    const bookHeavy = await processV2({
      sourceType: 'text',
      content: [
        'Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.',
        'Smith, Z. (2017) Swing time. London: Penguin.',
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });
    expect(bookHeavy.response.inputProfile?.signals).toContain('book_tail_markers');

    const doiHeavy = await processV2({
      sourceType: 'text',
      content: [
        'Smith, J. (2020). Example one. Journal of Quality, 10(2), 11-19. https://doi.org/10.5555/example-1',
        'Doe, A. (2021). Example two. Journal of Quality, 11(2), 21-29. https://doi.org/10.5555/example-2',
        'Lee, K. (2022). Example three. Journal of Quality, 12(2), 31-39. https://doi.org/10.5555/example-3',
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: false,
    });
    expect(doiHeavy.response.inputProfile?.signals).toContain('doi_heavy');

    const ocrLike = await processV2({
      sourceType: 'text',
      content: [
        '2024 Example Proceedings Header 2 of 12',
        'Shapiro, Jonathan. "Genetic algorithms in machine learn- ing." In Advanced Course on Arti- ficial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
      ].join('\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });
    expect(ocrLike.response.inputProfile?.signals).toContain('ocr_noise_markers');
    expect(ocrLike.response.debug?.citations[0]?.stages.split).toEqual(expect.objectContaining({
      splitReasons: expect.arrayContaining(['profile_ocr_noise_markers']),
    }));
  });

  it('repairs exact PDF-copy raw references into clean canonical fields without changing the user input first', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: [
        pdfCopySingleFixtures.springerChapter,
        pdfCopySingleFixtures.appliedPsychologyArticle,
        pdfCopySingleFixtures.workStressDoiArticle,
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
    });

    expect(response.citations).toHaveLength(3);

    const [chapter, article, doiArticle] = response.citations;
    expect(chapter.referenceType).toBe('chapter');
    expect(chapter.publisher.value).toBe('Springer');
    expect(chapter.bookTitle.value).toContain('Derailed organizational stress and well-being interventions');
    expect(chapter.raw).toContain('S pringer.');
    expect(chapter.normalization?.appliedRepairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'publisher_place' }),
    ]));
    expect(['high', 'medium']).toContain(chapter.normalization?.citationRepairConfidence);

    expect(article.referenceType).toBe('journal');
    expect(article.journal.value).toBe('Journal of Applied Psychology');
    expect(article.pages.value).toBe('307-311');
    expect(article.raw).toContain('P sychology');

    expect(doiArticle.referenceType).toBe('journal');
    expect(doiArticle.journal.value).toBe('Work & Stress');
    expect(doiArticle.doi.value).toBe('10.1080/02678373.2010.50680');
    expect(doiArticle.title.value).toBe('Organizational interventions for balancing work and home demands: An overview');
    expect(doiArticle.raw).toContain('h ttps://doi.org');
    expect(doiArticle.normalization?.citationRepairConfidence).toBe('high');
  });

  it('does not apply raw PDF-copy repairs to already-valid title-start tokens like A guide or T cells', async () => {
    const { response } = await processV2({
      sourceType: 'text',
      content: [
        pdfCopyNegativeFixtures.titleStart,
        pdfCopyNegativeFixtures.tCellsTitle,
      ].join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    expect(response.citations).toHaveLength(2);
    expect(response.citations[0]?.title.value).toBe('A guide to research practice');
    expect(response.citations[1]?.title.value).toBe('T cells in adaptive immunity');
    expect(response.citations[0]?.normalization?.appliedRepairs ?? []).toEqual([]);
    expect(response.citations[1]?.normalization?.appliedRepairs ?? []).toEqual([]);
  });

  it('downshifts detect confidence when ingest signals indicate style uncertainty', async () => {
    const adapters = createDefaultAdapters();
    const classifier = {
      ...adapters.classifier,
      detectStyle: vi.fn(async () => ({
        style: 'apa' as const,
        confidence: 0.82,
      })),
    };

    const { response } = await processV2({
      sourceType: 'text',
      content: [
        '1. Smith, J. (2020). Mixed systems in practi- ce. Journal of Quality, 10(2), 11-19.',
        '^1 Continuation note with header artifact 3 of 9 and another style clue.',
      ].join('\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    }, {
      adapters: {
        ...adapters,
        classifier,
      },
    });

    expect(response.inputProfile?.signals).toEqual(expect.arrayContaining([
      'mixed_style_markers',
      'ocr_noise_markers',
    ]));
    expect(response.citations[0]?.detectedStyle.confidence).toBeLessThan(0.82);
    expect(response.debug?.citations[0]?.stages.detect).toEqual(expect.objectContaining({
      classifierConfidence: 0.82,
      uncertaintyFlags: expect.arrayContaining(['mixed_style_markers', 'ocr_noise_markers']),
    }));
  });

  it('keeps deterministic routing for book-tail profiles at medium confidence instead of escalating straight to grobid', async () => {
    process.env.ENABLE_GROBID_EXTRACTOR = 'true';
    process.env.GROBID_URL = 'http://localhost:8070';

    const adapters = createDefaultAdapters();
    const fetchMock = vi.fn(async () => {
      throw new Error('grobid should not be called for deterministic-friendly book-tail profiles');
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const result = await adapters.extractor.extract(
      'Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.',
      'auto',
      {
        inputProfile: {
          structure: 'semi_structured',
          confidence: 0.82,
          inputType: 'mixed_styles',
          estimatedCount: 20,
          hasDois: false,
          hasUrls: false,
          styleHints: ['book_tail'],
          signals: ['book_tail_markers'],
        },
        detectionConfidence: 0.7,
        batchSize: 20,
      },
    );

    expect(result.extractorPath).toBe('deterministic');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
