import { describe, expect, it } from 'vitest';
import { applyEnrichmentField, canLLMOverwrite } from '../../../src/engine/overwrite-policy.js';
import { fieldOf } from '../../../src/engine/types/field.js';

describe('overwrite policy', () => {
  it('never allows llm fallback to overwrite admin confirmed fields', () => {
    const existing = fieldOf('Locked title', 'admin_confirmed', 'admin_stage', 1);

    expect(canLLMOverwrite(existing, 0.95)).toBe(false);
  });

  it('only allows low-confidence llm writes into gaps', () => {
    const existing = fieldOf('Existing title', 'ml_extraction', 'phase4', 0.8);

    expect(canLLMOverwrite(existing, 0.74)).toBe(false);
    expect(canLLMOverwrite(fieldOf(null, 'ml_extraction', 'phase4', 0), 0.74)).toBe(true);
    expect(canLLMOverwrite(existing, 0.9)).toBe(true);
  });

  it('fills or overwrites enrichment values according to confidence rules', () => {
    const empty = fieldOf<string | null>(null, 'ml_extraction', 'phase4', 0);
    const filled = applyEnrichmentField(empty, '10.1000/abc', 0.9, 'crossref', 'phase8');
    expect(filled.value).toBe('10.1000/abc');

    const existing = fieldOf('Old title', 'ml_extraction', 'phase4', 0.7);
    const overwritten = applyEnrichmentField(existing, 'New title', 0.91, 'openalex', 'phase8');
    expect(overwritten.value).toBe('New title');
    expect(overwritten.previousValue).toBe('Old title');
    expect(overwritten.previousSource).toBe('ml_extraction');
  });
});
