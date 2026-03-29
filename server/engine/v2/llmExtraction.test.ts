import { describe, expect, it } from 'vitest';
import { parseLlmExtraction } from './llmExtraction.js';

describe('llm extraction schema', () => {
  it('normalizes aliases before validating report outputs', () => {
    const parsed = parseLlmExtraction({
      referenceType: 'report',
      authors: [
        {
          first: null,
          last: 'World Health Organization',
          initials: null,
          literal: 'World Health Organization',
        },
      ],
      title: 'Global tuberculosis report 2023',
      year: 2023,
      institution: 'World Health Organization',
      publisher: 'World Health Organization',
      place: 'Geneva',
      reportNumber: 'WHO/TB/2023.1',
      doi: 'https://doi.org/10.1000/example',
    });

    expect(parsed).toMatchObject({
      referenceType: 'report',
      placeOfPublication: 'Geneva',
      edition: 'WHO/TB/2023.1',
      doi: '10.1000/example',
    });
  });

  it('keeps chapter editors in canonical array form', () => {
    const parsed = parseLlmExtraction({
      referenceType: 'chapter',
      authors: [{ first: 'Jane', last: 'Doe', initials: 'J.' }],
      title: 'Testing Chapters Well',
      bookTitle: 'The Handbook of Modern QA',
      editors: [{ first: 'John', last: 'Smith', initials: 'J.' }],
      year: 2021,
      pages: '44-58',
      publisher: 'Routledge',
      placeOfPublication: 'London',
      doi: null,
      url: null,
    });

    expect(parsed).toMatchObject({
      referenceType: 'chapter',
    });
    expect((parsed as { editors: unknown }).editors).toEqual([
      { first: 'John', last: 'Smith', initials: 'J.' },
    ]);
  });

  it('supports thesis and preprint specific fields', () => {
    const thesis = parseLlmExtraction({
      referenceType: 'thesis',
      authors: [{ first: 'Wei', last: 'Ko', initials: 'W.' }],
      title: 'Towards the total synthesis of trichoether A',
      year: 2021,
      thesisType: 'Doctoral dissertation',
      institution: 'Nanyang Technological University',
      doi: null,
      url: 'https://example.org/thesis',
    });
    const preprint = parseLlmExtraction({
      referenceType: 'preprint',
      authors: [{ first: 'Ada', last: 'Lovelace', initials: 'A.' }],
      title: 'A preprint example',
      year: 2026,
      repository: 'arXiv',
      institution: null,
      doi: 'doi:10.48550/arXiv.1234.5678',
      url: 'https://arxiv.org/abs/1234.5678',
    });

    expect(thesis).toMatchObject({
      referenceType: 'thesis',
      thesisType: 'Doctoral dissertation',
    });
    expect(preprint).toMatchObject({
      referenceType: 'preprint',
      repository: 'arXiv',
      doi: '10.48550/arXiv.1234.5678',
    });
  });

  it('rejects malformed or inconsistent author payloads', () => {
    expect(() => parseLlmExtraction({
      referenceType: 'journal',
      authors: [{ first: 'Jane', last: '', initials: 'J.' }],
      title: 'Bad author example',
      year: 2024,
      journal: 'Example Journal',
      volume: '1',
      issue: '1',
      pages: '1-2',
      doi: null,
      url: null,
    })).toThrow();

    expect(() => parseLlmExtraction({
      referenceType: 'journal',
      authors: ['Jane Doe'],
      title: 'Bad author array example',
      year: 2024,
      journal: 'Example Journal',
      volume: '1',
      issue: '1',
      pages: '1-2',
      doi: null,
      url: null,
    })).toThrow();

    expect(() => parseLlmExtraction({
      referenceType: 'report',
      authors: [{
        first: 'World',
        last: 'World Health Organization',
        initials: 'WHO',
        literal: 'WHO',
      }],
      title: 'Bad group author example',
      year: 2024,
      institution: 'World Health Organization',
      publisher: 'World Health Organization',
      placeOfPublication: null,
      edition: null,
      doi: null,
      url: null,
    })).toThrow();
  });
});
