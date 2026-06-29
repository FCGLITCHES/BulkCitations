import { describe, expect, it } from 'vitest';
import { collectDetectionSignals } from '../../../../src/engine/ingestion/detect.js';
import { normalizeIngestionText } from '../../../../src/engine/ingestion/normalize.js';
import { phase1Ingest } from '../../../../src/engine/phases/phase1Ingest.js';
import { createTestPipelineContext } from '../../../helpers/createPipelineContext.js';

describe('ingestion normalization', () => {
  it('normalizes BOM, CRLF, and tabs and records normalization metadata', () => {
    const normalized = normalizeIngestionText('\uFEFF[1]\tSmith, J. (2020).\r\n\tJournal of Examples');

    expect(normalized.normalizedText).not.toContain('\r');
    expect(normalized.normalizedText).not.toContain('\t');
    expect(normalized.normalizedText.startsWith('[1]    Smith, J. (2020).')).toBe(true);
    expect(normalized.normalizationMeta).toMatchObject({
      hadBom: true,
      hadLineEndingNormalization: true,
      hadTabs: true,
    });
  });

  it('treats NBSP-only lines as logical empty lines for block counting', () => {
    const normalized = normalizeIngestionText([
      'Smith, J. (2020). Example article.',
      '\u00A0',
      'Doe, A. (2021). Another article.',
    ].join('\n'));
    const signals = collectDetectionSignals(normalized.normalizedText, normalized.physicalLines);

    expect(signals.nonEmptyLineCount).toBe(2);
    expect(signals.blankBlockCount).toBe(2);
  });

  it('normalizes decomposed Unicode names before author opener detection', () => {
    const normalized = normalizeIngestionText([
      'Mu\u0308ller, J. (2020). Example article.',
      'O\u2019Brien, A. (2021). Another article.',
    ].join('\n'));
    const signals = collectDetectionSignals(normalized.normalizedText, normalized.physicalLines);

    expect(normalized.normalizationMeta.hadUnicodeNormalizationChange).toBe(true);
    expect(signals.authorStartCount).toBe(2);
  });

  it('repairs noisy PDF-copy replacement glyphs and control characters', () => {
    const normalized = normalizeIngestionText(
      'Shannon, C. E. (1948). A Mathe\uFFFDmatical electro\u00ADchemical Theory of Communication.\u0007',
    );

    expect(normalized.normalizedText).toContain('Mathematical');
    expect(normalized.normalizedText).toContain('electrochemical');
    expect(normalized.normalizedText).not.toContain('\uFFFD');
    expect(normalized.normalizedText).not.toContain('\u0007');
    expect(normalized.normalizationMeta.hadReplacementChars).toBe(true);
    expect(normalized.normalizationMeta.hadControlChars).toBe(true);
  });

  it('detects hanging-indented references when indentation comes from tabs', async () => {
    const ctx = createTestPipelineContext();
    ctx.options.enableScoredDetection = true;
    const result = await phase1Ingest.run({
      sourceType: 'text',
      content: [
        'Smith, J. (2020). Example article.',
        '\tJournal of Examples, 12(3), 44-50.',
        'Doe, A. (2021). Another article.',
        '\tExample Review, 9(1), 1-10.',
      ].join('\n'),
    }, ctx);

    expect(result.normalizationMeta?.hadTabs).toBe(true);
    expect(result.ingestionSignals.hangingIndentCount).toBeGreaterThan(0);
  });
});
