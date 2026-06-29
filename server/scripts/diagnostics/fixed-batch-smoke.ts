import {
  FIXED_SMOKE_CORPUS_EXPECTED_COUNT,
  FIXED_SMOKE_CORPUS_GATES,
  FIXED_SMOKE_CORPUS_INPUT,
  FIXED_SMOKE_CORPUS_SEGMENTS,
} from '../../test/fixtures/fixedSmokeCorpus.js';
import { buildFixedBatchQualityReport } from '../../src/diagnostics/fixedBatchQualityReport.js';

process.env.BULKREFERENCES_ISOLATED_RUNTIME ??= 'true';

async function main() {
  const includePerReference = process.argv.includes('--verbose');
  const assertGates = process.argv.includes('--assert-gates');

  const report = await buildFixedBatchQualityReport(FIXED_SMOKE_CORPUS_INPUT, {
    label: 'fixed_smoke_corpus',
    expectedCount: FIXED_SMOKE_CORPUS_EXPECTED_COUNT,
    includePerReference: includePerReference,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    segments: FIXED_SMOKE_CORPUS_SEGMENTS.map((segment) => ({
      id: segment.id,
      label: segment.label,
      expectedCount: segment.expectedCount,
    })),
    gates: FIXED_SMOKE_CORPUS_GATES,
    gateResults: evaluateGates(report),
    ...report,
    ...(includePerReference ? {} : { perReference: undefined }),
  };

  console.log(JSON.stringify(payload, null, 2));

  if (assertGates && payload.gateResults.some((result) => !result.pass)) {
    process.exitCode = 1;
  }
}

function evaluateGates(report: Awaited<ReturnType<typeof buildFixedBatchQualityReport>>) {
  const gates = FIXED_SMOKE_CORPUS_GATES;

  return [
    {
      id: 'reference_count',
      pass: report.referenceCount >= gates.minReferenceCount,
      actual: report.referenceCount,
      expected: `>= ${gates.minReferenceCount}`,
    },
    {
      id: 'dropped_count',
      pass: report.summary.failed === 0,
      actual: report.summary.failed,
      expected: `<= ${gates.maxDroppedCount}`,
    },
    {
      id: 'ready_percent',
      pass: report.statusPercent.ready >= gates.minReadyPercent,
      actual: report.statusPercent.ready,
      expected: `>= ${gates.minReadyPercent}`,
    },
    {
      id: 'needs_review_percent',
      pass: report.statusPercent.needs_review <= gates.maxNeedsReviewPercent,
      actual: report.statusPercent.needs_review,
      expected: `<= ${gates.maxNeedsReviewPercent}`,
    },
    {
      id: 'needs_action_percent',
      pass: report.statusPercent.needs_action <= gates.maxNeedsActionPercent,
      actual: report.statusPercent.needs_action,
      expected: `<= ${gates.maxNeedsActionPercent}`,
    },
    {
      id: 'parse_quality',
      pass: report.parseQuality >= gates.minParseQuality,
      actual: report.parseQuality,
      expected: `>= ${gates.minParseQuality}`,
    },
  ];
}

void main();
