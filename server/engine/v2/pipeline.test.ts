import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAdapters } from './adapters.js';
import { processV2Conversion } from './pipeline.js';

describe('v2 pipeline', () => {
  afterEach(() => {
    delete process.env.ENABLE_GROBID_EXTRACTOR;
    delete process.env.GROBID_URL;
    delete process.env.ENABLE_LLM_EXTRACTOR;
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });

  it('builds a canonical response with provenance, stage logs, and duplicate metadata', async () => {
    const { response } = await processV2Conversion({
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
    });

    expect(response.job_id).toBeTruthy();
    expect(response.citations.length).toBe(3);
    expect(response.citations[0].title.source).toBe('extracted');
    expect(response.citations[0].stageLog.some((entry) => entry.stageId === 'extract')).toBe(true);
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

  it('omits the debug envelope unless debug mode is explicitly enabled', async () => {
    const { response } = await processV2Conversion({
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
    const { response } = await processV2Conversion({
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
    expect(first.extraction?.authorParserMode).toBe('alternating_pairs');
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

  it('deduplicates only the true mixed-format duplicate pair in a broader mixed-style citation set', async () => {
    const { response } = await processV2Conversion({
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
    const { response } = await processV2Conversion({
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
      async lookup(citation) {
        authorityLookupCalls.push(citation.id);
        throw new Error('Semantic Scholar should not be called in the active enrichment path');
      },
    };

    const { response } = await processV2Conversion({
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
    expect(response.citations[0]?.enrichment?.sourceUsed).toBe('unverifiable');
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

    const { response } = await processV2Conversion({
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
        inputProfile: { structure: 'structured', estimatedCount: 1 },
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
        inputProfile: { structure: 'semi_structured', estimatedCount: 200 },
        detectionConfidence: 0.4,
        batchSize: 200,
      },
    );

    expect(result.extractorPath).toBe('grobid');
    expect(result.parsed.title).toBe('Recovered by GROBID in large batch');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('treats crossref rate limits as informational instead of review damage', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.crossref.org')) {
        return new Response('', { status: 429 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any);

    const { response } = await processV2Conversion({
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
    const { response } = await processV2Conversion({
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
});
