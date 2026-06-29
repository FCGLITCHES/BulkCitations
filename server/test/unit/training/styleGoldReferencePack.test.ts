import { describe, expect, it } from 'vitest';
import {
  buildGoldReferenceManifest,
  goldReferenceManifestCandidateCounts,
  goldReferenceManifestCandidateCountsFromRows,
  mapGoldReferenceGoldRowToApprovedTruth,
  mapGoldReferenceQuarantineRowToApprovedTruth,
  normalizeGoldReferenceDatasetSplit,
  resolveGoldReferenceReportCreatedAt,
  resolveGoldReferenceReportDatasetVersion,
  resolveGoldReferenceReportGoldRows,
  resolveGoldReferenceReportInputFile,
  resolveGoldReferenceReportQuarantineRows,
  type GoldReferenceCurationReport,
  type GoldReferenceGoldAuditRow,
  type GoldReferenceQuarantineAuditRow,
} from '../../../src/training/styleGoldReferencePack.js';

describe('styleGoldReferencePack', () => {
  it('normalizes validation splits and builds certified gold imports', () => {
    const row: GoldReferenceGoldAuditRow = {
      record_id: 'cite_123',
      raw_text: 'Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50.',
      expected_style: 'apa7',
      expected_type: 'article-journal',
      gold_decision: 'gold_reference',
      gold_reject_reasons: [],
      original_line_number: 32,
      dataset_split: 'validation',
      source_metadata: {
        gold_kind: 'style_clean',
        source_prefix: '10.1000',
        canonical_work_key: 'doi:10.1000/example',
        near_dup_cluster_id: 'doi:10.1000/example',
      },
    };

    const mapped = mapGoldReferenceGoldRowToApprovedTruth(row, {
      datasetVersion: 'style-core-gold-auto-curated-v1',
      reviewedBy: 'system:test',
      certifiedAt: '2026-04-23T00:00:00.000Z',
    });

    expect(normalizeGoldReferenceDatasetSplit('validation')).toBe('val');
    expect(mapped.datasetSplit).toBe('val');
    expect(mapped.trustLevel).toBe('gold');
    expect(mapped.rowStatus).toBe('reviewed');
    expect(mapped.taskCertifications).toHaveLength(1);
    expect(mapped.styleEvaluationSuite).toBe('supported_exact');
    expect(mapped.styleInferabilityTier).toBe('tier2_exact_policy_resolved');
    expect(mapped.goldKind).toBe('style_clean');
    expect(mapped.provenance).toBe('crossref:10.1000');
    expect(mapped.variantId).toBe('cite_123');
  });

  it('preserves v2 field-rich gold metadata from the updated pack schema', () => {
    const row: GoldReferenceGoldAuditRow = {
      record_id: 'cite_fields_123',
      raw_text: 'Ali, A. (2022). Example article. Journal of Examples. https://doi.org/10.1000/example',
      expected_fields: {
        authors: 'Ali, A.',
        title: 'Example article',
        year: '2022',
        journal: 'Journal of Examples',
        doi: '10.1000/example',
      },
      expected_style: 'apa7',
      expected_type: 'article-journal',
      gold_decision: 'gold_reference',
      blocked_reason: null,
      gold_reject_reasons: [],
      original_line_number: 1,
      dataset_split: 'train',
      trust_level: 'gold',
      row_status: 'reviewed',
      approval_source: 'manual',
      pipeline_major: 1,
      holdout_version: null,
      style_evaluation_suite: 'supported_exact',
      style_inferability_tier: 'tier1_exact_direct',
      provenance: 'crossref:10.1515; reference_doi:10.1000/example; precert_line:1',
      work_id: 'doi:10.1000/example',
      family_id: 'doi:10.1515/family',
      variant_id: 'cite_fields_123',
      source_metadata: {
        gold_kind: 'style_clean',
        canonical_work_key: 'doi:10.1515/family',
        near_dup_cluster_id: 'doi:10.1515/family',
      },
    };

    const mapped = mapGoldReferenceGoldRowToApprovedTruth(row, {
      datasetVersion: 'style-core-gold-auto-curated-v2-fields',
      reviewedBy: 'system:test',
      certifiedAt: '2026-04-23T00:00:00.000Z',
    });

    expect(mapped.expectedFields).toEqual(row.expected_fields);
    expect(mapped.coreTruth).toEqual(row.expected_fields);
    expect(mapped.provenance).toBe('crossref:10.1515');
    expect(mapped.pipelineMajor).toBe(1);
    expect(mapped.workId).toBe('doi:10.1000/example');
    expect(mapped.familyId).toBe('doi:10.1515/family');
    expect(mapped.canonicalWorkKey).toBe('doi:10.1515/family');
    expect(mapped.nearDupClusterId).toBe('doi:10.1515/family');
    expect(mapped.styleInferabilityTier).toBe('tier1_exact_direct');
    expect(mapped.styleEvaluationSuite).toBe('supported_exact');
    expect(mapped.approvalSource).toBe('manual');
    expect(mapped.datasetVersion).toBe('style-core-gold-auto-curated-v2-fields');
    expect(mapped.notes).toContain('pack_provenance=crossref:10.1515; reference_doi:10.1000/example; precert_line:1');
  });

  it('maps quarantined rows to reviewed/quarantined truth rows', () => {
    const row: GoldReferenceQuarantineAuditRow = {
      record_id: 'cite_456',
      raw_text: 'Kirchherr, J., Reike, D., & Hekkert, M. (2017). Conceptualizing the circular economy...',
      expected_style: null,
      expected_type: null,
      gold_decision: 'quarantine_review',
      gold_reject_reasons: ['duplicate_normalized_raw_text', 'style_uncertain'],
      original_line_number: 99,
      source_metadata: {
        gold_kind: 'style_noisy',
        source_prefix: '10.1007',
        noise_profile: ['whitespace', 'casefold'],
      },
    };

    const mapped = mapGoldReferenceQuarantineRowToApprovedTruth(row, {
      datasetVersion: 'style-core-gold-auto-curated-v1',
      reviewedBy: 'system:test',
    });

    expect(mapped.trustLevel).toBe('reviewed');
    expect(mapped.rowStatus).toBe('quarantined');
    expect(mapped.blockedReason).toBe('canonicalization_unclear');
    expect(mapped.taskCertifications).toBeNull();
    expect(mapped.goldKind).toBe('style_noisy');
    expect(mapped.noiseProfile).toEqual(['whitespace', 'casefold']);
    expect(mapped.notes).toContain('duplicate_normalized_raw_text');
  });

  it('preserves v2 quarantine governance fields without forcing review state', () => {
    const row: GoldReferenceQuarantineAuditRow = {
      record_id: 'cite_quarantine_123',
      raw_text: 'Levack WMM (2015) Goal setting and strategies...',
      expected_fields: {
        authors: 'Levack WMM',
        title: 'Goal setting and strategies',
        year: '2015',
      },
      expected_style: null,
      expected_type: null,
      gold_decision: 'quarantine_review',
      blocked_reason: 'inferability_conflict',
      gold_reject_reasons: ['style_uncertain'],
      dataset_split: 'train',
      trust_level: 'draft',
      row_status: 'quarantined',
      approval_source: 'learning_queue',
      pipeline_major: 1,
      style_evaluation_suite: 'unknown_or_ood',
      style_inferability_tier: 'tier4_not_inferable',
      provenance: 'crossref:10.1007; reference_doi:10.1000/example; precert_line:4',
      work_id: 'doi:10.1000/example',
      family_id: 'doi:10.1007/family',
      variant_id: 'cite_quarantine_123',
      source_metadata: {
        gold_kind: 'style_clean',
      },
    };

    const mapped = mapGoldReferenceQuarantineRowToApprovedTruth(row, {
      datasetVersion: 'style-core-gold-auto-curated-v2-fields',
      reviewedBy: 'system:test',
    });

    expect(mapped.expectedFields).toEqual(row.expected_fields);
    expect(mapped.trustLevel).toBe('draft');
    expect(mapped.rowStatus).toBe('quarantined');
    expect(mapped.blockedReason).toBe('inferability_conflict');
    expect(mapped.reviewedBy).toBeNull();
    expect(mapped.pipelineMajor).toBe(1);
    expect(mapped.approvalSource).toBe('learning_queue');
    expect(mapped.styleEvaluationSuite).toBe('unknown_or_ood');
    expect(mapped.styleInferabilityTier).toBe('tier4_not_inferable');
    expect(mapped.provenance).toBe('crossref:10.1007');
    expect(mapped.workId).toBe('doi:10.1000/example');
    expect(mapped.familyId).toBe('doi:10.1007/family');
    expect(mapped.notes).toContain('pack_provenance=crossref:10.1007; reference_doi:10.1000/example; precert_line:4');
  });

  it('resolves v2 report metadata and derives candidate counts from rows when report counts are absent', () => {
    const report: GoldReferenceCurationReport = {
      input_file: 'style-core-freeze.precert-pool.ndjson',
      dataset_version: 'style-core-gold-auto-curated-v2-fields',
      created_at_utc: '2026-04-23T03:07:17Z',
      row_counts: {
        input_rows: 20_250,
        gold_reference_rows: 7_197,
        quarantine_review_rows: 13_053,
      },
    };

    expect(resolveGoldReferenceReportInputFile(report)).toBe('style-core-freeze.precert-pool.ndjson');
    expect(resolveGoldReferenceReportDatasetVersion(report)).toBe('style-core-gold-auto-curated-v2-fields');
    expect(resolveGoldReferenceReportCreatedAt(report)).toBe('2026-04-23T03:07:17Z');
    expect(resolveGoldReferenceReportGoldRows(report)).toBe(7_197);
    expect(resolveGoldReferenceReportQuarantineRows(report)).toBe(13_053);
    expect(
      goldReferenceManifestCandidateCountsFromRows([
        { gold_kind: 'style_clean' },
        { gold_kind: 'style_adversarial' },
        { source_metadata: { gold_kind: 'style_noisy' } },
      ]),
    ).toEqual({
      styleClean: 1,
      styleAdversarial: 1,
      styleNoisy: 1,
    });
  });

  it('builds manifest counts from imported gold rows', () => {
    const report: GoldReferenceCurationReport = {
      input_file: 'style-core-freeze.precert-pool.ndjson',
      curation_version: 'style-core-gold-auto-curated-v1',
      curation_date: '2026-04-23',
      gold_rows: 2,
      quarantine_rows: 3,
      gold_kind_counts: {
        style_clean: 1,
        style_adversarial: 1,
      },
      quarantine_kind_counts: {
        style_clean: 2,
        style_adversarial: 3,
        style_noisy: 4,
      },
    };

    const manifest = buildGoldReferenceManifest(
      [
        {
          id: 'row-1',
          inputHash: 'hash-1',
          rawText: 'A',
          expectedFields: {},
          coreTruth: {},
          expectedType: 'article-journal',
          expectedStyle: 'apa7',
          provenance: 'crossref:10.1000',
          pipelineMajor: null,
          datasetSplit: 'train',
          trustLevel: 'gold',
          rowStatus: 'reviewed',
          blockedReason: null,
          taskCertifications: [],
          workId: null,
          familyId: null,
          variantId: 'cite-1',
          canonicalWorkKey: 'doi:10.1000/a',
          nearDupClusterId: 'doi:10.1000/a',
          datasetVersion: report.curation_version,
          inputProfile: null,
          styleInferabilityTier: 'tier2_exact_policy_resolved',
          styleEvaluationSuite: 'supported_exact',
          isAdversarial: false,
          difficultyTier: null,
          highImpact: null,
          highImpactReason: null,
          holdoutVersion: null,
          inferabilityByField: null,
          goldKind: 'style_clean',
          adversarialPair: null,
          noiseProfile: null,
          approvalSource: null,
          reviewedBy: 'system:test',
          reviewedAt: '2026-04-23T00:00:00.000Z',
          notes: null,
          createdAt: '2026-04-23T00:00:00.000Z',
          updatedAt: '2026-04-23T00:00:00.000Z',
        },
        {
          id: 'row-2',
          inputHash: 'hash-2',
          rawText: 'B',
          expectedFields: {},
          coreTruth: {},
          expectedType: 'book',
          expectedStyle: 'harvard-ctr',
          provenance: 'crossref:10.1007',
          pipelineMajor: null,
          datasetSplit: 'test',
          trustLevel: 'gold',
          rowStatus: 'reviewed',
          blockedReason: null,
          taskCertifications: [],
          workId: null,
          familyId: null,
          variantId: 'cite-2',
          canonicalWorkKey: 'doi:10.1000/b',
          nearDupClusterId: 'doi:10.1000/b',
          datasetVersion: report.curation_version,
          inputProfile: null,
          styleInferabilityTier: 'tier2_exact_policy_resolved',
          styleEvaluationSuite: 'supported_exact',
          isAdversarial: true,
          difficultyTier: null,
          highImpact: null,
          highImpactReason: null,
          holdoutVersion: null,
          inferabilityByField: null,
          goldKind: 'style_adversarial',
          adversarialPair: 'apa7_vs_harvard-ctr',
          noiseProfile: null,
          approvalSource: null,
          reviewedBy: 'system:test',
          reviewedAt: '2026-04-23T00:00:00.000Z',
          notes: null,
          createdAt: '2026-04-23T00:00:00.000Z',
          updatedAt: '2026-04-23T00:00:00.000Z',
        },
      ],
      {
        datasetVersion: report.curation_version,
        createdAt: '2026-04-23T00:00:00.000Z',
        candidates: goldReferenceManifestCandidateCounts(report),
      },
    );

    expect(manifest.rowCount).toBe(2);
    expect(manifest.composition.styleClean).toBe(1);
    expect(manifest.composition.styleAdversarial).toBe(1);
    expect(manifest.composition.byStyle.apa7).toBe(1);
    expect(manifest.composition.byPair['apa7_vs_harvard-ctr']).toBe(1);
    expect(manifest.candidates.styleNoisy).toBe(4);
    expect(manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
