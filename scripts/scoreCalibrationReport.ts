import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  OPERATIONAL_ACCURACY_CASES,
  type OperationalAccuracyCase,
} from '../server/engine/v2/fixtures/operationalAccuracyCorpus.js';
import { processV2Conversion } from '../server/engine/v2/pipeline.js';
import {
  evaluateScoreField,
  getRequirementProfile,
  getScoreProfile,
} from '../server/engine/v2/qualityRules.js';

type PrimaryType = 'journal' | 'book' | 'report' | 'chapter' | 'website';
type FieldState = 'missing' | 'weak' | 'acceptable';

type TypeSummary = {
  type: PrimaryType;
  count: number;
  averageOverall: number;
  bucketDistribution: Record<'ready' | 'worth_reviewing' | 'action_needed', number>;
  requiredStateRates: Record<FieldState, number>;
  expectedStateRates: Record<FieldState, number>;
  expectedFieldMissPatterns: Record<string, number>;
  observationCodeFrequencies: Record<string, number>;
  acceptedGptRescueCount: number;
  positiveRescueCount: number;
  negativeRescueCount: number;
  meanPositiveDelta: number;
  meanNegativeDelta: number;
};

type CalibrationReport = {
  generatedAt: string;
  corpusId: string;
  corpusType: 'single_frozen_sample';
  gatingStatus: 'pending_second_corpus_sample';
  types: TypeSummary[];
};

const REPORT_JSON = path.resolve('output', 'score-calibration-report.json');
const REPORT_MD = path.resolve('output', 'score-calibration-report.md');
const PRIMARY_TYPES: PrimaryType[] = ['journal', 'book', 'report', 'chapter', 'website'];

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function bucketValue(citation: any): 'ready' | 'worth_reviewing' | 'action_needed' {
  const bucket = citation?.quality?.bucket;
  return bucket === 'ready' || bucket === 'worth_reviewing' || bucket === 'action_needed'
    ? bucket
    : 'action_needed';
}

async function runCase(testCase: OperationalAccuracyCase, llmEnabled: boolean) {
  const previousLlm = process.env.ENABLE_LLM_EXTRACTOR;
  process.env.ENABLE_LLM_EXTRACTOR = llmEnabled ? (previousLlm ?? '1') : '0';
  try {
    const { response } = await processV2Conversion({
      sourceType: 'text',
      content: testCase.input,
      inputStyle: 'auto',
      outputStyle: 'apa',
      enrich: false,
      dedup: false,
      group: false,
      debug: false,
    }, {
      executionMode: 'sync',
    });
    return response.citations[0] ?? null;
  } finally {
    if (previousLlm == null) {
      delete process.env.ENABLE_LLM_EXTRACTOR;
    } else {
      process.env.ENABLE_LLM_EXTRACTOR = previousLlm;
    }
  }
}

function summarizeType(type: PrimaryType, citations: Array<{ current: any; baseline: any | null }>): TypeSummary {
  let totalOverall = 0;
  const bucketDistribution = {
    ready: 0,
    worth_reviewing: 0,
    action_needed: 0,
  };
  const requiredStateCounts: Record<FieldState, number> = { missing: 0, weak: 0, acceptable: 0 };
  const expectedStateCounts: Record<FieldState, number> = { missing: 0, weak: 0, acceptable: 0 };
  const expectedFieldMissPatterns: Record<string, number> = {};
  const observationCodeFrequencies: Record<string, number> = {};
  let acceptedGptRescueCount = 0;
  let positiveRescueCount = 0;
  let negativeRescueCount = 0;
  let positiveDeltaTotal = 0;
  let negativeDeltaTotal = 0;

  for (const entry of citations) {
    const citation = entry.current;
    totalOverall += Number(citation?.quality?.overall ?? 0);
    bucketDistribution[bucketValue(citation)] += 1;

    const profile = getScoreProfile(citation.referenceType).profile;
    const requirementProfile = getRequirementProfile(citation.referenceType);

    for (const field of requirementProfile.required) {
      const evaluation = evaluateScoreField(citation, field, profile);
      requiredStateCounts[evaluation.state] += 1;
    }

    for (const field of requirementProfile.expected) {
      const evaluation = evaluateScoreField(citation, field, profile);
      expectedStateCounts[evaluation.state] += 1;
      if (evaluation.state === 'missing') {
        expectedFieldMissPatterns[field] = (expectedFieldMissPatterns[field] ?? 0) + 1;
      }
    }

    for (const code of citation?.quality?.observationCodes ?? []) {
      observationCodeFrequencies[code] = (observationCodeFrequencies[code] ?? 0) + 1;
    }

    if (citation?.extraction?.llmFallbackAccepted) {
      acceptedGptRescueCount += 1;
      if (entry.baseline) {
        const delta = Number((Number(citation?.quality?.overall ?? 0) - Number(entry.baseline?.quality?.overall ?? 0)).toFixed(2));
        if (delta > 0) {
          positiveRescueCount += 1;
          positiveDeltaTotal += delta;
        } else if (delta < 0) {
          negativeRescueCount += 1;
          negativeDeltaTotal += delta;
        }
      }
    }
  }

  const requiredTotal = Object.values(requiredStateCounts).reduce((sum, value) => sum + value, 0);
  const expectedTotal = Object.values(expectedStateCounts).reduce((sum, value) => sum + value, 0);

  return {
    type,
    count: citations.length,
    averageOverall: round(totalOverall / Math.max(citations.length, 1)),
    bucketDistribution,
    requiredStateRates: {
      missing: round((requiredStateCounts.missing / Math.max(requiredTotal, 1)) * 100),
      weak: round((requiredStateCounts.weak / Math.max(requiredTotal, 1)) * 100),
      acceptable: round((requiredStateCounts.acceptable / Math.max(requiredTotal, 1)) * 100),
    },
    expectedStateRates: {
      missing: round((expectedStateCounts.missing / Math.max(expectedTotal, 1)) * 100),
      weak: round((expectedStateCounts.weak / Math.max(expectedTotal, 1)) * 100),
      acceptable: round((expectedStateCounts.acceptable / Math.max(expectedTotal, 1)) * 100),
    },
    expectedFieldMissPatterns,
    observationCodeFrequencies,
    acceptedGptRescueCount,
    positiveRescueCount,
    negativeRescueCount,
    meanPositiveDelta: positiveRescueCount > 0 ? round(positiveDeltaTotal / positiveRescueCount) : 0,
    meanNegativeDelta: negativeRescueCount > 0 ? round(negativeDeltaTotal / negativeRescueCount) : 0,
  };
}

function renderMarkdown(report: CalibrationReport): string {
  const lines: string[] = [];
  lines.push('# Score Calibration Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Corpus: ${report.corpusId}`);
  lines.push(`Gating status: ${report.gatingStatus}`);

  for (const summary of report.types) {
    lines.push('');
    lines.push(`## ${summary.type}`);
    lines.push('');
    lines.push(`- Count: ${summary.count}`);
    lines.push(`- Average overall: ${summary.averageOverall.toFixed(2)}`);
    lines.push(`- Buckets: ready=${summary.bucketDistribution.ready}, worth_reviewing=${summary.bucketDistribution.worth_reviewing}, action_needed=${summary.bucketDistribution.action_needed}`);
    lines.push(`- Required states: acceptable=${formatPercent(summary.requiredStateRates.acceptable)}, weak=${formatPercent(summary.requiredStateRates.weak)}, missing=${formatPercent(summary.requiredStateRates.missing)}`);
    lines.push(`- Expected states: acceptable=${formatPercent(summary.expectedStateRates.acceptable)}, weak=${formatPercent(summary.expectedStateRates.weak)}, missing=${formatPercent(summary.expectedStateRates.missing)}`);
    lines.push(`- Accepted GPT rescues: ${summary.acceptedGptRescueCount}`);
    lines.push(`- Rescue deltas: positive=${summary.positiveRescueCount} (mean ${summary.meanPositiveDelta.toFixed(2)}), negative=${summary.negativeRescueCount} (mean ${summary.meanNegativeDelta.toFixed(2)})`);
    lines.push(`- Observation codes: ${Object.entries(summary.observationCodeFrequencies).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`);
    lines.push(`- Expected field misses: ${Object.entries(summary.expectedFieldMissPatterns).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`);
  }

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const eligibleCases = OPERATIONAL_ACCURACY_CASES.filter((testCase) => PRIMARY_TYPES.includes(testCase.expectedReferenceType as PrimaryType));
  const resultsByType = new Map<PrimaryType, Array<{ current: any; baseline: any | null }>>();

  for (const type of PRIMARY_TYPES) {
    resultsByType.set(type, []);
  }

  for (const testCase of eligibleCases) {
    const type = testCase.expectedReferenceType as PrimaryType;
    const current = await runCase(testCase, true);
    if (!current) continue;
    const baseline = current.extraction?.llmFallbackAccepted ? await runCase(testCase, false) : null;
    resultsByType.get(type)?.push({ current, baseline });
  }

  const report: CalibrationReport = {
    generatedAt: new Date().toISOString(),
    corpusId: 'operational_accuracy_cases_v1',
    corpusType: 'single_frozen_sample',
    gatingStatus: 'pending_second_corpus_sample',
    types: PRIMARY_TYPES.map((type) => summarizeType(type, resultsByType.get(type) ?? [])),
  };

  await mkdir(path.dirname(REPORT_JSON), { recursive: true });
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(REPORT_MD, renderMarkdown(report), 'utf8');

  console.log(JSON.stringify({
    reportJson: REPORT_JSON,
    reportMarkdown: REPORT_MD,
    gatingStatus: report.gatingStatus,
    types: report.types.map((summary) => ({
      type: summary.type,
      count: summary.count,
      averageOverall: summary.averageOverall,
      acceptedGptRescueCount: summary.acceptedGptRescueCount,
    })),
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
