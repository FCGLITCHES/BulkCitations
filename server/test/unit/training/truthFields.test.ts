import { describe, expect, it } from 'vitest';
import { hashInputForTruth, normalizeRawTextForTruth } from '../../../src/training/truthHash.js';
import { normalizeExpectedTruthFields } from '../../../src/training/truthFields.js';

describe('truth training helpers', () => {
  it('normalizes whitespace before hashing', () => {
    expect(normalizeRawTextForTruth('  Smith,\nJ.   (2020).  Example.  ')).toBe(
      'Smith, J. (2020). Example.',
    );
    expect(hashInputForTruth('Smith, J. (2020). Example.')).toBe(
      hashInputForTruth('  Smith,\nJ.   (2020).  Example.  '),
    );
  });

  it('flattens engine-style field payloads into export-safe values', () => {
    expect(
      normalizeExpectedTruthFields({
        title: { value: '  Example study  ' },
        year: { value: 2020 },
        authors: {
          value: [
            { family: 'Smith', given: 'Jane' },
            { literal: 'World Health Organization' },
          ],
        },
        pages: ' 44-50 ',
      }),
    ).toEqual({
      title: 'Example study',
      year: 2020,
      authors: ['Smith, Jane', 'World Health Organization'],
      pages: '44-50',
    });
  });

  it('rejects nested objects that are not flat export values', () => {
    expect(() =>
      normalizeExpectedTruthFields({
        title: {
          text: 'Example study',
        },
      }),
    ).toThrow(/flat/i);
  });
});
