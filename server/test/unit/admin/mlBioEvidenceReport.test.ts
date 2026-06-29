import { describe, expect, it } from 'vitest';

import {
  buildBioPrimaryApplicability,
  buildBioPrimaryPromotionGate,
  buildBrowserPerformanceGate,
  buildEvidenceBundle,
  buildThroughputSummary,
  buildTypeMlEvaluation,
  computeDuplicateEvaluation,
  computeFieldScores,
  evaluateDecisionGates,
  summarizeHealthHotspotAudit,
  summarizeBioAttribution,
  type EvidenceComparison,
  type EvidenceModeSummary,
} from '../../../src/admin/mlBioEvidenceReport.js';
import type { ConvertResponse } from '../../../src/engine/types/api.js';
import type { ProcessedCitation } from '../../../src/engine/types/citation.js';

const row = (rawText: string, expectedFields: Record<string, unknown>, id = 'row-1') => ({
  id,
  rawText,
  expectedFields,
});

const reference = (overrides: Partial<ProcessedCitation>): ProcessedCitation => ({
  id: 'ref-1',
  index: 0,
  raw: 'Doe, J. (2020). Correct title. Journal.',
  fields: {},
  renderedText: 'Doe, J. (2020). Correct title. Journal.',
  detectedStyle: 'apa',
  referenceType: 'journal',
  confidence: 0.9,
  publicStatus: 'ready',
  status: 'ready',
  healthReasons: [],
  healthWarnings: [],
  issues: [],
  stageLog: [],
  isDuplicateCandidate: false,
  ...overrides,
} as unknown as ProcessedCitation);

const summary = (
  mode: EvidenceModeSummary['mode'],
  ready: number,
  falseReady: number,
  malformedBioAccepted: number,
): EvidenceModeSummary => ({
  mode,
  layer: mode === 'heuristics_only' ? 'component' : 'product_path',
  datasetId: 'gold_style_core',
  parseProfile: 'core_parse_full',
  runtimeProfile: 'site_default',
  referenceCount: 2,
  wallClockMs: 10,
  refsPerSecond: 200,
  summary: {
    total: 2,
    ready,
    needsReview: 2 - ready,
    needsAction: 0,
    failed: 0,
    duplicates: 0,
    styles: {},
  },
  effectivePolicy: {
    laneLabel: mode,
    whatThisLaneMeans: mode,
    requestedParseProfile: 'core_parse_full',
    effectiveParseProfile: 'core_parse_full',
    requestedRuntimeProfile: 'site_default',
    effectiveRuntimeProfile: 'site_default',
    styleMl: 'off',
    authorMl: 'off',
    extractionMl: 'off',
    bioExtraction: 'off',
    typeMl: 'off',
    providers: 'off',
    llmFallback: 'off',
    batchSize: 1,
    maxConcurrency: 1,
    overrideReasons: [],
  },
  throughputLanes: {
    directEngineRefsPerSecond: 200,
    directEnginePlusReportRefsPerSecond: 180,
    backendConvertRouteRefsPerSecond: null,
    queuedJobRuntimeRefsPerSecond: null,
    browserSubmitToResultsRefsPerSecond: null,
    browserFirstPaintRefsPerSecond: null,
    browserAllRenderedRefsPerSecond: null,
  },
  stageBottlenecks: [],
  fieldScores: {},
  readiness: {
    ready,
    needsReview: 2 - ready,
    needsAction: 0,
    failed: 0,
    falseReady,
    falseActionNeeded: 0,
  },
  qualityGate: {
    status: malformedBioAccepted === 0 ? 'pass' : 'fail',
    plainReason: 'test',
    checks: [],
  },
  performanceGate: {
    status: 'not_applicable',
    plainReason: 'test',
    checks: [],
  },
  duplicateMetrics: {
    predictedGroups: 0,
    predictedPairs: 0,
    expectedPairs: 0,
    pairPrecision: 0,
    pairRecall: 0,
    falseDuplicateGroups: 0,
    missedDuplicatePairs: 0,
    largestBadCluster: 0,
    causeCounts: {},
  },
  bioAttribution: {
    entityEmitted: 0,
    entityStructurallyValid: 0,
    entityGrounded: 0,
    fieldCandidateProduced: 0,
    patchAttempted: 0,
    patchAccepted: 0,
    patchRejected: 0,
    patchImprovedGoldScore: 0,
    patchWorsenedGoldScore: 0,
    patchNoOp: 0,
    blockedByDiagnostics: 0,
    blockedByMalformedSequence: 0,
    blockedByOverlap: 0,
    blockedBySpanIssue: 0,
    blockedByGrounding: 0,
    blockedByNonRegressionGuard: 0,
    missingRequiredMlSpanWarnings: 0,
    byLabel: {},
  },
  bioQuality: {
    truthAvailable: true,
    bioWasActive: false,
    bioMode: 'off',
    refsWithBioOutput: 0,
    bioAcceptedChanges: 0,
    bioRejectedChanges: 0,
    bioHelpedCount: 0,
    bioHarmedAcceptedCount: 0,
    bioBlockedUnsafeCount: 0,
    bioNoOpCount: 2,
    topRejectedReasons: {},
    plainSummary: 'test',
  },
  mlAttribution: {
    eligibleRefs: 2,
    routedRefs: 2,
    attemptedRefs: 2,
    abstainedRefs: 0,
    acceptedRefs: 2,
    rejectedRefs: 0,
    noOpRefs: 0,
    rawMlOutputRefs: 2,
    afterStructuralGuardsRefs: 2,
    afterGroundingGuardsRefs: 2,
    afterNonRegressionGuardsRefs: 2,
    finalHybridRefs: 2,
    malformedBioAccepted,
    acceptedPatchPrecision: 1,
  },
  regressionExamples: [],
});

describe('ML/BIO evidence report helpers', () => {
  it('reports that BIO is intended as a primary early-phase parser but is not fully integrated yet', () => {
    const map = buildBioPrimaryApplicability();

    expect(map.map((phase) => phase.phaseId)).toEqual([
      'phase1_ingestion',
      'phase2_splitting',
      'phase3_style',
      'phase4_extraction',
    ]);
    expect(map.find((phase) => phase.phaseId === 'phase2_splitting')?.intendedRole).toContain('primary candidate splitter');
    expect(map.find((phase) => phase.phaseId === 'phase2_splitting')?.currentStatus).toBe('not_integrated');
    expect(map.find((phase) => phase.phaseId === 'phase4_extraction')?.currentStatus).toBe('selective_patch');
  });

  it('scores field precision and recall without hiding critical losses', () => {
    const scores = computeFieldScores([
      row('Doe, J. (2020). Correct title. Journal.', {
        title: 'Correct title',
        year: 2020,
      }),
    ], [
      reference({
        fields: {
          title: { value: 'Wrong title', confidence: 0.8, source: 'ml' },
          year: { value: '2020', confidence: 0.99, source: 'heuristic' },
        },
      }),
    ]);

    expect(scores.title).toMatchObject({ tp: 0, fp: 1, fn: 1, f1: 0 });
    expect(scores.year).toMatchObject({ tp: 1, fp: 0, fn: 0, f1: 1 });
  });

  it('attributes BIO entities, diagnostic blocks, and gold-improving or worsening patches', () => {
    const attribution = summarizeBioAttribution([
      row('Doe, J. (2020). Correct title. Journal.', {
        title: 'Correct title',
        year: 2020,
      }),
    ], [
      reference({
        raw: 'Doe, J. (2020). Correct title. Journal.',
        healthWarnings: [{ code: 'missing_required_ml_span', message: 'Missing required ML span.' }],
        extractionMeta: {
          runMode: 'ml',
          bio: {
            entities: [
              {
                label: 'TITLE',
                field: 'title',
                text: 'Correct title',
                start: 15,
                end: 28,
                valid: true,
                diagnostics: [],
              },
              {
                label: 'AUTHOR',
                field: 'authors',
                text: 'Not in raw',
                start: 0,
                end: 10,
                valid: false,
                diagnostics: [{ code: 'offset_mismatch', message: 'Invalid offset.' }],
              },
            ],
            diagnostics: [
              { code: 'unclosed_bio_sequence', message: 'Malformed sequence.' },
              { code: 'overlapping_spans', message: 'Overlapping spans.' },
            ],
          },
          shadowDiff: {
            baselineFields: { title: 'Wrong title', year: 2020 },
            mlFields: { title: 'Correct title', year: 'not-a-year' },
            perFieldDiff: { title: 'changed', year: 'changed' },
          },
        },
      }),
    ]);

    expect(attribution.entityEmitted).toBe(2);
    expect(attribution.entityStructurallyValid).toBe(1);
    expect(attribution.entityGrounded).toBe(1);
    expect(attribution.fieldCandidateProduced).toBe(2);
    expect(attribution.patchAttempted).toBe(2);
    expect(attribution.patchAccepted).toBe(2);
    expect(attribution.patchImprovedGoldScore).toBe(1);
    expect(attribution.patchWorsenedGoldScore).toBe(1);
    expect(attribution.blockedByDiagnostics).toBe(1);
    expect(attribution.blockedByMalformedSequence).toBe(1);
    expect(attribution.blockedByOverlap).toBe(1);
    expect(attribution.blockedBySpanIssue).toBe(1);
    expect(attribution.blockedByGrounding).toBe(1);
    expect(attribution.missingRequiredMlSpanWarnings).toBe(1);
    expect(attribution.byLabel.AUTHOR.invalid).toBe(1);
  });

  it('fails decision gates when candidate loses readiness, critical fields, or accepts malformed BIO', () => {
    const comparisons: EvidenceComparison[] = [{
      datasetId: 'gold_style_core',
      candidateMode: 'hybrid_with_bio_candidate_shadow',
      baselineMode: 'heuristics_only',
      readinessTransitions: { 'heuristic_ready->candidate_non_ready': 1 },
      criticalFieldLossCount: 2,
      wrongOverwriteCount: 1,
      improved: 0,
      regressed: 1,
      unchangedCorrect: 1,
      unchangedWrong: 0,
      noOp: 0,
      newFalsePositive: 1,
      newFalseNegative: 0,
      examples: [],
      fieldDiffExamples: [],
      qualityGate: {
        status: 'fail',
        plainReason: 'test',
        checks: [],
      },
      performanceGate: {
        status: 'not_applicable',
        plainReason: 'test',
        checks: [],
      },
    }];

    const gates = evaluateDecisionGates([
      summary('heuristics_only', 2, 0, 0),
      summary('hybrid_with_bio_candidate_shadow', 1, 1, 1),
    ], comparisons);

    expect(gates.status).toBe('fail');
    expect(gates.checks.filter((check) => check.status === 'fail').map((check) => check.id)).toEqual([
      'ready_count_not_lower',
      'false_ready_not_higher',
      'critical_field_loss_zero',
      'malformed_bio_accepted_zero',
    ]);
  });

  it('does not treat direct engine speed as browser throughput', () => {
    const baseline = summary('heuristics_only', 2, 0, 0);
    const browser = {
      ...summary('browser_site_default_current', 2, 0, 0),
      datasetId: 'pasted_input' as const,
      refsPerSecond: 250,
      throughputLanes: {
        ...summary('browser_site_default_current', 2, 0, 0).throughputLanes,
        directEngineRefsPerSecond: 250,
        browserAllRenderedRefsPerSecond: null,
      },
    };

    const gates = evaluateDecisionGates([
      baseline,
      summary('hybrid_with_bio_candidate_shadow', 2, 0, 0),
    ], []);
    const throughputSummary = buildThroughputSummary([browser], gates, []);

    expect(throughputSummary.claimStatus).toBe('browser_not_measured');
    expect(throughputSummary.plainSummary).toContain('Direct engine speed was 250 refs/sec');
    expect(throughputSummary.plainSummary).toContain('browser throughput has not been measured');
    expect(throughputSummary.lanes.find((lane) => lane.id === 'browser_all_rendered')?.refsPerSecond).toBeNull();
  });

  it('blocks BIO-primary promotion until browser all-rendered timing is measured', () => {
    const candidate = summary('hybrid_with_bio_candidate_shadow', 2, 0, 0);
    const gates = evaluateDecisionGates([
      summary('heuristics_only', 2, 0, 0),
      candidate,
    ], []);
    const throughputSummary = buildThroughputSummary([candidate], gates, []);
    const promotion = buildBioPrimaryPromotionGate([candidate], [], gates, throughputSummary);

    expect(promotion.status).toBe('not_measured');
    expect(promotion.checks.find((check) => check.id === 'browser_all_rendered_measured')?.status).toBe('not_measured');
  });

  it('summarizes release readiness without treating missing browser or data audit evidence as promotion-ready', () => {
    const candidate = summary('hybrid_with_bio_candidate_shadow', 2, 0, 0);
    const gates = evaluateDecisionGates([
      summary('heuristics_only', 2, 0, 0),
      candidate,
    ], []);
    const throughputSummary = buildThroughputSummary([candidate], gates, []);
    const promotion = buildBioPrimaryPromotionGate([candidate], [], gates, throughputSummary);
    const bundle = buildEvidenceBundle(
      [candidate],
      [],
      gates,
      throughputSummary,
      promotion,
      [{
        id: 'gold_style_core',
        label: 'style_gold:test',
        truthAvailable: true,
        rowCount: 2,
        sha256: 'sha256:test',
      }],
      [],
    );

    expect(bundle.cards.quality.status).toBe('pass');
    expect(bundle.cards.siteSpeed.status).toBe('not_measured');
    expect(bundle.cards.trainingData.status).toBe('not_measured');
    expect(bundle.cards.safeRollout.status).toBe('warning');
    expect(bundle.finalVerdict).toBe('ready_for_shadow_testing');
    expect(bundle.promotionAllowed).toBe(false);
    expect(bundle.topBlockingReasons).toContain('Real Site Speed: Real site speed has not been measured.');
    expect(bundle.advanced.liveBehaviorChanged).toBe(false);
  });

  it('blocks release readiness when parser quality fails', () => {
    const candidate = summary('hybrid_with_bio_candidate_shadow', 1, 1, 1);
    const gates = evaluateDecisionGates([
      summary('heuristics_only', 2, 0, 0),
      candidate,
    ], []);
    const throughputSummary = buildThroughputSummary([candidate], gates, []);
    const promotion = buildBioPrimaryPromotionGate([candidate], [], gates, throughputSummary);
    const bundle = buildEvidenceBundle(
      [candidate],
      [],
      gates,
      throughputSummary,
      promotion,
      [{
        id: 'gold_style_core',
        label: 'style_gold:test',
        truthAvailable: true,
        rowCount: 2,
        sha256: 'sha256:test',
      }],
      [],
    );

    expect(bundle.cards.quality.status).toBe('fail');
    expect(bundle.cards.siteSpeed.status).toBe('blocked');
    expect(bundle.cards.safeRollout.status).toBe('blocked');
    expect(bundle.finalVerdict).toBe('not_ready');
    expect(bundle.promotionAllowed).toBe(false);
  });

  it('passes browser performance only when all-rendered throughput meets target', () => {
    const passGate = buildBrowserPerformanceGate(summary('browser_site_default_current', 2, 0, 0).qualityGate, 210);
    const failGate = buildBrowserPerformanceGate(summary('browser_site_default_current', 2, 0, 0).qualityGate, 120);

    expect(passGate.status).toBe('pass');
    expect(failGate.status).toBe('fail');
  });

  it('shows when type ML helps or would hurt compared with heuristics', () => {
    const rows = [
      row('Doe J. Correct article. Journal. 2020.', { title: 'Correct article' }),
      row('Smith J. Correct book. Publisher; 2021.', { title: 'Correct book' }),
    ].map((entry, index) => ({
      ...entry,
      expectedType: index === 0 ? 'article-journal' : 'book',
    }));
    const baseline = [
      reference({ index: 0, referenceType: 'article-journal' }),
      reference({ id: 'ref-2', index: 1, referenceType: 'unknown' }),
    ];
    const candidate = [
      reference({ index: 0, referenceType: 'book' }),
      reference({ id: 'ref-2', index: 1, referenceType: 'book' }),
    ];

    const evaluation = buildTypeMlEvaluation(rows, baseline, candidate);

    expect(evaluation.helped).toBe(1);
    expect(evaluation.hurtIfAccepted).toBe(1);
    expect(evaluation.heuristicCorrectMlWrong).toBe(1);
    expect(evaluation.heuristicWrongMlCorrect).toBe(1);
    expect(evaluation.recommendation).toBe('keep_shadow');
  });

  it('reconciles action-needed citations with visible hotspot reasons', () => {
    const audit = summarizeHealthHotspotAudit([
      reference({
        publicStatus: 'needs_action',
        healthWarnings: [{ code: 'missing_title', message: 'Title is missing.' }],
      }),
      reference({
        id: 'ref-2',
        index: 1,
        publicStatus: 'needs_action',
        raw: 'No visible reason.',
      }),
    ]);

    expect(audit.needsAction).toBe(2);
    expect(audit.visibleReasons).toBe(1);
    expect(audit.needsActionWithoutVisibleReason).toBe(1);
    expect(audit.topCauses.missing_title).toBe(1);
    expect(audit.topCauses.missing_visible_health_reason).toBe(1);
    expect(audit.examples[0]?.technicalReason).toBe('missing_visible_health_reason');
  });

  it('audits duplicate precision and reports false-positive causes', () => {
    const rows = [
      row('A. Same title. Journal. 2020.', { title: 'Same title', year: 2020 }, 'row-1'),
      row('B. Same title. Journal. 2020.', { title: 'Same title', year: 2020 }, 'row-2'),
      row('C. Different title. Journal. 2020.', { title: 'Different title', year: 2020 }, 'row-3'),
    ];
    const response = {
      references: [
        reference({ id: 'a', index: 0, raw: rows[0]!.rawText }),
        reference({ id: 'b', index: 1, raw: rows[1]!.rawText }),
        reference({ id: 'c', index: 2, raw: rows[2]!.rawText }),
      ],
      duplicateGroups: [
        { groupId: 'correct', method: 'title_year', memberIds: ['a', 'b'] },
        { groupId: 'false-positive', method: 'normalized_string', memberIds: ['a', 'c'] },
      ],
    } as unknown as ConvertResponse;

    const { metrics, audit } = computeDuplicateEvaluation(rows, response, true);

    expect(metrics.predictedGroups).toBe(2);
    expect(metrics.expectedPairs).toBe(1);
    expect(metrics.pairPrecision).toBe(0.5);
    expect(metrics.pairRecall).toBe(1);
    expect(metrics.falseDuplicateGroups).toBe(1);
    expect(audit.falsePositiveByMethod.normalized_string).toBe(1);
    expect(audit.falseDuplicateExamples[0]?.method).toBe('normalized_string');
  });
});
