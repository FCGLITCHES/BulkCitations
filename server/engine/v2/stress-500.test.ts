import { afterEach, describe, expect, it, vi } from 'vitest';
import { processV2Conversion } from './pipeline.js';

type StressCaseKind =
  | 'clean_apa'
  | 'clean_ieee'
  | 'doi_line'
  | 'header_bleed_pdf'
  | 'multiline_continuation'
  | 'biomedical_colon'
  | 'abbrev_journal'
  | 'conference'
  | 'url_tail'
  | 'report';

interface StressCase {
  id: string;
  kind: StressCaseKind;
  expectedDoi?: string;
  reference: string;
}

const TOTAL_STRESS_CASES = 500;
const EXPLICIT_STRESS_CASES: StressCase[] = [
  {
    id: 'manual-conference-in-source',
    kind: 'conference',
    expectedDoi: '10.1109/iccic.2015.7435818',
    reference: 'Aljohani, Mohammed, and Tanweer Alam. "An algorithm for accessing traffic database using wireless technologies." In Computational Intelligence and Computing Research (ICCIC), 2015 IEEE International Conference on, pp. 1-4. IEEE, 2015. DOI: https://doi.org/10.1109/iccic.2015.7435818',
  },
  {
    id: 'manual-chapter-in-source',
    kind: 'conference',
    reference: 'Shapiro, Jonathan. "Genetic algorithms in machine learning." In Advanced Course on Arti- ficial Intelligence, pp. 146-168. Springer, Berlin, Heidelberg, 1999.',
  },
  {
    id: 'manual-compact-journal-tail',
    kind: 'abbrev_journal',
    reference: '[10] Tabassum M, Mathew K, A genetic algorithm analysis towards optimization solutions, International Journal of Digital Information and Wireless Communications (IJDIWC), 2014 Jan 1, 4(1), 124-42.',
  },
];
const STRESS_KINDS: StressCaseKind[] = [
  'clean_apa',
  'clean_ieee',
  'doi_line',
  'header_bleed_pdf',
  'multiline_continuation',
  'biomedical_colon',
  'abbrev_journal',
  'conference',
  'url_tail',
  'report',
];
const SPLIT_CONTAMINATION_CODE_PATTERN = /^(header_bleed|doi_orphan|multiline_truncation|page_artifact|oversized_chunk)_(suspected|confirmed)$/;

function padded(index: number) {
  return String(index + 1).padStart(3, '0');
}

function makeDoi(index: number) {
  return `10.5555/stress-${padded(index)}`;
}

function makeTitle(kind: StressCaseKind, index: number) {
  return `Stress corpus ${kind.replace(/_/g, ' ')} scenario ${padded(index)}`;
}

function buildStressCase(index: number): StressCase {
  const kind = STRESS_KINDS[index % STRESS_KINDS.length];
  const year = 2015 + (index % 10);
  const volume = 10 + (index % 12);
  const issue = 1 + (index % 4);
  const startPage = 10 + (index * 2);
  const endPage = startPage + 8;
  const doi = makeDoi(index);
  const title = makeTitle(kind, index);
  const authorA = `Author${padded(index)}, A.`;
  const authorB = `Builder${padded(index)}, B.`;
  const journal = `Journal of Stress Quality ${1 + (index % 7)}`;
  const baseApa = `${authorA}, & ${authorB} (${year}). ${title}. ${journal}, ${volume}(${issue}), ${startPage}-${endPage}.`;

  switch (kind) {
    case 'clean_apa':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${baseApa} https://doi.org/${doi}`,
      };
    case 'clean_ieee':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${authorA} and ${authorB}, "${title}," ${journal}, vol. ${volume}, no. ${issue}, pp. ${startPage}-${endPage}, ${year}. doi: ${doi}.`,
      };
    case 'doi_line':
      return {
        id: `stress-${padded(index)}`,
        kind,
        expectedDoi: doi,
        reference: [
          `${index + 1}. ${authorA}, & ${authorB} (${year}). ${title}. ${journal}, ${volume}(${issue}), ${startPage}-${endPage}.`,
          doi,
        ].join('\n'),
      };
    case 'header_bleed_pdf':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: [
          `${year} Stress Proceedings Header DOI ${doi} ${1 + (index % 17)} of 17`,
          `${index + 1}. ${authorA}, & ${authorB} (${year}). ${title}. ${journal}, ${volume}(${issue}), ${startPage}-${endPage}.`,
        ].join('\n'),
      };
    case 'multiline_continuation':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: [
          `${index + 1}. ${authorA}, & ${authorB} (${year}). ${title}:`,
          'continuing evidence from split line repair and artifact-aware processing.',
          `${journal}, ${volume}(${issue}), ${startPage}-${endPage}. https://doi.org/${doi}`,
        ].join('\n'),
      };
    case 'biomedical_colon':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${index + 1}. ${authorA} ${authorB}: ${title}. Biomed Res Notes. ${year};${volume}(${issue}):${startPage}-${endPage}. doi:${doi}`,
      };
    case 'abbrev_journal':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${authorA}, ${authorB} (${year}). ${title}. J. Stress Qual. ${volume}(${issue}), ${startPage}-${endPage}. doi: ${doi}`,
      };
    case 'conference':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${authorA}, & ${authorB} (${year}). ${title}. In Proceedings of the Stress Systems Conference ${year} (pp. ${startPage}-${endPage}). IEEE.`,
      };
    case 'url_tail':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: [
          `${authorA}, & ${authorB} (${year}). ${title}. ${journal}, ${volume}(${issue}), ${startPage}-${endPage}.`,
          `Available from: https://example.test/${padded(index)}/${kind}`,
        ].join('\n'),
      };
    case 'report':
      return {
        id: `stress-${padded(index)}`,
        kind,
        reference: `${authorA}, & ${authorB} (${year}). ${title}. Stress Research Institute Report No. ${100 + index}. Riyadh: Reliability Press.`,
      };
  }
}

function buildStressCorpus() {
  return [
    ...EXPLICIT_STRESS_CASES,
    ...Array.from({ length: TOTAL_STRESS_CASES - EXPLICIT_STRESS_CASES.length }, (_, index) => buildStressCase(index)),
  ];
}

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
    expect(response.partial_result ?? false).toBe(false);

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
      expect('cleanedChunk' in (citation as Record<string, unknown>)).toBe(false);
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
