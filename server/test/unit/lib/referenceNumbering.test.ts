import { describe, expect, it } from 'vitest';
import { stripLeadingReferenceNumbering } from '../../../src/lib/referenceNumbering.js';

describe('stripLeadingReferenceNumbering', () => {
  it('removes leading list ordinals that are not part of the citation', () => {
    expect(
      stripLeadingReferenceNumbering(
        'No. 22. Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.',
      ),
    ).toBe(
      'Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.',
    );
    expect(
      stripLeadingReferenceNumbering(
        '[22] Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.',
      ),
    ).toBe(
      'Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.',
    );
    expect(
      stripLeadingReferenceNumbering(
        '22 Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.',
      ),
    ).toBe(
      'Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.',
    );
  });

  it('preserves likely years and DOI-like numeric prefixes', () => {
    expect(
      stripLeadingReferenceNumbering(
        '2021. Artificial intelligence in drug discovery remains a fast-moving field.',
      ),
    ).toBe(
      '2021. Artificial intelligence in drug discovery remains a fast-moving field.',
    );
    expect(stripLeadingReferenceNumbering('10.1000/example-study')).toBe(
      '10.1000/example-study',
    );
  });
});
