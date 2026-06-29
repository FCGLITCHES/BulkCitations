import { describe, expect, it } from 'vitest';
import { stripLeadingNumbering } from './stripNumbering';

describe('stripLeadingNumbering', () => {
    it('strips list-like numbering prefixes', () => {
        expect(stripLeadingNumbering('[12] Smith, J. Title.')).toBe('Smith, J. Title.');
        expect(stripLeadingNumbering('12. Smith, J. Title.')).toBe('Smith, J. Title.');
        expect(stripLeadingNumbering('12) Smith, J. Title.')).toBe('Smith, J. Title.');
        expect(stripLeadingNumbering('No. 12. Smith, J. Title.')).toBe('Smith, J. Title.');
        expect(stripLeadingNumbering('(No. 12) Smith, J. Title.')).toBe('Smith, J. Title.');
        expect(stripLeadingNumbering('3 Smith, J. Title.')).toBe('Smith, J. Title.');
    });

    it('preserves DOI-like and year-leading content', () => {
        expect(stripLeadingNumbering('10.1000/xyz123')).toBe('10.1000/xyz123');
        expect(stripLeadingNumbering('2020. Smith, J. Title.')).toBe('2020. Smith, J. Title.');
    });
});
