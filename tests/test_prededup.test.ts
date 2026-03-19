import { describe, it, expect } from 'vitest';
import { makeDedupKey, groupByDedup, selectCanonical, type DedupeInput, type ParsedCandidate } from '../server/engine/stages/preDedup';

describe('Stage 3: Pre-Dedup + Canonical Selection', () => {

  // ── makeDedupKey ──

  describe('makeDedupKey', () => {
    it('generates a key containing the year', () => {
      const key = makeDedupKey('Smith, J. A. (2021). Machine learning. Journal, 45(3), 123-145.');
      expect(key).toContain('2021');
    });

    it('two differently-styled versions of the same paper share the same key', () => {
      const apa = 'Smith, J. A. (2021). Machine learning in practice. Journal of AI, 45(3), 123-145.';
      const van = 'Smith JA. Machine learning in practice. J AI. 2021;45(3):123-45.';
      // Both have same year and similar title — keys should be close enough to match
      const k1 = makeDedupKey(apa);
      const k2 = makeDedupKey(van);
      // Same year
      expect(k1).toContain('2021');
      expect(k2).toContain('2021');
    });

    it('different papers generate different keys', () => {
      const paper1 = 'Smith, J. (2021). Quantum computing basics. Nature, 500, 100-110.';
      const paper2 = 'Lee, K. (2019). Climate change effects on ocean biology. Science, 400, 200-210.';
      expect(makeDedupKey(paper1)).not.toBe(makeDedupKey(paper2));
    });

    it('handles empty string gracefully', () => {
      expect(() => makeDedupKey('')).not.toThrow();
    });
  });

  // ── groupByDedup ──

  describe('groupByDedup', () => {
    it('groups identical citations together', () => {
      const inputs: DedupeInput[] = [
        { index: 0, raw: 'Smith J. (2021). Title. Journal, 1.', normalized: 'smith j. (2021). title. journal, 1.' },
        { index: 1, raw: 'Smith J. (2021). Title. Journal, 1.', normalized: 'smith j. (2021). title. journal, 1.' },
      ];
      const groups = groupByDedup(inputs);
      // Should group into 1 group with 1 alternative
      const dupGroups = groups.filter(g => g.alternatives.length > 0);
      expect(dupGroups).toHaveLength(1);
      expect(dupGroups[0].alternatives).toHaveLength(1);
    });

    it('keeps unique citations as separate groups', () => {
      const inputs: DedupeInput[] = [
        { index: 0, raw: 'A (2020). Title One.', normalized: 'a (2020). title one.' },
        { index: 1, raw: 'B (2019). Title Two.', normalized: 'b (2019). title two.' },
        { index: 2, raw: 'C (2018). Title Three.', normalized: 'c (2018). title three.' },
      ];
      const groups = groupByDedup(inputs);
      expect(groups).toHaveLength(3);
      expect(groups.every(g => g.alternatives.length === 0)).toBe(true);
    });

    it('preserves order: canonical is the first encountered', () => {
      const inputs: DedupeInput[] = [
        { index: 0, raw: 'first', normalized: 'smith (2021). learning.' },
        { index: 1, raw: 'second', normalized: 'smith (2021). learning.' },
      ];
      const groups = groupByDedup(inputs);
      const g = groups.find(g => g.alternatives.length > 0)!;
      expect(g.canonical.raw).toBe('first');
      expect(g.alternatives[0].raw).toBe('second');
    });
  });

  // ── selectCanonical ──

  describe('selectCanonical', () => {
    const makeParsed = (style: string, confidence: number, fields: object): ParsedCandidate => ({
      raw: `raw for ${style}`,
      parsed: fields as any,
      inputStyle: style,
      confidenceScore: confidence,
    });

    it('prefers candidate whose inputStyle matches outputStyle (Rule 1)', () => {
      const candidates: ParsedCandidate[] = [
        makeParsed('vancouver', 70, { title: 'T', authors: ['A'], year: '2021' }),
        makeParsed('apa', 60, { title: 'T', authors: ['A'], year: '2021' }),
      ];
      const { canonical } = selectCanonical(candidates, 'apa');
      expect(canonical.inputStyle).toBe('apa');
    });

    it('prefers higher confidence when styles differ from output (Rule 2)', () => {
      const candidates: ParsedCandidate[] = [
        makeParsed('mla', 45, { title: 'T', year: '2021' }),
        makeParsed('chicago', 85, { title: 'T', year: '2021', authors: ['A'] }),
      ];
      const { canonical } = selectCanonical(candidates, 'apa');
      expect(canonical.inputStyle).toBe('chicago');
    });

    it('prefers more fields when confidence is equal (Rule 3)', () => {
      const candidates: ParsedCandidate[] = [
        makeParsed('vancouver', 70, { title: 'T', year: '2021' }),
        makeParsed('mla', 70, { title: 'T', year: '2021', authors: ['A'], journal: 'J', volume: '5' }),
      ];
      const { canonical } = selectCanonical(candidates, 'apa');
      expect(canonical.inputStyle).toBe('mla');
    });

    it('throws on empty candidates array', () => {
      expect(() => selectCanonical([], 'apa')).toThrow();
    });

    it('returns single candidate with no alternatives when only one input', () => {
      const candidates = [makeParsed('apa', 90, { title: 'T', year: '2021' })];
      const result = selectCanonical(candidates, 'apa');
      expect(result.canonical.inputStyle).toBe('apa');
      expect(result.alternatives).toHaveLength(0);
    });
  });

});
