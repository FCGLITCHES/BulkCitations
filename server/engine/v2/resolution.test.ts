import { describe, expect, it } from 'vitest';
import { createFieldValue, createEmptyCitation } from './utils.js';
import {
  buildResolutionQueryEvidence,
  chooseBestResolutionCandidate,
  evaluateResolutionCandidate,
  matchTitlesStrict,
  normalizeResolutionTitle,
  normalizeSurnameForResolution,
} from './resolution.js';

function makeCitation(overrides: Record<string, unknown> = {}) {
  return {
    ...createEmptyCitation('Smith J, Doe A. Hybrid CNN transformer architectures for low-resource biomedical segmentation.'),
    referenceType: 'journal',
    authors: createFieldValue([
      { first: 'J.', last: 'Smith', initials: 'J.' },
      { first: 'A.', last: 'Doe', initials: 'A.' },
      { first: 'T.', last: 'Muller', initials: 'T.' },
    ], 'extracted', 0.97, 'extract'),
    title: createFieldValue('Hybrid CNN transformer architectures for low resource biomedical segmentation', 'extracted', 0.95, 'extract'),
    year: createFieldValue(2021, 'extracted', 0.97, 'extract'),
    journal: createFieldValue('IEEE Transactions on Medical Imaging', 'extracted', 0.94, 'extract'),
    ...overrides,
  } as any;
}

describe('strict resolution helpers', () => {
  it('normalizes titles with protected tokens preserved', () => {
    const normalized = normalizeResolutionTitle('U-Net++ for volumetric segmentation in radiology: version 3.0 benchmark results');

    expect(normalized.normalized).toContain('u net for volumetric segmentation in radiology version 3 0 benchmark results');
    expect(normalized.protectedTokens).toContain('U-Net');
  });

  it('requires exact equality for short titles', () => {
    const match = matchTitlesStrict('BMJ system card', 'BMJ system cards');

    expect(match.accepted).toBe(false);
    expect(match.reasons).toContain('short_title_requires_exact_match');
  });

  it('ascii-folds diacritics and punctuation for surname comparison', () => {
    expect(normalizeSurnameForResolution("Müller")).toBe('muller');
    expect(normalizeSurnameForResolution("O’Connor")).toBe('o connor');
    expect(normalizeSurnameForResolution('García-Marquez')).toBe('garcia marquez');
  });

  it('accepts exact title candidates with first-author and coauthor agreement', () => {
    const citation = makeCitation();
    const evaluated = evaluateResolutionCandidate(citation, {
      provider: 'crossref',
      title: 'Hybrid CNN transformer architectures for low resource biomedical segmentation',
      authors: ['Smith, J.', 'Doe, A.', 'Muller, T.'],
      year: 2021,
      venue: 'IEEE Transactions on Medical Imaging',
      sourceType: 'journal-article',
    });

    expect(evaluated.accepted).toBe(true);
    expect(evaluated.band).toBe(2);
    expect(evaluated.extraAuthorMatches).toBeGreaterThanOrEqual(1);
  });

  it('allows +/-1 year only for preprint-like transitions', () => {
    const citation = makeCitation({
      referenceType: 'preprint',
      journal: createFieldValue('arXiv preprint', 'extracted', 0.93, 'extract'),
      year: createFieldValue(2024, 'extracted', 0.97, 'extract'),
    });
    const evaluated = evaluateResolutionCandidate(citation, {
      provider: 'openalex',
      title: citation.title.value,
      authors: ['Smith, J.', 'Doe, A.', 'Muller, T.'],
      year: 2025,
      venue: 'arXiv',
      sourceType: 'preprint',
    });

    expect(evaluated.accepted).toBe(true);
    expect(evaluated.yearToleranceApplied).toBe(true);
  });

  it('marks tied accepted candidates as ambiguous', () => {
    const citation = makeCitation();
    const selection = chooseBestResolutionCandidate(citation, [
      {
        provider: 'crossref',
        title: citation.title.value ?? undefined,
        authors: ['Smith, J.', 'Doe, A.', 'Muller, T.'],
        year: 2021,
        venue: 'IEEE Transactions on Medical Imaging',
        sourceType: 'journal-article',
      },
      {
        provider: 'openalex',
        title: citation.title.value ?? undefined,
        authors: ['Smith, J.', 'Doe, A.', 'Muller, T.'],
        year: 2021,
        venue: 'IEEE Transactions on Medical Imaging',
        sourceType: 'journal-article',
      },
    ]);

    expect(selection.ambiguous).toBe(true);
    expect(selection.accepted).toBeUndefined();
  });

  it('builds minimum query evidence from title plus first author', () => {
    const evidence = buildResolutionQueryEvidence(makeCitation());

    expect(evidence.titlePresent).toBe(true);
    expect(evidence.firstAuthorSurname).toBe('Smith');
    expect(evidence.titleTokenCount).toBeGreaterThan(5);
  });
});
