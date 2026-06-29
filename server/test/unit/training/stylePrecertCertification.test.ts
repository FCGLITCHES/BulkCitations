import { describe, expect, it } from 'vitest';
import {
  certifyPreparedStylePrecertPool,
  prepareStylePrecertPool,
  type CrossrefEnrichment,
  type StylePrecertPoolRow,
} from '../../../src/training/stylePrecertCertification.js';

function prepare(rows: StylePrecertPoolRow[]) {
  return prepareStylePrecertPool(rows, {
    datasetVersion: 'style-core-freeze-2026-04-13T22-43-05-056Z',
  });
}

describe('stylePrecertCertification', () => {
  it('drops exact clean/noisy duplicates and preserves the noisy augmentation source', () => {
    const prepared = prepare([
      {
        raw_text: 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
        expected_style: 'apa7',
        expected_type: 'article-journal',
        gold_kind: 'style_clean',
        canonical_work_key: 'doi:10.1000/example',
        near_dup_cluster_id: 'doi:10.1000/example',
        reference_doi: '10.1000/example',
        style_confidence: 1,
        family_confidence: 1,
        style_margin_to_runner_up: 1,
      },
      {
        raw_text: 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
        expected_style: 'apa7',
        expected_type: 'article-journal',
        gold_kind: 'style_noisy',
        style_confidence: 1,
        family_confidence: 1,
        style_margin_to_runner_up: 1,
      },
    ]);

    const result = certifyPreparedStylePrecertPool(
      prepared,
      new Map<string, CrossrefEnrichment>([
        [
          'doi:10.1000/example',
          {
            status: 'resolved_doi',
            match_confidence: 'high',
            fields: {
              doi: '10.1000/example',
              reference_type: 'article-journal',
            },
          },
        ],
      ]),
    );

    const clean = result.rows.find((row) => row.gold_kind === 'style_clean');
    const noisy = result.rows.find((row) => row.gold_kind === 'style_noisy');

    expect(clean?.suggested_action).toBe('keep');
    expect(noisy?.augmentation_source_record_id).toBe(clean?.record_id ?? null);
    expect(noisy?.suggested_action).toBe('drop_duplicate_noisy');
    expect(noisy?.issue_codes).toContain('duplicate_exact_clean_noisy');
    expect(result.sanitizedRows).toHaveLength(1);
    expect(result.reviewQueue).toHaveLength(1);
  });

  it('drops whitespace-only noisy variants after normalized matching', () => {
    const prepared = prepare([
      {
        raw_text: '39. Schein, Edgar H. Organizational Culture and Leadership. San Francisco: John Wiley & Sons, 2010.',
        expected_style: 'vancouver',
        expected_type: 'book',
        gold_kind: 'style_clean',
        canonical_work_key: 'doi:10.1000/book',
        near_dup_cluster_id: 'doi:10.1000/book',
        reference_doi: '10.1000/book',
        style_confidence: 1,
        family_confidence: 1,
        style_margin_to_runner_up: 1,
      },
      {
        raw_text: '39. Schein, Edgar H. Organizational Culture and Leadership. San Francisco:  John Wiley & Sons, 2010.',
        expected_style: 'vancouver',
        expected_type: 'book',
        gold_kind: 'style_noisy',
        style_confidence: 1,
        family_confidence: 1,
        style_margin_to_runner_up: 1,
      },
    ]);

    const result = certifyPreparedStylePrecertPool(prepared, new Map());
    const noisy = result.rows.find((row) => row.gold_kind === 'style_noisy');

    expect(noisy?.suggested_action).toBe('drop_duplicate_noisy');
    expect(noisy?.issue_codes).toContain('duplicate_normalized_clean_noisy');
  });

  it('flags numeric style-marker conflicts and crossref type mismatches for review', () => {
    const prepared = prepare([
      {
        raw_text:
          '[15] C. Raiciu, D. Wischik, and M. Handley, "Balancing resource pooling and equipoise in multipath transport," Proc. 7th USENIX NSDI Conf., 2010.',
        expected_style: 'chicago-notes-bib',
        expected_type: 'book-chapter',
        gold_kind: 'style_clean',
        canonical_work_key: 'doi:10.1000/raiciu',
        near_dup_cluster_id: 'doi:10.1000/raiciu',
        style_confidence: 1,
        family_confidence: 1,
        style_margin_to_runner_up: 1,
      },
    ]);

    const result = certifyPreparedStylePrecertPool(
      prepared,
      new Map<string, CrossrefEnrichment>([
        [
          'doi:10.1000/raiciu',
          {
            status: 'resolved_doi',
            match_confidence: 'high',
            fields: {
              doi: '10.1000/raiciu',
              reference_type: 'conference-paper',
            },
          },
        ],
      ]),
    );

    expect(result.rows[0]?.style_marker_flags).toContain('chicago-notes-bib_starts_ieee_bracket');
    expect(result.rows[0]?.proposed_expected_style).toBe('ieee');
    expect(result.rows[0]?.proposed_expected_type).toBe('conference-paper');
    expect(result.rows[0]?.suggested_action).toBe('review_style_and_type');
  });

  it('inherits the source cluster split for mapped noisy augmentations', () => {
    const prepared = prepare([
      {
        raw_text: 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
        expected_style: 'apa7',
        expected_type: 'article-journal',
        gold_kind: 'style_clean',
        canonical_work_key: 'doi:10.1000/example',
        near_dup_cluster_id: 'doi:10.1000/example',
        reference_doi: '10.1000/example',
        style_confidence: 1,
        family_confidence: 1,
        style_margin_to_runner_up: 1,
      },
      {
        raw_text: 'smith, j. (2020). example article. Journal of Examples, 12(3), 44-50.',
        expected_style: 'apa7',
        expected_type: 'article-journal',
        gold_kind: 'style_noisy',
        style_confidence: 0.95,
        family_confidence: 0.95,
        style_margin_to_runner_up: 0.4,
      },
    ]);

    const clean = prepared.rows.find((row) => row.gold_kind === 'style_clean');
    const noisy = prepared.rows.find((row) => row.gold_kind === 'style_noisy');

    expect(noisy?.augmentation_source_record_id).toBe(clean?.record_id ?? null);
    expect(noisy?.cluster_key).toBe(clean?.cluster_key);
    expect(noisy?.suggested_dataset_split).toBe(clean?.suggested_dataset_split);
    expect(noisy?.lookup_key).toBe(clean?.lookup_key);
  });
});
