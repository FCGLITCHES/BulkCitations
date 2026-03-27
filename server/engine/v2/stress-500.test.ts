import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStressCorpus, TOTAL_STRESS_CASES } from './fixtures/stress500Corpus.js';
import { processV2Conversion } from './pipeline.js';
const SPLIT_CONTAMINATION_CODE_PATTERN = /^(header_bleed|doi_orphan|multiline_truncation|page_artifact|oversized_chunk)_(suspected|confirmed)$/;

describe('v2 500-case stress corpus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('handles a large mixed edge-case corpus while preserving split contamination behavior', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.crossref.org')) {
        return new Response('', { status: 404 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any);

    const corpus = buildStressCorpus();
    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: corpus.map((entry) => entry.reference).join('\n\n'),
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: true,
    });

    expect(response.stats.input_count).toBe(TOTAL_STRESS_CASES);
    expect(response.citations).toHaveLength(TOTAL_STRESS_CASES);
    expect(response.processingPath.stagesRun).toEqual(
      expect.arrayContaining(['split', 'extract', 'validate', 'score', 'respond']),
    );
    expect(response.processingPath.partialResult ?? false).toBe(false);

    const debugCitations = response.debug?.citations ?? [];
    expect(debugCitations).toHaveLength(TOTAL_STRESS_CASES);

    const contaminationCitations = debugCitations.filter((debugCitation) => {
      const splitDebug = debugCitation.stages.split as Record<string, any> | undefined;
      const validateDebug = debugCitation.stages.validate as Record<string, any> | undefined;
      const splitFlags = Array.isArray(splitDebug?.contaminationFlags) ? splitDebug.contaminationFlags : [];
      const validateFlags = Array.isArray(validateDebug?.warningFlags) ? validateDebug.warningFlags : [];

      return splitFlags.length > 0 || validateFlags.some((flag) => SPLIT_CONTAMINATION_CODE_PATTERN.test(String(flag)));
    });

    expect(contaminationCitations.length).toBeGreaterThanOrEqual(45);

    expect(
      contaminationCitations.filter((debugCitation) => {
        const citation = response.citations.find((entry) => entry.id === debugCitation.citationId);
        return citation?.quality?.grade === 'A';
      }),
    ).toHaveLength(0);

    for (const citation of response.citations) {
      expect('cleanedChunk' in (citation as unknown as Record<string, unknown>)).toBe(false);
    }

    const sampleHeaderCases = corpus
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.kind === 'header_bleed_pdf')
      .slice(0, 5);

    for (const { index } of sampleHeaderCases) {
      const citation = response.citations[index];
      const splitDebug = response.debug?.citations[index]?.stages.split as Record<string, any>;

      expect(splitDebug.contaminationFlags).toEqual(
        expect.arrayContaining(['header_bleed_suspected', 'page_artifact_present']),
      );
      expect(splitDebug.strippedRegions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rule: 'header_bleed',
          }),
        ]),
      );
      expect(splitDebug.cleanedChunk).not.toMatch(/Stress Proceedings Header/i);
      expect(citation.quality?.grade).not.toBe('A');
    }

    const sampleDoiCases = corpus
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.kind === 'doi_line')
      .slice(0, 5);

    for (const { entry, index } of sampleDoiCases) {
      const citation = response.citations[index];
      const splitDebug = response.debug?.citations[index]?.stages.split as Record<string, any>;

      expect(citation.doi.value).toBe(entry.expectedDoi);
      expect(splitDebug.repairActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'doi_reattached',
            rawText: entry.expectedDoi,
          }),
        ]),
      );
      expect(splitDebug.contaminationFlags).not.toContain('doi_orphan');
    }

    const sampleContinuationCases = corpus
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.kind === 'multiline_continuation')
      .slice(0, 5);

    for (const { index } of sampleContinuationCases) {
      const splitDebug = response.debug?.citations[index]?.stages.split as Record<string, any>;
      expect(splitDebug.repairActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'lowercase_continuation_joined',
          }),
        ]),
      );
      expect(splitDebug.contaminationFlags).not.toContain('multiline_truncation_suspected');
    }

    const manualConference = response.citations[0];
    expect(manualConference.referenceType).toBe('conference');
    expect(manualConference.title.value).toBe('An algorithm for accessing traffic database using wireless technologies');
    expect(manualConference.conferenceTitle.value).toBe('2015 IEEE International Conference on Computational Intelligence and Computing Research (ICCIC)');
    expect(manualConference.publisher.value).toBe('IEEE');
    expect(manualConference.doi.value).toBe('10.1109/iccic.2015.7435818');

    const manualChapter = response.citations[1];
    expect(manualChapter.referenceType).toBe('chapter');
    expect(manualChapter.title.value).toBe('Genetic algorithms in machine learning');
    expect(manualChapter.bookTitle.value).toBe('Advanced Course on Artificial Intelligence');
    expect(manualChapter.publisher.value).toBe('Berlin, Heidelberg: Springer Berlin Heidelberg');

    const manualCompactJournal = response.citations[2];
    expect(manualCompactJournal.referenceType).toBe('journal');
    expect(manualCompactJournal.title.value).toBe('A genetic algorithm analysis towards optimization solutions');
    expect(manualCompactJournal.journal.value).toBe('International Journal of Digital Information and Wireless Communications (IJDIWC)');
    expect(manualCompactJournal.year.value).toBe(2014);
    expect(manualCompactJournal.volume.value).toBe('4');
    expect(manualCompactJournal.issue.value).toBe('1');
    expect(manualCompactJournal.pages.value).toBe('124-42');

    const populatedTitles = response.citations.filter((citation) => (citation.title.value ?? '').trim().length > 0);
    const populatedRendered = response.citations.filter((citation) => (citation.rendered?.formatted ?? '').trim().length > 0);
    const populatedYears = response.citations.filter((citation) => String(citation.year.value ?? '').trim().length > 0);

    expect(populatedTitles.length).toBeGreaterThanOrEqual(380);
    expect(populatedRendered.length).toBeGreaterThanOrEqual(420);
    expect(populatedYears.length).toBeGreaterThanOrEqual(430);
  }, 120000);
});
