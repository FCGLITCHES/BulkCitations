import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  CitationReport,
  PatternExportArtifact,
  ProposedPattern,
  ReportEngineSnapshot,
  ReviewEvent,
  StageBlameSummary,
  V2StageId,
} from '@shared/schema';
import type { GeneratedRegressionFixtureRecord, RegressionFixture } from '../store/generatedRegressionStore.js';

const STAGE_KEYS: Array<V2StageId | 'unknown'> = [
  'ingest',
  'split',
  'detect',
  'extract',
  'validate',
  'normalize',
  'truth',
  'dedup',
  'enrich',
  'group',
  'score',
  'render',
  'respond',
  'unknown',
];

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function addStageScore(
  scores: Map<V2StageId | 'unknown', { score: number; evidence: string[] }>,
  stage: V2StageId | 'unknown',
  amount: number,
  reason: string,
): void {
  const existing = scores.get(stage) ?? { score: 0, evidence: [] };
  existing.score += amount;
  existing.evidence.push(reason);
  scores.set(stage, existing);
}

function buildEmptyStageScores(): Map<V2StageId | 'unknown', { score: number; evidence: string[] }> {
  return new Map(STAGE_KEYS.map((stage) => [stage, { score: 0, evidence: [] }]));
}

function blameFromValidationCode(code: string): Array<{ stage: V2StageId; score: number; reason: string }> {
  if ([
    'header_bleed_suspected',
    'header_bleed_confirmed',
    'doi_orphan_suspected',
    'doi_orphan_confirmed',
    'multiline_truncation_suspected',
    'multiline_truncation_confirmed',
    'page_artifact_suspected',
    'page_artifact_confirmed',
    'oversized_chunk_suspected',
    'oversized_chunk_confirmed',
  ].includes(code)) {
    return [{ stage: 'split', score: 0.9, reason: `validation:${code}` }];
  }
  if ([
    'connector_as_author',
    'author_structure_unstable',
    'initials_as_surname',
    'authors_missing',
    'truncated_group_author',
    'alternating_surname_given_tokens',
  ].includes(code)) {
    return [{ stage: 'extract', score: 0.8, reason: `validation:${code}` }];
  }
  if ([
    'authority_mismatch',
    'authority_lookup_error',
    'authority_no_match',
    'authority_not_found',
    'authority_rate_limited',
    'missing_required_venue',
    'locator_missing_from_source',
  ].includes(code)) {
    return [{ stage: 'validate', score: 0.78, reason: `validation:${code}` }];
  }
  if ([
    'placeholder_volume',
    'placeholder_journal',
  ].includes(code)) {
    return [
      { stage: 'extract', score: 0.5, reason: `validation:${code}` },
      { stage: 'validate', score: 0.45, reason: `validation:${code}` },
    ];
  }
  return [];
}

export function computeLikelyStageBlame(snapshot?: ReportEngineSnapshot): StageBlameSummary | undefined {
  if (!snapshot) return undefined;

  const scores = buildEmptyStageScores();

  for (const flag of snapshot.splitContaminationFlags ?? []) {
    addStageScore(scores, 'split', 0.92, `split_flag:${flag}`);
  }

  for (const code of snapshot.validationCodes ?? []) {
    for (const candidate of blameFromValidationCode(code)) {
      addStageScore(scores, candidate.stage, candidate.score, candidate.reason);
    }
  }

  for (const flag of snapshot.qualityFlags ?? []) {
    if (flag.startsWith('split_contamination')) {
      addStageScore(scores, 'split', 0.85, `quality_flag:${flag}`);
    } else if (flag === 'malformed_authors' || flag === 'author_parse_failed') {
      addStageScore(scores, 'extract', 0.72, `quality_flag:${flag}`);
    } else if (flag === 'duplicate') {
      addStageScore(scores, 'dedup', 0.8, `quality_flag:${flag}`);
    } else if (flag === 'review' || flag === 'unverified') {
      addStageScore(scores, 'validate', 0.45, `quality_flag:${flag}`);
    }
  }

  for (const entry of snapshot.stageLogSummary ?? []) {
    const stage = STAGE_KEYS.includes(entry.stageId as V2StageId) ? entry.stageId as V2StageId : 'unknown';
    const amount = entry.status === 'error' ? 0.9 : entry.status === 'warning' ? 0.55 : 0;
    if (amount > 0) {
      addStageScore(scores, stage, amount, `stage_log:${entry.stageId}:${entry.status}`);
    }
  }

  if (snapshot.extractorPath === 'grobid' || snapshot.extractorPath === 'llm') {
    addStageScore(scores, 'extract', 0.15, `extractor_path:${snapshot.extractorPath}`);
  }

  const ranked = Array.from(scores.entries())
    .map(([stage, payload]) => ({ stage, score: clampConfidence(payload.score), evidence: payload.evidence }))
    .sort((left, right) => right.score - left.score);

  const top = ranked[0];
  if (!top || top.score === 0) {
    return {
      likelyStage: 'unknown',
      confidence: 0.2,
      evidence: ['No strong stage-blame evidence was captured.'],
      alternatives: [],
    };
  }

  return {
    likelyStage: top.stage,
    confidence: Number(top.score.toFixed(2)),
    evidence: top.evidence.slice(0, 6),
    alternatives: ranked
      .filter((candidate) => candidate.stage !== top.stage && candidate.score > 0)
      .slice(0, 3)
      .map((candidate) => ({
        stage: candidate.stage,
        confidence: Number(candidate.score.toFixed(2)),
      })),
  };
}

export function buildPatternExportArtifact(pattern: ProposedPattern, generatedBy?: string): PatternExportArtifact {
  const entry = {
    id: pattern.id,
    description: pattern.description || '',
    ...(pattern.category ? { category: pattern.category } : {}),
    regex: pattern.regex,
    fields: pattern.fields,
    priority: pattern.priority ?? 90,
  };

  return {
    filePath: path.resolve(process.cwd(), 'server', 'data', 'patterns.json'),
    content: JSON.stringify(entry, null, 2),
    generatedAt: new Date().toISOString(),
    generatedBy,
  };
}

function currentVersion(): string {
  return process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.0.0';
}

export function shouldGenerateFixture(report: CitationReport): { allowed: boolean; reason?: string } {
  if (report.status !== 'accepted') {
    return { allowed: false, reason: 'only_accepted_reports_generate_fixtures' };
  }
  if (report.engineSnapshot?.splitContaminationFlags?.includes('doi_orphan')) {
    return { allowed: false, reason: 'doi_orphan_source_data_is_not_fixture_safe' };
  }
  if (report.engineSnapshot?.inputProfile?.structure === 'unknown') {
    return { allowed: false, reason: 'unknown_structure_input_is_not_fixture_safe' };
  }
  if (report.engineSnapshot?.inputProfile?.inputType === 'plain_blob') {
    return { allowed: false, reason: 'plain_blob_input_is_not_fixture_safe' };
  }
  return { allowed: true };
}

function escapeForSingleQuotedString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

export function buildRegressionFixtureExportArtifact(fixture: RegressionFixture, generatedBy?: string): PatternExportArtifact {
  const serialized = [
    '{',
    `  id: '${escapeForSingleQuotedString(fixture.id)}',`,
    `  description: '${escapeForSingleQuotedString(fixture.description)}',`,
    `  references: [${fixture.references.map((reference) => `\n    '${escapeForSingleQuotedString(reference)}'`).join(',')}\n  ],`,
    ...(fixture.expectedOutputText ? [`  expectedOutputText: '${escapeForSingleQuotedString(fixture.expectedOutputText)}',`] : []),
    ...(fixture.expectedReferenceType ? [`  expectedReferenceType: '${escapeForSingleQuotedString(fixture.expectedReferenceType)}',`] : []),
    '}',
  ].join('\n');

  return {
    filePath: path.resolve(process.cwd(), 'server', 'engine', 'v2', 'regressionFixtures.ts'),
    content: serialized,
    generatedAt: new Date().toISOString(),
    generatedBy,
  };
}

export function buildGeneratedRegressionRecord(report: CitationReport, generatedBy?: string): GeneratedRegressionFixtureRecord {
  const guard = shouldGenerateFixture(report);
  if (!guard.allowed) {
    return {
      id: randomUUID(),
      sourceReportId: report.id,
      createdAt: new Date().toISOString(),
      generatedBy,
      skipped: true,
      skipReason: guard.reason,
    };
  }

  const fixture: RegressionFixture = {
    id: `report-${report.id}`,
    description: `Accepted report fixture for ${report.failureCategory}`,
    references: [report.originalText],
    expectedOutputText: report.finalApprovedOutput ?? report.proposedStyleFix ?? report.convertedText,
    expectedReferenceType: report.correctedFields?.referenceType
      ? String(report.correctedFields.referenceType)
      : report.referenceType,
  };

  return {
    id: randomUUID(),
    sourceReportId: report.id,
    createdAt: new Date().toISOString(),
    generatedBy,
    fixture,
    skipped: false,
    exportArtifact: buildRegressionFixtureExportArtifact(fixture, generatedBy),
  };
}

export function createReviewEvent(
  type: ReviewEvent['type'],
  actor: string,
  message?: string,
  metadata?: Record<string, unknown>,
): ReviewEvent {
  return {
    id: randomUUID(),
    type,
    actor,
    createdAt: new Date().toISOString(),
    message,
    metadata,
  };
}

export function buildResolutionTrace(report: CitationReport, actor: string, note?: string): CitationReport['resolutionTrace'] {
  return {
    resolvedAt: new Date().toISOString(),
    resolvedByCommit: report.resolvedByCommit ?? process.env.GIT_COMMIT_SHA,
    resolvedByVersion: report.resolvedByVersion ?? currentVersion(),
    note: note ?? `Resolved by ${actor}`,
  };
}
