import { afterEach, describe, expect, it } from 'vitest';
import { REAL_WORLD_BATCH_FIXTURES } from './fixtures/realWorldBatchFixtures.js';
import { processV2Conversion } from './pipeline.js';

const REAL_WORLD_450 = REAL_WORLD_BATCH_FIXTURES.find((fixture) => fixture.id === 'real-world-450');

describe('v2 real-world 450-reference stress corpus', () => {
  afterEach(() => {
    delete process.env.ENABLE_LLM_EXTRACTOR;
    delete process.env.ENABLE_GROBID_EXTRACTOR;
  });

  it('keeps the expanded real-world corpus structurally intact across all 450 references', async () => {
    process.env.ENABLE_LLM_EXTRACTOR = '0';
    process.env.ENABLE_GROBID_EXTRACTOR = '0';

    expect(REAL_WORLD_450).toBeTruthy();

    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: REAL_WORLD_450!.content,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: false,
    }, {
      executionMode: 'sync',
    });

    expect(response.citations).toHaveLength(450);

    const formatted = response.citations.map((citation) => citation.rendered?.formatted ?? '').join('\n');
    expect(formatted).not.toMatch(/\b[A-Z][a-z]+,\s*[A-Z]\.,\s*[A-Z]\./);
    expect(formatted).not.toContain('& &');
    expect(formatted).not.toContain('Software.Addison-Wesley');
    expect(formatted).not.toContain('Society.Harvard University Press');

    expect(response.citations[0]?.rendered?.formatted).toContain('Smith, J. A., & Doe, R. B. (2023).');
    expect(response.citations[22]?.rendered?.formatted).toContain('Watson, J. D., & Crick, F. H. (1953).');
    expect(response.citations[149]?.rendered?.formatted).toContain('The Year of Magical Thinking.');

    expect(response.citations[150]?.raw).toMatch(/^151\.\s+Smith,/);
    expect(response.citations[299]?.raw).toMatch(/^300\.\s+Didion,/);
    expect(response.citations[300]?.raw).toMatch(/^301\.\s+Smith,/);
    expect(response.citations[449]?.raw).toMatch(/^450\.\s+Didion,/);
  }, 20_000);
});
