import { describe, expect, it } from 'vitest';
import { readPatternCatalog, validatePatternDefinition } from './patternCatalog.js';

describe('patternCatalog', () => {
  it('loads the migrated pattern catalog entries', () => {
    const patterns = readPatternCatalog();

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.some((pattern) => pattern.id === 'volume-issue-hyphen')).toBe(true);
  });

  it('rejects unsafe regex definitions', () => {
    expect(validatePatternDefinition({
      id: 'unsafe',
      regex: '(?=.*(?=bad))',
      fields: { title: 1 },
    })).toContain('dangerous backtracking');
  });
});
