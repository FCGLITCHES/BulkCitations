import type { ProviderRecord } from './crossref.js';

const TEST_PROVIDER_RECORDS = new Map<string, ProviderRecord>([
  ['10.1000/example-study', {
    confidence: 0.95,
    referenceType: 'article-journal',
    fields: {
      doi: '10.1000/example-study',
      title: 'Example Study',
      year: 2020,
      journal: 'Journal of Examples',
      volume: '12',
      issue: '3',
      pages: '44-50',
      url: 'https://doi.org/10.1000/example-study',
      publisher: 'Example Press',
      authors: [
        {
          family: 'Smith',
          given: 'J.',
        },
      ],
    },
    authors: [
      {
        family: 'Smith',
        given: 'J.',
      },
    ],
  }],
  ['10.1000/example-duplicate-study', {
    confidence: 0.95,
    referenceType: 'article-journal',
    fields: {
      doi: '10.1000/example-duplicate-study',
      title: 'Example Duplicate Study',
      year: 2020,
      journal: 'Journal of Examples',
      volume: '12',
      issue: '3',
      pages: '44-50',
      url: 'https://doi.org/10.1000/example-duplicate-study',
      publisher: 'Example Press',
      authors: [
        {
          family: 'Smith',
          given: 'J.',
        },
      ],
    },
    authors: [
      {
        family: 'Smith',
        given: 'J.',
      },
    ],
  }],
  ['10.1000/vaswani-2017-attention-is-all-you-need', {
    confidence: 0.96,
    referenceType: 'conference-paper',
    fields: {
      doi: '10.1000/vaswani-2017-attention-is-all-you-need',
      title: 'Attention Is All You Need',
      year: 2017,
      journal: 'Advances in Neural Information Processing Systems',
      volume: '30',
      pages: '5998-6008',
      url: 'https://doi.org/10.1000/vaswani-2017-attention-is-all-you-need',
      publisher: 'Curran Associates, Inc.',
      authors: [
        {
          family: 'Vaswani',
          given: 'A.',
        },
      ],
    },
    authors: [
      {
        family: 'Vaswani',
        given: 'A.',
      },
    ],
  }],
  ['10.1000/smith-2020-better-title-study', {
    confidence: 0.95,
    referenceType: 'article-journal',
    fields: {
      doi: '10.1000/smith-2020-better-title-study',
      title: 'Better Title Study',
      year: 2020,
      journal: 'Journal of Examples',
      volume: '12',
      issue: '3',
      pages: '44-50',
      url: 'https://doi.org/10.1000/smith-2020-better-title-study',
      publisher: 'Example Press',
      authors: [
        {
          family: 'Smith',
          given: 'J.',
        },
      ],
    },
    authors: [
      {
        family: 'Smith',
        given: 'J.',
      },
    ],
  }],
  ['10.1000/good-2020-study', {
    confidence: 0.95,
    referenceType: 'article-journal',
    fields: {
      doi: '10.1000/good-2020-study',
      title: 'Good Study',
      year: 2020,
      journal: 'Journal of Examples',
      volume: '12',
      issue: '3',
      pages: '44-50',
      url: 'https://doi.org/10.1000/good-2020-study',
      publisher: 'Example Press',
      authors: [
        {
          family: 'Smith',
          given: 'J.',
        },
      ],
    },
    authors: [
      {
        family: 'Smith',
        given: 'J.',
      },
    ],
  }],
  ['10.1000/smith-2020-example-study', {
    confidence: 0.95,
    referenceType: 'article-journal',
    fields: {
      doi: '10.1000/smith-2020-example-study',
      title: 'Example Study',
      year: 2020,
      journal: 'Journal of Examples',
      volume: '12',
      issue: '3',
      pages: '44-50',
      url: 'https://doi.org/10.1000/smith-2020-example-study',
      publisher: 'Example Press',
      authors: [
        {
          family: 'Smith',
          given: 'J.',
        },
      ],
    },
    authors: [
      {
        family: 'Smith',
        given: 'J.',
      },
    ],
  }],
  ['10.1000/doe-2021-second-study', {
    confidence: 0.95,
    referenceType: 'article-journal',
    fields: {
      doi: '10.1000/doe-2021-second-study',
      title: 'Second Study',
      year: 2021,
      journal: 'Example Review',
      volume: '9',
      issue: '1',
      pages: '1-10',
      url: 'https://doi.org/10.1000/doe-2021-second-study',
      publisher: 'Example Press',
      authors: [
        {
          family: 'Doe',
          given: 'A.',
        },
      ],
    },
    authors: [
      {
        family: 'Doe',
        given: 'A.',
      },
    ],
  }],
]);

function normalizeDoi(value: string): string {
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
    .toLowerCase();
}

export function getTestProviderRecordByDoi(doi: string): ProviderRecord | null {
  const normalized = normalizeDoi(doi);
  return TEST_PROVIDER_RECORDS.get(normalized) ?? null;
}
