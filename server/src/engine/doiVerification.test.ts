import { describe, expect, it } from 'vitest';
import { verifyDoiAgainstRecord } from './doiVerification.js';
import { fieldOf } from './types/field.js';
import { createEmptyExtractedFields } from './utils/fields.js';
import type { ProviderRecord } from '../services/crossref.js';

function buildArticleFields(overrides: {
  doi?: string;
  title?: string;
  year?: number;
  authors?: Array<{
    family: string;
    given?: string | null;
    literal?: string;
    isCorporate?: boolean;
  }>;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
}) {
  const fields = createEmptyExtractedFields('phase_test');

  if (overrides.doi) fields.doi = fieldOf(overrides.doi, 'ingestion', 'phase_test', 0.99);
  if (overrides.title) fields.title = fieldOf(overrides.title, 'ingestion', 'phase_test', 0.99);
  if (overrides.year != null)
    fields.year = fieldOf(overrides.year, 'ingestion', 'phase_test', 0.99);
  if (overrides.journal)
    fields.journal = fieldOf(overrides.journal, 'ingestion', 'phase_test', 0.99);
  if (overrides.volume) fields.volume = fieldOf(overrides.volume, 'ingestion', 'phase_test', 0.99);
  if (overrides.issue) fields.issue = fieldOf(overrides.issue, 'ingestion', 'phase_test', 0.99);
  if (overrides.pages) fields.pages = fieldOf(overrides.pages, 'ingestion', 'phase_test', 0.99);
  if (overrides.authors) {
    fields.authors = fieldOf(
      overrides.authors.map((author) => ({
        family: author.family,
        given: author.given ?? null,
        initials: null,
        ...(author.literal ? { literal: author.literal } : {}),
        isCorporate: author.isCorporate ?? false,
      })),
      'ingestion',
      'phase_test',
      0.99,
    );
  }

  return fields;
}

function providerRecord(overrides: Partial<ProviderRecord>): ProviderRecord {
  return {
    confidence: 0.95,
    fields: {},
    ...overrides,
  };
}

describe('verifyDoiAgainstRecord', () => {
  it('verifies a DOI when core fields align, including diacritic-normalized authors', () => {
    const fields = buildArticleFields({
      doi: '10.1000/example-study',
      title: 'Example study',
      year: 2020,
      authors: [{ family: 'Muller', given: 'J.' }],
      journal: 'Journal of Examples',
      volume: '12',
      issue: '3',
      pages: '44-50',
    });

    const result = verifyDoiAgainstRecord(
      fields,
      fields.doi.value,
      providerRecord({
        fields: {
          doi: '10.1000/example-study',
          title: 'Example Study',
          year: 2020,
          journal: 'Journal of Examples',
          volume: '12',
          issue: '3',
          pages: '44-50',
        },
        authors: [{ family: 'Müller', given: 'J.' }],
      }),
    );

    expect(result.status).toBe('verified');
  });

  it('marks the DOI as conflicted when the first author mismatches', () => {
    const fields = buildArticleFields({
      doi: '10.1000/example-study',
      title: 'Example study',
      year: 2020,
      authors: [{ family: 'Smith', given: 'J.' }],
      journal: 'Journal of Examples',
    });

    const result = verifyDoiAgainstRecord(
      fields,
      fields.doi.value,
      providerRecord({
        fields: {
          doi: '10.1000/example-study',
          title: 'Example Study',
          year: 2020,
          journal: 'Journal of Examples',
        },
        authors: [{ family: 'Jones', given: 'J.' }],
      }),
    );

    expect(result.status).toBe('conflicted');
    expect(result.reasons.some((reason) => reason.includes('first author'))).toBe(true);
  });

  it('accepts a short extracted author list when it matches the provider prefix', () => {
    const fields = buildArticleFields({
      doi: '10.1000/example-study',
      title: 'Example study',
      year: 2020,
      authors: [
        { family: 'Smith', given: 'J.' },
        { family: 'Taylor', given: 'A.' },
      ],
      journal: 'Journal of Examples',
    });

    const result = verifyDoiAgainstRecord(
      fields,
      fields.doi.value,
      providerRecord({
        fields: {
          doi: '10.1000/example-study',
          title: 'Example Study',
          year: 2020,
          journal: 'Journal of Examples',
        },
        authors: [
          { family: 'Smith', given: 'J.' },
          { family: 'Taylor', given: 'A.' },
          { family: 'Brown', given: 'K.' },
          { family: 'Nguyen', given: 'P.' },
        ],
      }),
    );

    expect(result.status).toBe('verified');
  });
});
