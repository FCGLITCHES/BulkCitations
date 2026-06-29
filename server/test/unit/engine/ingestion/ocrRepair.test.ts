import { describe, expect, it } from 'vitest';
import { repairOcrArtifacts } from '../../../../src/engine/ingestion/ocrRepair.js';

describe('repairOcrArtifacts', () => {
  it('normalizes common ligatures', () => {
    const result = repairOcrArtifacts('Artiﬁcial intelligence in drug discovery');
    expect(result.changed).toBe(true);
    expect(result.text).toBe('Artificial intelligence in drug discovery');
  });

  it('does not un-mangle alphabetic OCR confusions in output (reliability guarantee)', () => {
    // These rules (rn->m, cl->d) would corrupt legitimate words, so output text is
    // left untouched. OCR-tolerant recovery happens in the matching layer instead.
    for (const word of [
      'government',
      'modern',
      'clean',
      'classic',
      'click',
      'include',
      'clinical',
      'climate',
    ]) {
      const result = repairOcrArtifacts(word);
      expect(result.text).toBe(word);
      expect(result.changed).toBe(false);
    }
  });
});
