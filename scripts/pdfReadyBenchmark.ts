import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  runPdfReadyBenchmark,
  type PdfBenchmarkMetrics,
  type PdfBenchmarkMode,
  type PdfBenchmarkModeResult,
  type PdfBenchmarkReport,
} from '../server/engine/v2/pdfReadyBenchmark.js';

type Command = 'report' | 'freeze' | 'check';
type ModeArg = PdfBenchmarkMode | 'all';

type PdfBaselineManifest = {
  version: number;
  mode: PdfBenchmarkMode;
  corpusHash: string;
  corpusSize: number;
  snapshot: PdfBenchmarkMetrics;
};

const REPORT_JSON = path.resolve('output', 'pdf-ready-1000-report.json');
const REPORT_MD = path.resolve('output', 'pdf-ready-1000-report.md');
const BASELINE_PATHS: Record<PdfBenchmarkMode, string> = {
  pdf_upload: path.resolve('scripts', 'data', 'pdf-upload-baseline.json'),
  pdf_copy_paste: path.resolve('scripts', 'data', 'pdf-copypaste-baseline.json'),
};
const FLOOR_METRICS: Array<keyof PdfBenchmarkMetrics> = [
  'countIntegrityPct',
  'requiredFieldsPct',
  'doiRetentionPct',
  'nearReadyReviewPct',
  'singleLinkPct',
];
const CEILING_METRICS: Array<keyof PdfBenchmarkMetrics> = [
  'incompatibleFieldOverlapPct',
];
const HARD_ZERO_CEILING_METRICS: Array<keyof PdfBenchmarkMetrics> = [
  'falseReadyPct',
  'corruptReviewPct',
];

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function parseCommand(value: string | undefined): Command {
  if (value === 'freeze' || value === 'check') return value;
  return 'report';
}

function parseMode(value: string | undefined): ModeArg {
  if (value === 'pdf_upload' || value === 'pdf_copy_paste') return value;
  return 'all';
}

function coerceMetrics(partial: Partial<PdfBenchmarkMetrics> | undefined): PdfBenchmarkMetrics {
  return {
    countIntegrityPct: partial?.countIntegrityPct ?? 0,
    requiredFieldsPct: partial?.requiredFieldsPct ?? 0,
    doiRetentionPct: partial?.doiRetentionPct ?? 0,
    readyPct: partial?.readyPct ?? 0,
    worthReviewingPct: partial?.worthReviewingPct ?? 0,
    actionNeededPct: partial?.actionNeededPct ?? 0,
    contaminationFreePct: partial?.contaminationFreePct ?? 0,
    partialChunkPct: partial?.partialChunkPct ?? 0,
    falseReadyPct: partial?.falseReadyPct ?? 0,
    corruptReviewPct: partial?.corruptReviewPct ?? 0,
    nearReadyReviewPct: partial?.nearReadyReviewPct ?? 0,
    singleLinkPct: partial?.singleLinkPct ?? 0,
    incompatibleFieldOverlapPct: partial?.incompatibleFieldOverlapPct ?? 0,
  };
}

function readBaseline(mode: PdfBenchmarkMode): PdfBaselineManifest | null {
  const filePath = BASELINE_PATHS[mode];
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<PdfBaselineManifest> & {
    thresholds?: Partial<PdfBenchmarkMetrics>;
    observed?: Partial<PdfBenchmarkMetrics>;
  };
  return {
    version: parsed.version ?? 1,
    mode,
    corpusHash: parsed.corpusHash ?? '',
    corpusSize: parsed.corpusSize ?? 0,
    snapshot: coerceMetrics(parsed.snapshot ?? parsed.observed ?? {
      countIntegrityPct: parsed.thresholds?.countIntegrityPct ?? 0,
      requiredFieldsPct: parsed.thresholds?.requiredFieldsPct ?? 0,
      doiRetentionPct: parsed.thresholds?.doiRetentionPct ?? 0,
      readyPct: parsed.thresholds?.readyPct ?? 0,
      worthReviewingPct: 0,
      actionNeededPct: 0,
      contaminationFreePct: 0,
      partialChunkPct: 0,
      falseReadyPct: 0,
      corruptReviewPct: 0,
      nearReadyReviewPct: 0,
      singleLinkPct: 0,
      incompatibleFieldOverlapPct: 0,
    }),
  };
}

function createManifest(result: PdfBenchmarkModeResult): PdfBaselineManifest {
  return {
    version: 1,
    mode: result.mode,
    corpusHash: result.corpusHash,
    corpusSize: result.corpusSize,
    snapshot: result.metrics,
  };
}

function metricDeltas(result: PdfBenchmarkModeResult, baseline: PdfBaselineManifest | null): Record<keyof PdfBenchmarkMetrics, number | null> {
  const deltas = {} as Record<keyof PdfBenchmarkMetrics, number | null>;
  for (const key of Object.keys(result.metrics) as Array<keyof PdfBenchmarkMetrics>) {
    deltas[key] = baseline ? Number((result.metrics[key] - baseline.snapshot[key]).toFixed(2)) : null;
  }
  return deltas;
}

function buildReportPayload(report: PdfBenchmarkReport) {
  return {
    ...report,
    modes: report.modes.map((modeResult) => ({
      ...modeResult,
      baselinePath: BASELINE_PATHS[modeResult.mode],
      deltaFromBaseline: metricDeltas(modeResult, readBaseline(modeResult.mode)),
    })),
  };
}

function renderMarkdown(report: ReturnType<typeof buildReportPayload>): string {
  const lines: string[] = [];
  lines.push('# PDF Ready Benchmark Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Target corpus size: ${report.targetCorpusSize}`);

  for (const mode of report.modes) {
    lines.push('');
    lines.push(`## ${mode.mode}`);
    lines.push('');
    lines.push(`- Corpus size: ${mode.corpusSize}`);
    lines.push(`- Corpus hash: \`${mode.corpusHash}\``);
    lines.push(`- Duplicate inputs: ${mode.duplicateInputCount}`);
    lines.push(`- Count integrity: ${formatPercent(mode.metrics.countIntegrityPct)}${mode.deltaFromBaseline.countIntegrityPct == null ? '' : ` (delta ${formatPercent(mode.deltaFromBaseline.countIntegrityPct)})`}`);
    lines.push(`- Required fields: ${formatPercent(mode.metrics.requiredFieldsPct)}${mode.deltaFromBaseline.requiredFieldsPct == null ? '' : ` (delta ${formatPercent(mode.deltaFromBaseline.requiredFieldsPct)})`}`);
    lines.push(`- DOI retention: ${formatPercent(mode.metrics.doiRetentionPct)}${mode.deltaFromBaseline.doiRetentionPct == null ? '' : ` (delta ${formatPercent(mode.deltaFromBaseline.doiRetentionPct)})`}`);
    lines.push(`- Ready: ${formatPercent(mode.metrics.readyPct)}${mode.deltaFromBaseline.readyPct == null ? '' : ` (delta ${formatPercent(mode.deltaFromBaseline.readyPct)})`}`);
    lines.push(`- Worth reviewing: ${formatPercent(mode.metrics.worthReviewingPct)}`);
    lines.push(`- Action needed: ${formatPercent(mode.metrics.actionNeededPct)}`);
    lines.push(`- Contamination free: ${formatPercent(mode.metrics.contaminationFreePct)}`);
    lines.push(`- Partial chunk rate: ${formatPercent(mode.metrics.partialChunkPct)}`);
    lines.push(`- False ready: ${formatPercent(mode.metrics.falseReadyPct)}${mode.deltaFromBaseline.falseReadyPct == null ? '' : ` (delta ${formatPercent(mode.deltaFromBaseline.falseReadyPct)})`}`);
    lines.push(`- Corrupt review: ${formatPercent(mode.metrics.corruptReviewPct)}${mode.deltaFromBaseline.corruptReviewPct == null ? '' : ` (delta ${formatPercent(mode.deltaFromBaseline.corruptReviewPct)})`}`);
    lines.push(`- Near-ready review: ${formatPercent(mode.metrics.nearReadyReviewPct)}${mode.deltaFromBaseline.nearReadyReviewPct == null ? '' : ` (delta ${formatPercent(mode.deltaFromBaseline.nearReadyReviewPct)})`}`);
    lines.push(`- Single-link output: ${formatPercent(mode.metrics.singleLinkPct)}${mode.deltaFromBaseline.singleLinkPct == null ? '' : ` (delta ${formatPercent(mode.deltaFromBaseline.singleLinkPct)})`}`);
    lines.push(`- Incompatible overlap: ${formatPercent(mode.metrics.incompatibleFieldOverlapPct)}${mode.deltaFromBaseline.incompatibleFieldOverlapPct == null ? '' : ` (delta ${formatPercent(mode.deltaFromBaseline.incompatibleFieldOverlapPct)})`}`);
    lines.push(`- Contamination counts: title=${mode.contaminationByField.title}, firstAuthorLast=${mode.contaminationByField.firstAuthorLast}, year=${mode.contaminationByField.year}`);

    if (mode.topFailingSamples.length > 0) {
      lines.push('');
      lines.push('### Top failing samples');
      lines.push('');
      for (const sample of mode.topFailingSamples.slice(0, 10)) {
        lines.push(`- ${sample.batchId} [${sample.citationIndex + 1}] ${sample.reasons.join(', ')}`);
        lines.push(`  Input: ${sample.input}`);
        lines.push(`  Output: ${sample.output}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function compareMode(result: PdfBenchmarkModeResult, baseline: PdfBaselineManifest | null): string[] {
  const failures: string[] = [];
  if (!baseline) {
    failures.push(`Missing baseline manifest for ${result.mode}. Run freeze first.`);
    return failures;
  }
  if (baseline.corpusHash !== result.corpusHash || baseline.corpusSize !== result.corpusSize) {
    failures.push(`${result.mode} corpus changed (hash/size mismatch). Refreeze the baseline intentionally.`);
  }

  for (const metric of FLOOR_METRICS) {
    if (result.metrics[metric] < baseline.snapshot[metric]) {
      failures.push(`${result.mode} ${metric} regressed: ${result.metrics[metric].toFixed(2)} < ${baseline.snapshot[metric].toFixed(2)}`);
    }
  }

  for (const metric of CEILING_METRICS) {
    if (result.metrics[metric] > baseline.snapshot[metric]) {
      failures.push(`${result.mode} ${metric} regressed: ${result.metrics[metric].toFixed(2)} > ${baseline.snapshot[metric].toFixed(2)}`);
    }
  }

  for (const metric of HARD_ZERO_CEILING_METRICS) {
    if (result.metrics[metric] > 0) {
      failures.push(`${result.mode} ${metric} must stay at 0.00 but was ${result.metrics[metric].toFixed(2)}`);
    }
  }

  return failures;
}

async function writeReport(report: ReturnType<typeof buildReportPayload>): Promise<void> {
  await mkdir(path.dirname(REPORT_JSON), { recursive: true });
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(REPORT_MD, renderMarkdown(report), 'utf8');
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const modeArg = parseMode(process.argv[3]);
  const report = buildReportPayload(await runPdfReadyBenchmark());
  await writeReport(report);

  const selectedModes = modeArg === 'all'
    ? report.modes
    : report.modes.filter((mode) => mode.mode === modeArg);

  if (command === 'freeze') {
    for (const mode of selectedModes) {
      const manifest = createManifest(mode);
      await mkdir(path.dirname(BASELINE_PATHS[mode.mode]), { recursive: true });
      await writeFile(BASELINE_PATHS[mode.mode], `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }

    console.log(JSON.stringify({
      command,
      reportJson: REPORT_JSON,
      reportMarkdown: REPORT_MD,
      manifests: selectedModes.map((mode) => ({
        mode: mode.mode,
        path: BASELINE_PATHS[mode.mode],
      })),
    }, null, 2));
    return;
  }

  if (command === 'check') {
    const failures = selectedModes.flatMap((mode) => compareMode(mode, readBaseline(mode.mode)));
    console.log(JSON.stringify({
      command,
      reportJson: REPORT_JSON,
      reportMarkdown: REPORT_MD,
      checkedModes: selectedModes.map((mode) => mode.mode),
      failures,
    }, null, 2));
    if (failures.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(JSON.stringify({
    command,
    reportJson: REPORT_JSON,
    reportMarkdown: REPORT_MD,
    modes: report.modes.map((mode) => ({
      mode: mode.mode,
      corpusSize: mode.corpusSize,
      metrics: mode.metrics,
      deltaFromBaseline: mode.deltaFromBaseline,
    })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => {
      process.exit(process.exitCode ?? 0);
    }, 100);
  });
