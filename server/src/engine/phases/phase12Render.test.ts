import { describe, expect, it } from 'vitest';
import {
  formatTitleForRender,
  scoreNoDuplicatePunctuation,
  scoreSpacing,
} from './phase12Render.js';

describe('phase12 render helpers', () => {
  it('keeps sentence-case rendering from uppercasing every title word', () => {
    expect(
      formatTitleForRender('CRISPR and microRNA in DeepMind systems: a study', 'apa7'),
    ).toBe('CRISPR and microRNA in DeepMind systems: A study');
  });

  it('applies title case while preserving mixed-case tokens', () => {
    expect(
      formatTitleForRender('CRISPR and microRNA in DeepMind systems: a study', 'mla9'),
    ).toBe('CRISPR and microRNA in DeepMind Systems: A Study');
  });

  it('scores clean spacing and punctuation at 100%', () => {
    const rendered = 'Smith, J. (2020). Example study. Journal of Examples, 12(3):44-50. https://doi.org/10.1000/example-study';

    expect(scoreSpacing(rendered)).toBe(1);
    expect(scoreNoDuplicatePunctuation(rendered)).toBe(1);
  });

  it('detects malformed spacing and duplicate punctuation without dropping clean cases', () => {
    expect(scoreSpacing('Smith,  J.(2020). Example study,Journal of Examples.')).toBeLessThan(1);
    expect(scoreNoDuplicatePunctuation('Smith,, J. (2020).. Example study')).toBe(0);
  });
});
