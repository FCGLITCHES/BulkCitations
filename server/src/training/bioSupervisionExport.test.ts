import { describe, expect, it } from 'vitest';
import {
  buildBioSupervisionRows,
  buildBioSupervisionRowsFromStyleGold,
  buildBioSupervisionRowsFromStyleGoldWithDiagnostics,
} from './bioSupervisionExport.js';
import { hashInputForTruth } from './truthHash.js';
import type { LearningQueueItem, StoredApprovedTruth } from '../runtime/store.js';

describe('BIO supervision export', () => {
  it('creates deterministic BIO rows from approved truth', () => {
    const rawText = 'Smith, J. (2020). Example study. Journal of Examples.';
    const rows = buildBioSupervisionRows([
      {
        id: 'truth-1',
        inputHash: hashInputForTruth(rawText),
        rawText,
        expectedFields: {
          authors: [{ family: 'Smith', given: 'J.' }],
          year: 2020,
          title: 'Example study',
          journal: 'Journal of Examples',
        },
        coreTruth: null,
        overlayTruth: null,
        expectedType: 'article-journal',
        expectedStyle: 'apa7',
        provenance: 'unit-test',
        datasetSplit: 'train',
        trustLevel: 'reviewed',
        rowStatus: 'reviewed',
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      } satisfies StoredApprovedTruth,
    ], []);

    expect(rows).toHaveLength(1);
    expect(rows[0].input_hash).toBe(hashInputForTruth(rawText));
    expect(rows[0].bio_tokens).toContain('Smith,');
    expect(rows[0].bio_tags).toContain('B-year');
    expect(rows[0].bio_tags).toContain('B-title');
    expect(rows[0].label_schema_version).toBe('citation-bio-v1');
  });

  it('turns processed learning queue corrections into BIO rows', () => {
    const rawText = 'Doe, A. (2021). Corrected title.';
    const queueItem: LearningQueueItem = {
      id: 'queue-1',
      citationId: 'citation-1',
      jobId: 'job-1',
      source: 'user_edit',
      priority: 2,
      processed: true,
      createdAt: '2026-04-23T00:00:00.000Z',
      trainingData: {
        rawInput: rawText,
        rawTextHash: hashInputForTruth(rawText),
        eligibleForTraining: true,
        corrections: {
          title: 'Corrected title',
        },
      },
    };

    const rows = buildBioSupervisionRows([], [queueItem]);

    expect(rows).toHaveLength(1);
    expect(rows[0].provenance).toBe('learning_queue:queue-1');
    expect(rows[0].bio_tags).toContain('B-title');
  });

  it('projects certified style/core gold rows into BIO supervision rows', () => {
    const rawText = 'Smith J. Example study. Journal of Examples. 2020;12(3):44-50. doi:10.1000/example';
    const rows = buildBioSupervisionRowsFromStyleGold([
      {
        raw_text: rawText,
        expected_fields: {
          authors: 'Smith J',
          title: 'Example study',
          journal: 'Journal of Examples',
          year: '2020',
          volume: '12',
          issue: '3',
          pages: '44-50',
          doi: '10.1000/example',
        },
        expected_type: 'article-journal',
        expected_style: 'vancouver',
        dataset_split: 'val',
        trust_level: 'gold',
        input_hash: hashInputForTruth(rawText),
        provenance: 'style_gold:test',
        row_status: 'reviewed',
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].dataset_split).toBe('val');
    expect(rows[0].trust_level).toBe('gold');
    expect(rows[0].bio_tags).toContain('B-author');
    expect(rows[0].bio_tags).toContain('B-title');
    expect(rows[0].bio_tags).toContain('B-journal');
    expect(rows[0].bio_tags).toContain('B-doi');
  });
});

describe('BIO projection — hardened alignment', () => {
  const tagged = (rows: ReturnType<typeof buildBioSupervisionRowsFromStyleGold>, label: string) =>
    rows[0]!.bio_tokens.filter((_, index) => rows[0]!.bio_tags[index]?.endsWith(`-${label}`));

  it('recovers non-verbatim fields via normalization (en-dash pages, smart quotes)', () => {
    // Raw uses an en-dash in pages and curly quotes around the title; the stored
    // truth uses ascii hyphen and straight text. The old indexOf projection
    // dropped both silently.
    const rawText = 'Smith J. “Example study”. J Examples. 2020;12(3):44–50.';
    const rows = buildBioSupervisionRowsFromStyleGold([
      {
        raw_text: rawText,
        expected_fields: {
          authors: 'Smith J',
          title: 'Example study',
          journal: 'J Examples',
          year: '2020',
          volume: '12',
          issue: '3',
          pages: '44-50',
        },
        trust_level: 'gold',
        input_hash: hashInputForTruth(rawText),
        provenance: 'unit-test',
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.bio_tags).toContain('B-title');
    expect(rows[0]!.bio_tags).toContain('B-pages');
    expect(tagged(rows, 'pages').join(' ')).toContain('50');
    expect(rows[0]!.unprojected_fields ?? []).toHaveLength(0);
    expect(rows[0]!.projection_status).toBe('ok');
  });

  it('projects every author in a multi-author reference', () => {
    const rawText = 'Smith, J., Doe, A., and Roe, B. (2019). Shared study. Journal of Many.';
    const rows = buildBioSupervisionRowsFromStyleGold([
      {
        raw_text: rawText,
        expected_fields: {
          authors: [
            { family: 'Smith', given: 'J.' },
            { family: 'Doe', given: 'A.' },
            { family: 'Roe', given: 'B.' },
          ],
          year: '2019',
          title: 'Shared study',
          journal: 'Journal of Many',
        },
        trust_level: 'gold',
        input_hash: hashInputForTruth(rawText),
        provenance: 'unit-test',
      },
    ]);

    const authorTokens = tagged(rows, 'author');
    // All three surnames must be covered, not just the first.
    expect(authorTokens.join(' ')).toContain('Smith,');
    expect(authorTokens.join(' ')).toContain('Doe,');
    expect(authorTokens.join(' ')).toContain('Roe,');
    // Three separate author spans => three B-author starts.
    expect(rows[0]!.bio_tags.filter((tag) => tag === 'B-author')).toHaveLength(3);
  });

  it('flags unmatched fields instead of dropping them silently', () => {
    // The publisher value does not appear anywhere in the raw text.
    const rawText = 'Doe A. A book about testing. 2021.';
    const { rows, report } = buildBioSupervisionRowsFromStyleGoldWithDiagnostics([
      {
        raw_text: rawText,
        expected_fields: {
          authors: 'Doe A',
          bookTitle: 'A book about testing',
          year: '2021',
          publisher: 'Nonexistent House',
        },
        trust_level: 'gold',
        input_hash: hashInputForTruth(rawText),
        provenance: 'unit-test',
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.needs_review).toBe(true);
    expect(rows[0]!.unprojected_fields).toContain('publisher');
    expect(rows[0]!.projection_status).toBe('partial');
    expect(report.unmatchedByField.publisher).toBe(1);
    expect(report.matchedFieldValues).toBeGreaterThan(0);
  });

  it('projects place_of_publication (previously unmapped)', () => {
    const rawText = 'Roe B. Field guide. London: Example Press; 2018.';
    const rows = buildBioSupervisionRowsFromStyleGold([
      {
        raw_text: rawText,
        expected_fields: {
          authors: 'Roe B',
          bookTitle: 'Field guide',
          placeOfPublication: 'London',
          publisher: 'Example Press',
          year: '2018',
        },
        trust_level: 'gold',
        input_hash: hashInputForTruth(rawText),
        provenance: 'unit-test',
      },
    ]);

    expect(rows[0]!.bio_tags).toContain('B-place_of_publication');
  });
});
