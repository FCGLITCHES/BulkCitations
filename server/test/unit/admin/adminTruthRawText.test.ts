import { describe, expect, it } from 'vitest';
import type { StoredApprovedTruth } from '../../../src/runtime/store.js';
import {
  findApprovedTruthByAdminRawText,
  hashAdminTruthRawText,
  normalizeAdminTruthRawText,
} from '../../../src/admin/adminTruthRawText.js';
import { hashInputForTruth } from '../../../src/training/truthHash.js';

function buildTruthRow(input: {
  id: string;
  rawText: string;
  inputHash?: string;
}): StoredApprovedTruth {
  const now = '2026-04-23T00:00:00.000Z';
  return {
    id: input.id,
    inputHash: input.inputHash ?? hashInputForTruth(input.rawText),
    rawText: input.rawText,
    expectedFields: { title: 'Example' },
    coreTruth: { title: 'Example' },
    overlayTruth: null,
    expectedType: null,
    expectedStyle: null,
    provenance: null,
    pipelineMajor: null,
    datasetSplit: null,
    trustLevel: 'reviewed',
    rowStatus: 'reviewed',
    blockedReason: null,
    taskCertifications: null,
    workId: null,
    familyId: null,
    variantId: null,
    canonicalWorkKey: null,
    nearDupClusterId: null,
    datasetVersion: null,
    inputProfile: null,
    styleInferabilityTier: null,
    styleEvaluationSuite: null,
    isAdversarial: null,
    difficultyTier: null,
    highImpact: null,
    highImpactReason: null,
    holdoutVersion: null,
    inferabilityByField: null,
    goldKind: null,
    adversarialPair: null,
    noiseProfile: null,
    approvalSource: null,
    reviewedBy: null,
    reviewedAt: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('adminTruthRawText', () => {
  it('strips admin-only leading numbering before hashing truth rows', () => {
    const canonicalRaw =
      'Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.';

    expect(normalizeAdminTruthRawText(`22. ${canonicalRaw}`)).toBe(canonicalRaw);
    expect(hashAdminTruthRawText(`22. ${canonicalRaw}`)).toBe(
      hashAdminTruthRawText(canonicalRaw),
    );
  });

  it('matches legacy numbered approved-truth rows by normalized admin raw text', () => {
    const canonicalRaw =
      'Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.';
    const legacyNumberedRaw = `22. ${canonicalRaw}`;
    const legacyRow = buildTruthRow({
      id: 'legacy-row',
      rawText: legacyNumberedRaw,
      inputHash: hashInputForTruth(legacyNumberedRaw),
    });

    expect(
      findApprovedTruthByAdminRawText([legacyRow], canonicalRaw),
    ).toMatchObject({
      id: 'legacy-row',
      rawText: legacyNumberedRaw,
    });
  });
});
