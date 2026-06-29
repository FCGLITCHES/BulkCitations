import { describe, expect, it } from 'vitest';
import { parsePrelabelResponse } from './bioPrelabel.js';

describe('LLM pre-label parsing', () => {
  it('parses a well-formed wrapped payload and keeps only schema fields', () => {
    const result = parsePrelabelResponse(JSON.stringify({
      confidence: 0.9,
      fields: { authors: ['Smith J'], title: 'Example study', year: '2020', bogusField: 'x' },
    }));
    expect(result.ok).toBe(true);
    expect(result.confidence).toBe(0.9);
    expect(result.fields).toMatchObject({ authors: ['Smith J'], title: 'Example study', year: '2020' });
    expect(result.fields).not.toHaveProperty('bogusField');
  });

  it('strips a markdown code fence before parsing', () => {
    const result = parsePrelabelResponse('```json\n{"confidence":0.7,"fields":{"doi":"10.1/x"}}\n```');
    expect(result.ok).toBe(true);
    expect(result.fields.doi).toBe('10.1/x');
  });

  it('tolerates a flat object without the fields wrapper', () => {
    const result = parsePrelabelResponse('{"title":"A title","journal":"A journal"}');
    expect(result.ok).toBe(true);
    expect(result.fields).toMatchObject({ title: 'A title', journal: 'A journal' });
  });

  it('clamps confidence and drops empty values', () => {
    const result = parsePrelabelResponse('{"confidence":5,"fields":{"title":"","year":"2021"}}');
    expect(result.confidence).toBe(1);
    expect(result.fields).not.toHaveProperty('title');
    expect(result.fields.year).toBe('2021');
  });

  it('returns not-ok on garbage', () => {
    expect(parsePrelabelResponse('not json').ok).toBe(false);
    expect(parsePrelabelResponse('').ok).toBe(false);
    expect(parsePrelabelResponse(null).ok).toBe(false);
  });
});
