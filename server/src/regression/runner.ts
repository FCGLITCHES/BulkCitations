import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPipelineDependencies } from '../pipeline/dependencies.js';
import { createPipelineContext, runConvertPipeline } from '../pipeline/orchestrator.js';
import { REGRESSION_FIXTURES, type RegressionCase } from './fixtures.js';
import { upsertApprovedTruthPayload } from '../runtime/persistence.js';

export interface RegressionCaseResult {
  id: string;
  suite: string;
  passed: boolean;
  failureMode: string;
  provenance: string;
  details: string[];
}

export interface RegressionRunRecord {
  id: string;
  createdAt: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  outputFile: string;
  results: RegressionCaseResult[];
}

const regressionRuns: RegressionRunRecord[] = [];

export async function runRegressionSuites(): Promise<RegressionRunRecord> {
  const createdAt = new Date().toISOString();
  const runId = createdAt.replace(/[:.]/g, '-');
  const results: RegressionCaseResult[] = [];

  for (const fixture of REGRESSION_FIXTURES) {
    await seedFixtureApprovedTruth(fixture);
    const ctx = createPipelineContext({
      outputStyle: fixture.input.outputStyle ?? 'apa7',
      ...(fixture.pipelineOptions ? { options: fixture.pipelineOptions } : {}),
    });
    const artifacts = await runConvertPipeline(fixture.input, ctx, createPipelineDependencies());
    results.push(evaluateFixture(fixture, artifacts.response));
  }

  const outputDirectory = fileURLToPath(new URL('../../../docs/test-results', import.meta.url));
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `regression-${runId}.md`);
  await writeFile(outputFile, renderMarkdown(createdAt, results), 'utf8');

  const record: RegressionRunRecord = {
    id: runId,
    createdAt,
    totalCases: results.length,
    passedCases: results.filter((result) => result.passed).length,
    failedCases: results.filter((result) => !result.passed).length,
    outputFile,
    results,
  };
  regressionRuns.unshift(record);
  return record;
}

export async function seedFixtureApprovedTruth(fixture: RegressionCase): Promise<void> {
  for (const seed of fixture.approvedTruthSeed ?? []) {
    await upsertApprovedTruthPayload({
      rawText: seed.rawText,
      expectedFields: seed.expectedFields,
      expectedType: seed.expectedType ?? null,
      expectedStyle: seed.expectedStyle ?? null,
      trustLevel: seed.trustLevel ?? 'gold',
      reviewedBy: seed.reviewedBy ?? 'regression-runner',
      provenance: seed.provenance ?? 'approved_truth_seed',
    });
  }
}

export function listRegressionRuns(): RegressionRunRecord[] {
  return regressionRuns;
}

export function evaluateFixture(fixture: RegressionCase, response: Awaited<ReturnType<typeof runConvertPipeline>>['response']): RegressionCaseResult {
  const details: string[] = [];
  const renderedValues = response.references.map((reference) => reference.renderedText ?? '');
  const expectedRenderedIncludes = Array.isArray(fixture.expected.renderedIncludes)
    ? fixture.expected.renderedIncludes
    : fixture.expected.renderedIncludes
      ? [fixture.expected.renderedIncludes]
      : [];
  const expectedRenderedExcludes = Array.isArray(fixture.expected.renderedExcludes)
    ? fixture.expected.renderedExcludes
    : fixture.expected.renderedExcludes
      ? [fixture.expected.renderedExcludes]
      : [];

  if (response.references.length !== fixture.expected.total) {
    details.push(`Expected ${fixture.expected.total} references, received ${response.references.length}.`);
  }

  if (fixture.expected.titleIncludes) {
    const title = response.references[0]?.fields.title.value ?? '';
    if (
      typeof title !== 'string' ||
      !title.toLowerCase().includes(fixture.expected.titleIncludes.toLowerCase())
    ) {
      details.push(`Expected title to include "${fixture.expected.titleIncludes}".`);
    }
  }

  for (const expectedInclude of expectedRenderedIncludes) {
    if (!renderedValues.some((rendered) => rendered.includes(expectedInclude))) {
      details.push(`Expected rendered text to include "${expectedInclude}".`);
    }
  }

  for (const expectedExclude of expectedRenderedExcludes) {
    if (renderedValues.some((rendered) => rendered.includes(expectedExclude))) {
      details.push(`Expected rendered text to exclude "${expectedExclude}".`);
    }
  }

  if (fixture.expected.detectedStyle) {
    const detectedStyle = response.references[0]?.detectedStyle;
    if (detectedStyle !== fixture.expected.detectedStyle) {
      details.push(`Expected detectedStyle "${fixture.expected.detectedStyle}", received "${detectedStyle ?? 'undefined'}".`);
    }
  }

  if (fixture.expected.detectedStyleFamily) {
    const detectedStyleFamily = response.references[0]?.detectedStyleFamily;
    if (detectedStyleFamily !== fixture.expected.detectedStyleFamily) {
      details.push(`Expected detectedStyleFamily "${fixture.expected.detectedStyleFamily}", received "${detectedStyleFamily ?? 'undefined'}".`);
    }
  }

  if (fixture.expected.inputStyleUncertain != null) {
    const inputStyleUncertain = response.references[0]?.inputStyleUncertain;
    if (inputStyleUncertain !== fixture.expected.inputStyleUncertain) {
      details.push(`Expected inputStyleUncertain=${fixture.expected.inputStyleUncertain}, received ${inputStyleUncertain ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.duplicateGroupCount != null && response.duplicateGroups.length !== fixture.expected.duplicateGroupCount) {
    details.push(`Expected ${fixture.expected.duplicateGroupCount} duplicate groups, received ${response.duplicateGroups.length}.`);
  }

  if (fixture.expected.authorityFlag) {
    const flags = response.references[0]?.authorityFlags.map((flag) => flag.type) ?? [];
    if (!flags.includes(fixture.expected.authorityFlag as never)) {
      details.push(`Expected authority flag "${fixture.expected.authorityFlag}".`);
    }
  }

  if (fixture.expected.authorCount != null) {
    const count = response.references[0]?.fields.authors.value.length ?? 0;
    if (count !== fixture.expected.authorCount) {
      details.push(`Expected ${fixture.expected.authorCount} authors, received ${count}.`);
    }
  }

  if (fixture.expected.publicStatus) {
    const status = response.references[0]?.publicStatus;
    if (status !== fixture.expected.publicStatus) {
      details.push(`Expected public status "${fixture.expected.publicStatus}", received "${status ?? 'undefined'}".`);
    }
  }

  if (fixture.expected.healthReasonIncludes) {
    const reasons = response.references[0]?.healthReasons ?? [];
    if (!reasons.some((reason) => reason.includes(fixture.expected.healthReasonIncludes!))) {
      details.push(`Expected health reasons to include "${fixture.expected.healthReasonIncludes}".`);
    }
  }

  if (fixture.expected.warningCodeIncludes) {
    const warnings = response.references[0]?.healthWarnings.map((warning) => warning.code) ?? [];
    if (!warnings.includes(fixture.expected.warningCodeIncludes)) {
      details.push(`Expected warning code "${fixture.expected.warningCodeIncludes}".`);
    }
  }

  if (fixture.expected.warningCodeExcludes) {
    const warnings = response.references[0]?.healthWarnings.map((warning) => warning.code) ?? [];
    if (warnings.includes(fixture.expected.warningCodeExcludes)) {
      details.push(`Expected warning code "${fixture.expected.warningCodeExcludes}" to be absent.`);
    }
  }

  if (fixture.expected.rawScoreMin != null) {
    const rawScore = response.references[0]?.rawScore;
    if (typeof rawScore !== 'number' || rawScore < fixture.expected.rawScoreMin) {
      details.push(`Expected rawScore >= ${fixture.expected.rawScoreMin}, received ${rawScore ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.rawScoreMax != null) {
    const rawScore = response.references[0]?.rawScore;
    if (typeof rawScore !== 'number' || rawScore > fixture.expected.rawScoreMax) {
      details.push(`Expected rawScore <= ${fixture.expected.rawScoreMax}, received ${rawScore ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.displayScoreMin != null) {
    const displayScore = response.references[0]?.displayScore;
    if (typeof displayScore !== 'number' || displayScore < fixture.expected.displayScoreMin) {
      details.push(`Expected displayScore >= ${fixture.expected.displayScoreMin}, received ${displayScore ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.displayScoreMax != null) {
    const displayScore = response.references[0]?.displayScore;
    if (typeof displayScore !== 'number' || displayScore > fixture.expected.displayScoreMax) {
      details.push(`Expected displayScore <= ${fixture.expected.displayScoreMax}, received ${displayScore ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.displayLowerThanRaw) {
    const reference = response.references[0];
    if (!reference || reference.displayScore >= reference.rawScore) {
      details.push(`Expected displayScore < rawScore, received raw=${reference?.rawScore ?? 'undefined'} display=${reference?.displayScore ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.rawDisplayDeltaMin != null) {
    const reference = response.references[0];
    const delta = reference ? reference.rawScore - reference.displayScore : Number.NaN;
    if (!Number.isFinite(delta) || delta < fixture.expected.rawDisplayDeltaMin) {
      details.push(`Expected rawScore - displayScore >= ${fixture.expected.rawDisplayDeltaMin}, received ${Number.isFinite(delta) ? delta : 'undefined'}.`);
    }
  }

  if (fixture.expected.effectiveStyle) {
    const effectiveStyle = response.references[0]?.effectiveStyle;
    if (effectiveStyle !== fixture.expected.effectiveStyle) {
      details.push(`Expected effectiveStyle "${fixture.expected.effectiveStyle}", received "${effectiveStyle ?? 'undefined'}".`);
    }
  }

  if (fixture.expected.effectiveDetectionConfidenceMin != null) {
    const value = response.references[0]?.effectiveDetectionConfidence;
    if (typeof value !== 'number' || value < fixture.expected.effectiveDetectionConfidenceMin) {
      details.push(`Expected effectiveDetectionConfidence >= ${fixture.expected.effectiveDetectionConfidenceMin}, received ${value ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.formatScoringPath) {
    const path = response.references[0]?.scoreBreakdown?.formatScoringPath;
    if (path !== fixture.expected.formatScoringPath) {
      details.push(`Expected formatScoringPath "${fixture.expected.formatScoringPath}", received "${path ?? 'undefined'}".`);
    }
  }

  if (fixture.expected.contentCorrectnessScoreMin != null) {
    const value = response.references[0]?.scoreBreakdown?.contentCorrectnessScore;
    if (typeof value !== 'number' || value < fixture.expected.contentCorrectnessScoreMin) {
      details.push(`Expected contentCorrectnessScore >= ${fixture.expected.contentCorrectnessScoreMin}, received ${value ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.cosmeticFormatScoreMin != null) {
    const value = response.references[0]?.scoreBreakdown?.cosmeticFormatScore;
    if (typeof value !== 'number' || value < fixture.expected.cosmeticFormatScoreMin) {
      details.push(`Expected cosmeticFormatScore >= ${fixture.expected.cosmeticFormatScoreMin}, received ${value ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.spacingScoreMin != null) {
    const value = response.references[0]?.scoreBreakdown?.cosmeticSubscores?.spacingScore;
    if (typeof value !== 'number' || value < fixture.expected.spacingScoreMin) {
      details.push(`Expected spacingScore >= ${fixture.expected.spacingScoreMin}, received ${value ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.noDuplicatePunctScoreMin != null) {
    const value = response.references[0]?.scoreBreakdown?.cosmeticSubscores?.noDuplicatePunctScore;
    if (typeof value !== 'number' || value < fixture.expected.noDuplicatePunctScoreMin) {
      details.push(`Expected noDuplicatePunctScore >= ${fixture.expected.noDuplicatePunctScoreMin}, received ${value ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.titleCaseScoreMin != null) {
    const value = response.references[0]?.scoreBreakdown?.cosmeticSubscores?.titleCaseScore;
    if (typeof value !== 'number' || value < fixture.expected.titleCaseScoreMin) {
      details.push(`Expected titleCaseScore >= ${fixture.expected.titleCaseScoreMin}, received ${value ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.doiVerificationStatus) {
    const value = response.references[0]?.doiVerification?.status;
    if (value !== fixture.expected.doiVerificationStatus) {
      details.push(`Expected doiVerification.status "${fixture.expected.doiVerificationStatus}", received "${value ?? 'undefined'}".`);
    }
  }

  if (fixture.expected.inputCleanupApplied != null) {
    const value = response.references[0]?.inputCleanup?.cleanupApplied;
    if (value !== fixture.expected.inputCleanupApplied) {
      details.push(`Expected inputCleanup.cleanupApplied=${fixture.expected.inputCleanupApplied}, received ${value ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.inputCleanupDecisionReason) {
    const value = response.references[0]?.inputCleanup?.decisionReason;
    if (value !== fixture.expected.inputCleanupDecisionReason) {
      details.push(`Expected inputCleanup.decisionReason "${fixture.expected.inputCleanupDecisionReason}", received "${value ?? 'undefined'}".`);
    }
  }

  if (fixture.expected.inputCleanupLookedLikePdfCopy != null) {
    const value = response.references[0]?.inputCleanup?.lookedLikePdfCopy;
    if (value !== fixture.expected.inputCleanupLookedLikePdfCopy) {
      details.push(`Expected inputCleanup.lookedLikePdfCopy=${fixture.expected.inputCleanupLookedLikePdfCopy}, received ${value ?? 'undefined'}.`);
    }
  }

  if (fixture.expected.excludeStage && response.processingPath.stagesRun.includes(fixture.expected.excludeStage as never)) {
    details.push(`Expected stage ${fixture.expected.excludeStage} to be skipped.`);
  }

  return {
    id: fixture.id,
    suite: fixture.suite,
    passed: details.length === 0,
    failureMode: fixture.failureMode,
    provenance: fixture.provenance,
    details,
  };
}

function renderMarkdown(createdAt: string, results: RegressionCaseResult[]): string {
  const lines = [
    '# Regression Run',
    '',
    `- Created At: ${createdAt}`,
    `- Total Cases: ${results.length}`,
    `- Passed: ${results.filter((result) => result.passed).length}`,
    `- Failed: ${results.filter((result) => !result.passed).length}`,
    '',
    '| Suite | Case | Passed | Failure Mode | Provenance | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
    ...results.map((result) => `| ${result.suite} | ${result.id} | ${result.passed ? 'yes' : 'no'} | ${result.failureMode} | ${result.provenance} | ${result.details.join('; ') || 'ok'} |`),
    '',
  ];

  return lines.join('\n');
}
