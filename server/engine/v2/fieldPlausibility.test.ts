import { describe, expect, it } from 'vitest';
import { assessTitle, assessVenue } from './fieldPlausibility.js';

describe('field plausibility', () => {
  it('flags venue strings that still contain container leakage', () => {
    const assessment = assessVenue({
      bookTitle: 'In Handbook of Methods (pp. 12-34). Springer',
    }, 'chapter');

    expect(assessment.plausible).toBe(false);
    expect(assessment.reason).toBe('venue_contaminated');
    expect(assessment.penalty).toBeGreaterThan(0);
  });

  it('flags title strings that contain DOI-like identifiers', () => {
    const assessment = assessTitle({
      title: 'A testing title 10.1000/example-doi',
    });

    expect(assessment.plausible).toBe(false);
    expect(assessment.reason).toBe('title_contains_identifier');
  });
});
