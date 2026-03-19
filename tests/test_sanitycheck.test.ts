import { describe, it, expect } from 'vitest';
import { runSanityCheck } from '../server/engine/stages/sanityCheck';

describe('Stage 11: Sanity Check', () => {

  // ── PASSING cases ──

  it('passes a well-formed APA citation', () => {
    const text = 'Smith, J. A. (2021). Machine learning in healthcare. Journal of Medical Informatics, 45(3), 123–145.';
    const result = runSanityCheck(text, 'apa');
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('passes a well-formed Vancouver citation', () => {
    const text = 'LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;521(7553):436-44.';
    const result = runSanityCheck(text, 'vancouver');
    expect(result.passed).toBe(true);
  });

  it('passes an n.d. citation (no date)', () => {
    const text = 'Taylor, P. (n.d.). Cardiac outcomes. JAMA.';
    const result = runSanityCheck(text, 'apa');
    // n.d. is valid — should not warn about missing year
    const yearWarning = result.warnings.find(w => w.includes('year'));
    expect(yearWarning).toBeUndefined();
  });

  // ── FAILING cases ──

  it('warns when output is too short', () => {
    const result = runSanityCheck('Smith (2020)', 'apa');
    // Short but has a year — may or may not trigger the length check
    const shortText = 'Hi';
    const r2 = runSanityCheck(shortText, 'apa');
    expect(r2.warnings.some(w => w.includes('too short'))).toBe(true);
    expect(r2.passed).toBe(false);
  });

  it('warns when output contains raw "undefined"', () => {
    const text = 'Smith, J. A. (2021). undefined. Journal, 45(3), 123-145.';
    const result = runSanityCheck(text, 'apa');
    expect(result.warnings.some(w => w.includes('"undefined"'))).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('warns when output contains raw "null"', () => {
    const text = 'Smith, J. A. (2021). null title. Journal, 45(3), 123-145.';
    const result = runSanityCheck(text, 'apa');
    expect(result.warnings.some(w => w.includes('"null"'))).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('warns when no year is found in output', () => {
    const text = 'Smith, J.A. Machine learning in healthcare. Journal of Medical Informatics, 45(3), 123-145.';
    const result = runSanityCheck(text, 'apa');
    expect(result.warnings.some(w => w.includes('year'))).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('warns when no author appears before year', () => {
    const text = '(2021). Machine learning in healthcare. Journal of Medical Informatics, 45(3), 123-145.';
    const result = runSanityCheck(text, 'apa');
    expect(result.warnings.some(w => w.includes('author'))).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('warns on unresolved CSL template brace', () => {
    const text = 'Smith, J. A. (2021). {title}. Journal, 45(3), 123-145.';
    const result = runSanityCheck(text, 'apa');
    expect(result.warnings.some(w => w.includes('brace'))).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('handles empty string', () => {
    const result = runSanityCheck('', 'apa');
    expect(result.passed).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('all sanity warnings are prefixed with "sanity:"', () => {
    const result = runSanityCheck('', 'apa');
    for (const w of result.warnings) {
      expect(w).toMatch(/^sanity:/);
    }
  });

});
