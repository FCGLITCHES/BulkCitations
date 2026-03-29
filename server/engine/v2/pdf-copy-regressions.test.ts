import { describe, expect, it } from 'vitest';
import { pdfCopySingleFixtures } from './fixtures/pdfCopyFixtures.js';
import { processV2Conversion } from './pipeline.js';

const PDF_COPY_REGRESSIONS = [
  {
    name: 'springer publisher repair',
    raw: pdfCopySingleFixtures.springerChapter,
    expectedTitle: 'Explaining intervention success and failure: What works, when, and why?',
    expectedPublisher: 'Springer',
    failureMode: 'pdf_copy_split_token_artifact',
    provenance: 'Citations test 2.pdf:p1:Biggs-2015',
  },
  {
    name: 'applied psychology journal repair',
    raw: pdfCopySingleFixtures.appliedPsychologyArticle,
    expectedTitle: 'An index of job satisfaction',
    expectedJournal: 'Journal of Applied Psychology',
    failureMode: 'pdf_copy_split_token_artifact',
    provenance: 'Citations test 2.pdf:p1:Brayfield-Rothe-1951',
  },
  {
    name: 'drug-ai DOI carry-over',
    raw: '14. Li Y, Zhang L, Wang Y, et al.: Generative deep learning enables the discovery of a potent and selective RIPK1 inhibitor. Nat Commun. 2022, 13: 10.1038/s41467-022-34692-w',
    expectedTitle: 'Generative deep learning enables the discovery of a potent and selective RIPK1 inhibitor',
    expectedDoi: '10.1038/s41467-022-34692-w',
    failureMode: 'pdf_copy_doi_line_retention',
    provenance: 'tests/test-pdf-citations.test.ts#RAW_PDF_VANCOUVER:14',
  },
  {
    name: 'bracket bibliography DOI retention',
    raw: '[14] Tanweer Alam, "Blockchain and its Role in the Internet of Things (IoT)", International Journal of Scientific Research in Computer Science, Engineering and Information Technology, vol. 5(1), pp. 151-157, 2019. DOI: https://doi.org/10.32628/CSEIT195137',
    expectedTitle: 'Blockchain and its Role in the Internet of Things (IoT)',
    expectedDoi: '10.32628/CSEIT195137',
    failureMode: 'numbered_batch_clumping',
    provenance: 'tests/test-pdf-citations.test.ts#RAW_PDF_BRACKET:14',
  },
] as const;

describe('v2 PDF copy-paste regressions', () => {
  it.each(PDF_COPY_REGRESSIONS)('keeps $name stable', async (fixture) => {
    process.env.ENABLE_LLM_EXTRACTOR = '0';
    process.env.ENABLE_GROBID_EXTRACTOR = '0';

    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: fixture.raw,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: false,
    }, {
      executionMode: 'sync',
    });

    expect(response.citations).toHaveLength(1);
    const citation = response.citations[0]!;

    expect(citation.title.value ?? '').toContain(fixture.expectedTitle);
    if ('expectedPublisher' in fixture) {
      expect(citation.publisher.value ?? citation.rendered?.formatted ?? '').toContain(fixture.expectedPublisher);
    }
    if ('expectedJournal' in fixture) {
      expect(citation.journal.value ?? '').toContain(fixture.expectedJournal);
    }
    if ('expectedDoi' in fixture) {
      expect(citation.doi.value ?? '').toBe(fixture.expectedDoi);
    }
  }, 120000);
});
