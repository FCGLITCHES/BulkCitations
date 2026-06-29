import { describe, expect, it } from 'vitest';
import { stripLeadingNumbering } from '../../../../frontend/shared/stripNumbering.js';

describe('stripLeadingNumbering regression', () => {
  it('strips list-style numbering prefixes', () => {
    expect(stripLeadingNumbering('[12] Smith, J. Title.')).toBe('Smith, J. Title.');
    expect(stripLeadingNumbering('12. Smith, J. Title.')).toBe('Smith, J. Title.');
    expect(stripLeadingNumbering('12) Smith, J. Title.')).toBe('Smith, J. Title.');
    expect(stripLeadingNumbering('3 Smith, J. Title.')).toBe('Smith, J. Title.');
  });

  it('keeps DOI-like and year-leading content intact', () => {
    expect(stripLeadingNumbering('10.1000/xyz123')).toBe('10.1000/xyz123');
    expect(stripLeadingNumbering('2020. Smith, J. Title.')).toBe('2020. Smith, J. Title.');
  });
});
