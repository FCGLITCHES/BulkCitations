import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import type { ConvertRequest, ConvertResponse, JobCreatedResponse, JobStatusResponse } from '../../src/engine/types/api.js';
import type { CitationStyle } from '../../src/engine/types/citation.js';
import type { ParseProfile } from '../../src/engine/types/parseProfile.js';
import type {
  PipelineRuntimeProfile,
  ProcessingPath,
  ProviderUsage,
  StageRunRecord,
} from '../../src/engine/types/pipeline.js';
import { phase1Ingest } from '../../src/engine/phases/phase1Ingest.js';
import { phase2Split } from '../../src/engine/phases/phase2Split.js';
import { createPipelineDependencies } from '../../src/pipeline/dependencies.js';
import { createPipelineContext, runConvertPipeline } from '../../src/pipeline/orchestrator.js';
import { resolvePipelineRuntimeProfile } from '../../src/pipeline/runtimeProfiles.js';
import { NUMBERED_MIXED_STYLE_REGRESSION_INPUT } from '../../test/fixtures/numberedMixedStyleRegressionBatch.js';

process.env.BULKREFERENCES_ISOLATED_RUNTIME ??= 'true';

type HttpPayloadMode = 'site_default' | ParseProfile;
type QualityPayload = Pick<ConvertResponse, 'references' | 'summary'> & Partial<Pick<ConvertResponse, 'providerUsage'>>;

interface CliOptions {
  inputPath: string | null;
  fixture: 'numbered_mixed_style_regression' | null;
  outputPath: string | null;
  outputStyle: CitationStyle;
  sourceType: ConvertRequest['sourceType'];
  parseProfiles: ParseProfile[];
  runtimeProfiles: PipelineRuntimeProfile[];
  repeat: number;
  url: string | null;
  httpPayloadModes: HttpPayloadMode[];
  headers: Record<string, string>;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  qualityBaselinePath: string | null;
  writeQualityBaselinePath: string | null;
}

interface InputSummary {
  label: string;
  sha256: string;
  rawInputBytes: number;
  rawInputChars: number;
  lineCount: number;
  nonEmptyLineCount: number;
  numberedLineCount: number;
  inspectedReferenceCount: number;
  inspectedDetectedFormat: string;
  inspectedStructure: string;
  inspectedSplitQualityFlag: string;
}

interface DirectRunSummary {
  layer: 'direct_engine';
  label: string;
  repeatIndex: number;
  parseProfile: ParseProfile;
  runtimeProfile: PipelineRuntimeProfile;
  runtimeTuning: {
    batchSize: number;
    maxConcurrency: number;
    fastLaneMulticoreMinRefs: number | null;
  };
  wallClockMs: number;
  refsPerSecond: number;
  responseStringifyMs: number;
  responseBytes: number;
  responseSha256: string;
  renderedTextSha256: string;
  quality: QualitySummary;
  executionProfile: ParseProfile;
  coreParseLatencyMs: number;
  referenceCount: number;
  countAudit: ConvertResponse['countAudit'];
  summary: ConvertResponse['summary'];
  providerUsage: ProviderUsage;
  stageTotalsMs: Record<string, number>;
  stageTimings: ProcessingPath['stageTimings'];
  diagnosticRecordCount: number;
  diagnosticDetails: DiagnosticDetail[];
  slowestReferences: Array<{
    index: number;
    outputLatencyMs: number;
    publicStatus: string;
    referenceType: string;
    rawPreview: string;
  }>;
}

interface HttpRunSummary {
  layer: 'http_convert';
  label: string;
  payloadMode: HttpPayloadMode;
  statusCode: number;
  queued: boolean;
  requestBytes: number;
  requestStringifyMs: number;
  initialResponseMs: number;
  finalResponseMs: number;
  responseBytes: number;
  responseJsonParseMs: number;
  serverTiming: string | null;
  pollCount: number;
  queuedJobAndPollingMs: number;
  coreVsClientGapMs: number | null;
  jobId: string | null;
  executionMode: 'sync' | 'async' | null;
  executionProfile: ParseProfile | null;
  coreParseLatencyMs: number | null;
  referenceCount: number;
  refsPerSecondClientWall: number;
  refsPerSecondCoreParse: number | null;
  summary: ConvertResponse['summary'] | null;
  countAudit: ConvertResponse['countAudit'] | null;
  stageTotalsMs: Record<string, number>;
  responseSha256: string | null;
  renderedTextSha256: string | null;
  quality: QualitySummary | null;
  diagnosticRecordCount: number;
  diagnosticDetails: DiagnosticDetail[];
  error: unknown | null;
}

interface DiagnosticDetail {
  phaseId: string;
  stageId: string;
  status: string;
  durationMs: number;
  message: string | null;
  details: Record<string, unknown> | null;
}

interface QualitySummary {
  version: 1;
  referenceCount: number;
  splitHash: string;
  fieldHash: string;
  renderedHash: string;
  semanticHash: string;
  contractHash: string;
  failedCount: number;
  emptyRenderedCount: number;
  needsReviewCount: number;
  needsActionCount: number;
  criticalFieldPresence: Record<string, number>;
  providerUsage: ProviderUsage | null;
  referenceFingerprints: QualityReferenceFingerprint[];
}

interface QualityReferenceFingerprint {
  index: number;
  rawPreview: string;
  splitHash: string;
  fieldHash: string;
  renderedHash: string;
  semanticHash: string;
  contractHash: string;
  publicStatus: string;
  referenceType: string;
  criticalFields: Record<string, boolean>;
}

interface QualityBaselineRun {
  key: string;
  quality: QualitySummary;
}

interface QualityBaseline {
  version: 1;
  generatedAt: string;
  input: {
    sha256: string;
    inspectedReferenceCount: number;
  };
  directRuns: QualityBaselineRun[];
  httpRuns: QualityBaselineRun[];
}

interface QualityComparison {
  key: string;
  layer: DirectRunSummary['layer'] | HttpRunSummary['layer'] | 'input';
  status: 'pass' | 'fail' | 'missing_baseline' | 'missing_current';
  hardFailures: string[];
  warnings: string[];
  diffs: string[];
}

interface Report {
  generatedAt: string;
  cwd: string;
  input: InputSummary;
  directRuns: DirectRunSummary[];
  httpRuns: HttpRunSummary[];
  qualityComparisons: QualityComparison[];
  conclusions: string[];
}

const ROUND_PLACES = 2;
const DEFAULT_PARSE_PROFILES: ParseProfile[] = ['core_parse_fast', 'core_parse_full'];
const DEFAULT_RUNTIME_PROFILES: PipelineRuntimeProfile[] = ['site_default', 'benchmark_5600h'];
const ALLOWED_PARSE_PROFILES = new Set<ParseProfile>([
  'core_parse_fast',
  'core_parse_full',
  'pro_overlay_enrich',
  'debug_full',
  'current_runtime',
]);
const ALLOWED_RUNTIME_PROFILES = new Set<PipelineRuntimeProfile>([
  'site_default',
  'benchmark_5600h',
  'server_16c',
]);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const input = await readInput(options);
  const inputSummary = await summarizeInput(input.content, input.label, options);
  const directRuns: DirectRunSummary[] = [];

  for (const parseProfile of options.parseProfiles) {
    for (const runtimeProfile of options.runtimeProfiles) {
      for (let repeatIndex = 0; repeatIndex < options.repeat; repeatIndex += 1) {
        directRuns.push(await runDirectEngine({
          input: input.content,
          inputLabel: input.label,
          sourceType: options.sourceType,
          outputStyle: options.outputStyle,
          parseProfile,
          runtimeProfile,
          repeatIndex,
        }));
      }
    }
  }

  const httpRuns = options.url
    ? await runHttpMatrix(input.content, options)
    : [];
  const qualityComparisons = options.qualityBaselinePath
    ? await compareQualityBaseline(options.qualityBaselinePath, inputSummary, directRuns, httpRuns)
    : [];
  const report: Report = {
    generatedAt: new Date().toISOString(),
    cwd: process.cwd(),
    input: inputSummary,
    directRuns,
    httpRuns,
    qualityComparisons,
    conclusions: buildConclusions(directRuns, httpRuns, qualityComparisons),
  };
  const outputPath = options.outputPath ?? defaultOutputPath(report.generatedAt);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (options.writeQualityBaselinePath) {
    await writeQualityBaseline(options.writeQualityBaselinePath, report);
  }

  printSummary(report, outputPath);
  if (qualityComparisons.some((comparison) => comparison.status !== 'pass' || comparison.hardFailures.length > 0)) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: null,
    fixture: null,
    outputPath: null,
    outputStyle: 'apa7',
    sourceType: 'text',
    parseProfiles: DEFAULT_PARSE_PROFILES,
    runtimeProfiles: DEFAULT_RUNTIME_PROFILES,
    repeat: 1,
    url: null,
    httpPayloadModes: ['site_default', 'core_parse_fast'],
    headers: {},
    pollIntervalMs: 800,
    pollTimeoutMs: 1_800_000,
    qualityBaselinePath: null,
    writeQualityBaselinePath: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const next = () => {
      const value = args[i + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };
    const nextValues = () => {
      const values: string[] = [];
      while (args[i + 1] && !args[i + 1]!.startsWith('--')) {
        i += 1;
        values.push(args[i]!);
      }
      if (values.length === 0) {
        throw new Error(`Missing value for ${arg}`);
      }
      return values.join(' ');
    };

    switch (arg) {
      case '--input': {
        const inputPath = next();
        options.inputPath = inputPath === '-' ? '-' : resolve(inputPath);
        break;
      }
      case '--fixture': {
        const fixture = next();
        if (fixture !== 'numbered_mixed_style_regression') {
          throw new Error(`Unsupported fixture "${fixture}".`);
        }
        options.fixture = fixture;
        break;
      }
      case '--output':
        options.outputPath = resolve(next());
        break;
      case '--outputStyle':
        options.outputStyle = next() as CitationStyle;
        break;
      case '--sourceType': {
        const sourceType = next();
        if (sourceType !== 'text' && sourceType !== 'doi_list') {
          throw new Error(`Unsupported sourceType "${sourceType}".`);
        }
        options.sourceType = sourceType;
        break;
      }
      case '--parseProfiles':
        options.parseProfiles = parseParseProfileList(nextValues(), arg);
        break;
      case '--runtimeProfiles':
        options.runtimeProfiles = parseRuntimeProfileList(nextValues(), arg);
        break;
      case '--repeat':
        options.repeat = parsePositiveInt(next(), arg);
        break;
      case '--url':
        options.url = next();
        break;
      case '--httpPayloadModes':
        options.httpPayloadModes = parseHttpPayloadModeList(nextValues(), arg);
        break;
      case '--header':
        addHeader(options.headers, next());
        break;
      case '--bearer':
        options.headers.Authorization = `Bearer ${next()}`;
        break;
      case '--cookie':
        options.headers.Cookie = next();
        break;
      case '--pollIntervalMs':
        options.pollIntervalMs = parsePositiveInt(next(), arg);
        break;
      case '--pollTimeoutMs':
        options.pollTimeoutMs = parsePositiveInt(next(), arg);
        break;
      case '--qualityBaseline':
        options.qualityBaselinePath = resolve(next());
        break;
      case '--writeQualityBaseline':
        options.writeQualityBaselinePath = resolve(next());
        break;
      case '--help':
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown option ${arg}`);
    }
  }

  if (!options.inputPath && !options.fixture) {
    options.fixture = 'numbered_mixed_style_regression';
  }
  return options;
}

async function readInput(options: CliOptions): Promise<{ content: string; label: string }> {
  if (options.inputPath) {
    if (options.inputPath === '-') {
      return {
        content: await readStdin(),
        label: 'stdin',
      };
    }
    return {
      content: await readFile(options.inputPath, 'utf8'),
      label: options.inputPath,
    };
  }

  return {
    content: NUMBERED_MIXED_STYLE_REGRESSION_INPUT,
    label: 'fixture:numbered_mixed_style_regression',
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function summarizeInput(
  content: string,
  label: string,
  options: CliOptions,
): Promise<InputSummary> {
  const ctx = createPipelineContext({
    outputStyle: options.outputStyle,
    options: { parseProfile: 'core_parse_fast' },
  });
  const envelope = await withConsoleInfoMuted(() => phase1Ingest.run({
    sourceType: options.sourceType,
    content,
  }, ctx));
  const split = await withConsoleInfoMuted(() => phase2Split.run(envelope, ctx));
  const lines = content.split(/\r?\n/u);

  return {
    label,
    sha256: sha256(content),
    rawInputBytes: Buffer.byteLength(content, 'utf8'),
    rawInputChars: content.length,
    lineCount: lines.length,
    nonEmptyLineCount: lines.filter((line) => line.trim()).length,
    numberedLineCount: lines.filter((line) => /^\s*\d+[.)]\s+/u.test(line)).length,
    inspectedReferenceCount: split.blocks.length,
    inspectedDetectedFormat: envelope.detectedFormat,
    inspectedStructure: envelope.structure,
    inspectedSplitQualityFlag: split.splitQualityFlag,
  };
}

async function runDirectEngine(input: {
  input: string;
  inputLabel: string;
  sourceType: ConvertRequest['sourceType'];
  outputStyle: CitationStyle;
  parseProfile: ParseProfile;
  runtimeProfile: PipelineRuntimeProfile;
  repeatIndex: number;
}): Promise<DirectRunSummary> {
  const runtimeResolution = resolvePipelineRuntimeProfile(
    input.runtimeProfile,
    input.runtimeProfile === 'benchmark_5600h' ? 'parallel' : 'direct',
  );
  const ctx = createPipelineContext({
    outputStyle: input.outputStyle,
    options: {
      parseProfile: input.parseProfile,
      debug: false,
      enrich: false,
      groupDuplicates: true,
      dedup: true,
    },
    runtimeTuning: runtimeResolution.runtimeTuning,
    tenantContext: {
      tier: 'pro',
      isAdmin: true,
    },
  });
  const started = performance.now();
  const artifacts = await withConsoleInfoMuted(() => runConvertPipeline({
    sourceType: input.sourceType,
    content: input.input,
    outputStyle: input.outputStyle,
    options: {
      parseProfile: input.parseProfile,
      debug: false,
      enrich: false,
      groupDuplicates: true,
      dedup: true,
    },
  }, ctx, createPipelineDependencies()));
  const wallClockMs = performance.now() - started;
  const stringifyStarted = performance.now();
  const responseJson = JSON.stringify(artifacts.response);
  const responseStringifyMs = performance.now() - stringifyStarted;
  const referenceCount = artifacts.response.references.length;
  const quality = computeQualitySummary(artifacts.response);

  return {
    layer: 'direct_engine',
    label: input.inputLabel,
    repeatIndex: input.repeatIndex,
    parseProfile: input.parseProfile,
    runtimeProfile: input.runtimeProfile,
    runtimeTuning: {
      batchSize: ctx.runtimeTuning.batchSize,
      maxConcurrency: ctx.runtimeTuning.maxConcurrency,
      fastLaneMulticoreMinRefs: ctx.runtimeTuning.fastLaneMulticoreMinRefs ?? null,
    },
    wallClockMs: round(wallClockMs),
    refsPerSecond: throughput(referenceCount, wallClockMs),
    responseStringifyMs: round(responseStringifyMs),
    responseBytes: Buffer.byteLength(responseJson, 'utf8'),
    responseSha256: sha256(responseJson),
    renderedTextSha256: sha256(artifacts.response.references.map((reference) => reference.renderedText).join('\n')),
    quality,
    executionProfile: artifacts.response.executionProfile,
    coreParseLatencyMs: artifacts.response.coreParseLatencyMs,
    referenceCount,
    countAudit: artifacts.response.countAudit,
    summary: artifacts.response.summary,
    providerUsage: artifacts.response.providerUsage,
    stageTotalsMs: stageTotals(artifacts.response.processingPath.stageTimings),
    stageTimings: artifacts.response.processingPath.stageTimings,
    diagnosticRecordCount: artifacts.response.diagnostics?.length ?? 0,
    diagnosticDetails: summarizeDiagnostics(artifacts.response.diagnostics ?? []),
    slowestReferences: artifacts.response.references
      .map((reference) => ({
        index: reference.index,
        outputLatencyMs: reference.outputLatencyMs,
        publicStatus: reference.publicStatus,
        referenceType: reference.referenceType,
        rawPreview: preview(reference.raw),
      }))
      .sort((left, right) => right.outputLatencyMs - left.outputLatencyMs)
      .slice(0, 20),
  };
}

async function runHttpMatrix(
  input: string,
  options: CliOptions,
): Promise<HttpRunSummary[]> {
  const runs: HttpRunSummary[] = [];
  for (const payloadMode of options.httpPayloadModes) {
    runs.push(await runHttpConvert(input, options, payloadMode));
  }
  return runs;
}

async function runHttpConvert(
  input: string,
  options: CliOptions,
  payloadMode: HttpPayloadMode,
): Promise<HttpRunSummary> {
  if (!options.url) {
    throw new Error('HTTP convert URL is required.');
  }

  const payload: ConvertRequest = {
    sourceType: options.sourceType,
    content: input,
    outputStyle: options.outputStyle,
    options: {
      enrich: false,
      dedup: true,
      groupDuplicates: true,
      debug: false,
      ...(payloadMode === 'site_default' ? {} : { parseProfile: payloadMode }),
    },
  };
  const stringifyStarted = performance.now();
  const requestBody = JSON.stringify(payload);
  const requestStringifyMs = performance.now() - stringifyStarted;
  const started = performance.now();
  let statusCode = 0;
  let responseBytes = 0;
  let initialResponseMs = 0;
  let serverTiming: string | null = null;
  let parsed: ConvertResponse | JobCreatedResponse | JobStatusResponse | null = null;
  let parseMs = 0;
  let pollCount = 0;
  let finalResponseMs = 0;
  let error: unknown = null;

  try {
    const initial = await fetch(options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bulkrefs-diagnostics': 'throughput-gap',
        ...options.headers,
      },
      body: requestBody,
    });
    statusCode = initial.status;
    serverTiming = initial.headers.get('server-timing');
    const initialBuffer = Buffer.from(await initial.arrayBuffer());
    responseBytes = initialBuffer.byteLength;
    const parseStarted = performance.now();
    parsed = JSON.parse(initialBuffer.toString('utf8')) as ConvertResponse | JobCreatedResponse;
    parseMs += performance.now() - parseStarted;
    initialResponseMs = performance.now() - started;
    if (!initial.ok) {
      error = parsed;
    }

    if (initial.status === 202 && isJobCreatedResponse(parsed)) {
      const pollResult = await pollJob(options, parsed);
      parsed = pollResult.finalPayload;
      pollCount = pollResult.pollCount;
      responseBytes = pollResult.responseBytes;
      parseMs += pollResult.responseJsonParseMs;
    }
  } catch (caught) {
    error = caught instanceof Error
      ? { name: caught.name, message: caught.message }
      : caught;
  } finally {
    finalResponseMs = performance.now() - started;
  }

  const response = normalizeFinalHttpPayload(parsed);
  const referenceCount = response.references?.length ?? 0;
  const coreParseLatencyMs = response.coreParseLatencyMs ?? null;
  const queuedJobAndPollingMs = Math.max(0, finalResponseMs - initialResponseMs);
  const coreVsClientGapMs = coreParseLatencyMs == null ? null : round(finalResponseMs - coreParseLatencyMs);
  const responseJson = response.references ? JSON.stringify(response) : null;
  const quality = hasCompleteConvertPayload(response) ? computeQualitySummary(response) : null;

  return {
    layer: 'http_convert',
    label: options.url,
    payloadMode,
    statusCode,
    queued: Boolean(parsed && isJobLikePayload(parsed)),
    requestBytes: Buffer.byteLength(requestBody, 'utf8'),
    requestStringifyMs: round(requestStringifyMs),
    initialResponseMs: round(initialResponseMs),
    finalResponseMs: round(finalResponseMs),
    responseBytes,
    responseJsonParseMs: round(parseMs),
    serverTiming,
    pollCount,
    queuedJobAndPollingMs: round(queuedJobAndPollingMs),
    coreVsClientGapMs,
    jobId: response.jobId ?? null,
    executionMode: response.executionMode ?? null,
    executionProfile: response.executionProfile ?? null,
    coreParseLatencyMs,
    referenceCount,
    refsPerSecondClientWall: throughput(referenceCount, finalResponseMs),
    refsPerSecondCoreParse: coreParseLatencyMs && coreParseLatencyMs > 0
      ? throughput(referenceCount, coreParseLatencyMs)
      : null,
    summary: response.summary ?? null,
    countAudit: response.countAudit ?? null,
    stageTotalsMs: stageTotals(response.processingPath?.stageTimings ?? []),
    responseSha256: responseJson ? sha256(responseJson) : null,
    renderedTextSha256: response.references
      ? sha256(response.references.map((reference) => reference.renderedText).join('\n'))
      : null,
    quality,
    diagnosticRecordCount: response.diagnostics?.length ?? 0,
    diagnosticDetails: summarizeDiagnostics(response.diagnostics ?? []),
    error,
  };
}

async function pollJob(
  options: CliOptions,
  job: JobCreatedResponse,
): Promise<{
  finalPayload: JobStatusResponse;
  pollCount: number;
  responseBytes: number;
  responseJsonParseMs: number;
}> {
  const started = performance.now();
  let pollCount = 0;
  let lastBytes = 0;
  let parseMs = 0;

  for (;;) {
    if (performance.now() - started > options.pollTimeoutMs) {
      throw new Error(`Timed out polling job ${job.jobId} after ${options.pollTimeoutMs}ms.`);
    }

    await delay(options.pollIntervalMs);
    pollCount += 1;
    const response = await fetch(resolveJobUrl(options.url!, job.jobId), {
      method: 'GET',
      headers: {
        ...(job.jobAccessToken ? { 'x-job-access-token': job.jobAccessToken } : {}),
        ...options.headers,
      },
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    lastBytes = buffer.byteLength;
    const parseStarted = performance.now();
    const payload = JSON.parse(buffer.toString('utf8')) as JobStatusResponse;
    parseMs += performance.now() - parseStarted;

    if (payload.status === 'completed' || payload.status === 'partial' || payload.status === 'failed') {
      return {
        finalPayload: payload,
        pollCount,
        responseBytes: lastBytes,
        responseJsonParseMs: parseMs,
      };
    }
  }
}

function normalizeFinalHttpPayload(
  payload: ConvertResponse | JobCreatedResponse | JobStatusResponse | null,
): Partial<ConvertResponse & JobStatusResponse> {
  if (!payload) {
    return {};
  }
  if ('executionMode' in payload) {
    return payload;
  }
  return payload as ConvertResponse;
}

function hasCompleteConvertPayload(
  payload: Partial<ConvertResponse & JobStatusResponse>,
): payload is QualityPayload {
  return Array.isArray(payload.references)
    && Boolean(payload.summary);
}

function isJobCreatedResponse(payload: unknown): payload is JobCreatedResponse {
  return typeof payload === 'object'
    && payload != null
    && 'status' in payload
    && (payload as { status?: unknown }).status === 'pending'
    && 'jobId' in payload
    && !('references' in payload);
}

function isJobLikePayload(payload: unknown): payload is JobCreatedResponse | JobStatusResponse {
  return typeof payload === 'object'
    && payload != null
    && 'jobId' in payload
    && 'status' in payload
    && !('references' in payload && !('executionMode' in payload));
}

function resolveJobUrl(convertUrl: string, jobId: string): string {
  const url = new URL(convertUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.at(-1) !== 'convert') {
    throw new Error(`Cannot derive job URL from ${convertUrl}; expected path to end in /convert.`);
  }
  parts[parts.length - 1] = 'jobs';
  parts.push(encodeURIComponent(jobId));
  url.pathname = `/${parts.join('/')}`;
  return url.toString();
}

function buildConclusions(
  directRuns: DirectRunSummary[],
  httpRuns: HttpRunSummary[],
  qualityComparisons: QualityComparison[],
): string[] {
  const conclusions: string[] = [];
  const fastestFast = fastestDirect(directRuns, 'core_parse_fast');
  const fastestFull = fastestDirect(directRuns, 'core_parse_full');
  if (fastestFast && fastestFull) {
    conclusions.push(
      `Fastest direct core_parse_fast run was ${fastestFast.refsPerSecond} refs/sec; fastest direct core_parse_full run was ${fastestFull.refsPerSecond} refs/sec.`,
    );
  }

  for (const run of httpRuns) {
    if (run.executionProfile && run.executionProfile !== 'core_parse_fast') {
      conclusions.push(
        `HTTP payload mode ${run.payloadMode} executed as ${run.executionProfile}; this is not the benchmark fast profile.`,
      );
    }
    if (run.queued) {
      conclusions.push(
        `HTTP payload mode ${run.payloadMode} used the queued job path with ${run.pollCount} poll(s), so browser-perceived time includes async job storage and polling.`,
      );
    }
    if (run.responseBytes > 1_000_000) {
      conclusions.push(
        `HTTP payload mode ${run.payloadMode} returned ${run.responseBytes} bytes; response hydration/rendering may be material for the UI.`,
      );
    }
  }
  const failedQuality = qualityComparisons.filter(
    (comparison) => comparison.status !== 'pass' || comparison.hardFailures.length > 0,
  );
  if (failedQuality.length > 0) {
    conclusions.push(
      `Quality baseline comparison failed for ${failedQuality.length} run(s); throughput numbers are not valid for those runs.`,
    );
  } else if (qualityComparisons.length > 0) {
    conclusions.push('Quality baseline comparison passed; throughput numbers are comparable for the checked runs.');
  }

  return [...new Set(conclusions)];
}

function fastestDirect(
  directRuns: DirectRunSummary[],
  parseProfile: ParseProfile,
): DirectRunSummary | null {
  const runs = directRuns.filter((run) => run.parseProfile === parseProfile);
  return runs.length
    ? runs.reduce((best, run) => run.refsPerSecond > best.refsPerSecond ? run : best)
    : null;
}

function printSummary(report: Report, outputPath: string): void {
  process.stdout.write(`Input: ${report.input.label}\n`);
  process.stdout.write(`Input hash: ${report.input.sha256}\n`);
  process.stdout.write(`Inspected refs: ${report.input.inspectedReferenceCount}\n\n`);

  process.stdout.write('Direct engine runs:\n');
  for (const run of report.directRuns) {
    process.stdout.write(
      `  ${run.parseProfile} / ${run.runtimeProfile}: ${run.refsPerSecond} refs/sec `
      + `(${run.wallClockMs}ms, ${run.referenceCount} refs, ${run.responseBytes} response bytes)\n`,
    );
  }

  if (report.httpRuns.length > 0) {
    process.stdout.write('\nHTTP runs:\n');
    for (const run of report.httpRuns) {
      process.stdout.write(
        `  ${run.payloadMode}: status ${run.statusCode}, ${run.refsPerSecondClientWall} refs/sec client-wall `
        + `(profile ${run.executionProfile ?? 'unknown'}, queued=${run.queued}, bytes=${run.responseBytes})\n`,
      );
    }
  }

  if (report.qualityComparisons.length > 0) {
    process.stdout.write('\nQuality comparisons:\n');
    for (const comparison of report.qualityComparisons) {
      process.stdout.write(
        `  ${comparison.key}: ${comparison.status}`
        + `${comparison.hardFailures.length > 0 ? ` (${comparison.hardFailures.join('; ')})` : ''}\n`,
      );
      for (const diff of comparison.diffs.slice(0, 3)) {
        process.stdout.write(`    - ${diff}\n`);
      }
    }
  }

  if (report.conclusions.length > 0) {
    process.stdout.write('\nConclusions:\n');
    for (const conclusion of report.conclusions) {
      process.stdout.write(`  - ${conclusion}\n`);
    }
  }

  process.stdout.write(`\nWrote ${outputPath}\n`);
}

function defaultOutputPath(generatedAt: string): string {
  const stamp = generatedAt.replace(/[:.]/gu, '-');
  return resolve(
    fileURLToPath(new URL('../../../benchmarks/manual/results/', import.meta.url)),
    `admin_500_throughput_gap.${stamp}.json`,
  );
}

async function writeQualityBaseline(path: string, report: Report): Promise<void> {
  const baseline: QualityBaseline = {
    version: 1,
    generatedAt: report.generatedAt,
    input: {
      sha256: report.input.sha256,
      inspectedReferenceCount: report.input.inspectedReferenceCount,
    },
    directRuns: report.directRuns.map((run) => ({
      key: directQualityKey(run),
      quality: run.quality,
    })),
    httpRuns: report.httpRuns
      .filter((run): run is HttpRunSummary & { quality: QualitySummary } => run.quality != null)
      .map((run) => ({
        key: httpQualityKey(run),
        quality: run.quality,
      })),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

async function compareQualityBaseline(
  baselinePath: string,
  input: InputSummary,
  directRuns: DirectRunSummary[],
  httpRuns: HttpRunSummary[],
): Promise<QualityComparison[]> {
  const baseline = normalizeQualityBaseline(JSON.parse(await readFile(baselinePath, 'utf8')) as QualityBaseline | Report);
  const comparisons: QualityComparison[] = [];
  if (baseline.input.sha256 !== input.sha256) {
    comparisons.push({
      key: 'input',
      layer: 'input',
      status: 'fail',
      hardFailures: [`input sha256 changed: baseline ${baseline.input.sha256}, current ${input.sha256}`],
      warnings: [],
      diffs: [],
    });
  }
  if (baseline.input.inspectedReferenceCount !== input.inspectedReferenceCount) {
    comparisons.push({
      key: 'input',
      layer: 'input',
      status: 'fail',
      hardFailures: [
        `inspected split count changed: baseline ${baseline.input.inspectedReferenceCount}, current ${input.inspectedReferenceCount}`,
      ],
      warnings: [],
      diffs: [],
    });
  }

  comparisons.push(
    ...compareQualityRuns(
      new Map(baseline.directRuns.map((run) => [run.key, run.quality])),
      new Map(directRuns.map((run) => [directQualityKey(run), run.quality])),
      'direct_engine',
    ),
  );
  comparisons.push(
    ...compareQualityRuns(
      new Map(baseline.httpRuns.map((run) => [run.key, run.quality])),
      new Map(httpRuns.filter((run) => run.quality).map((run) => [httpQualityKey(run), run.quality!])),
      'http_convert',
    ),
  );
  return comparisons;
}

function normalizeQualityBaseline(value: QualityBaseline | Report): QualityBaseline {
  if ('version' in value && value.version === 1 && Array.isArray(value.directRuns)) {
    const firstDirectRun = value.directRuns[0] as DirectRunSummary | QualityBaselineRun | undefined;
    if (firstDirectRun && 'key' in firstDirectRun && 'quality' in firstDirectRun) {
      return value as QualityBaseline;
    }
  }

  const report = value as Report;
  return {
    version: 1,
    generatedAt: report.generatedAt,
    input: {
      sha256: report.input.sha256,
      inspectedReferenceCount: report.input.inspectedReferenceCount,
    },
    directRuns: report.directRuns.map((run) => ({
      key: directQualityKey(run),
      quality: run.quality,
    })),
    httpRuns: report.httpRuns
      .filter((run): run is HttpRunSummary & { quality: QualitySummary } => run.quality != null)
      .map((run) => ({
        key: httpQualityKey(run),
        quality: run.quality,
      })),
  };
}

function compareQualityRuns(
  baselineRuns: Map<string, QualitySummary>,
  currentRuns: Map<string, QualitySummary>,
  layer: DirectRunSummary['layer'] | HttpRunSummary['layer'],
): QualityComparison[] {
  const comparisons: QualityComparison[] = [];
  for (const [key, baseline] of baselineRuns) {
    const current = currentRuns.get(key);
    if (!current) {
      comparisons.push({
        key,
        layer,
        status: 'missing_current',
        hardFailures: ['current run is missing'],
        warnings: [],
        diffs: [],
      });
      continue;
    }
    comparisons.push(compareQualitySummary(key, layer, baseline, current));
  }
  for (const key of currentRuns.keys()) {
    if (!baselineRuns.has(key)) {
      comparisons.push({
        key,
        layer,
        status: 'missing_baseline',
        hardFailures: ['baseline run is missing'],
        warnings: [],
        diffs: [],
      });
    }
  }
  return comparisons;
}

function compareQualitySummary(
  key: string,
  layer: DirectRunSummary['layer'] | HttpRunSummary['layer'],
  baseline: QualitySummary,
  current: QualitySummary,
): QualityComparison {
  const hardChecks: Array<[string, unknown, unknown]> = [
    ['referenceCount', baseline.referenceCount, current.referenceCount],
    ['splitHash', baseline.splitHash, current.splitHash],
    ['fieldHash', baseline.fieldHash, current.fieldHash],
    ['renderedHash', baseline.renderedHash, current.renderedHash],
    ['semanticHash', baseline.semanticHash, current.semanticHash],
    ['contractHash', baseline.contractHash, current.contractHash],
    ['failedCount', baseline.failedCount, current.failedCount],
    ['emptyRenderedCount', baseline.emptyRenderedCount, current.emptyRenderedCount],
  ];
  const hardFailures = hardChecks
    .filter(([, left, right]) => left !== right)
    .map(([label, left, right]) => `${label} changed: baseline ${String(left)}, current ${String(right)}`);
  const warnings: string[] = [];
  if (baseline.needsReviewCount !== current.needsReviewCount) {
    warnings.push(`needsReviewCount changed: baseline ${baseline.needsReviewCount}, current ${current.needsReviewCount}`);
  }
  if (baseline.needsActionCount !== current.needsActionCount) {
    warnings.push(`needsActionCount changed: baseline ${baseline.needsActionCount}, current ${current.needsActionCount}`);
  }
  if (JSON.stringify(baseline.criticalFieldPresence) !== JSON.stringify(current.criticalFieldPresence)) {
    hardFailures.push('criticalFieldPresence changed');
  }
  if (JSON.stringify(baseline.providerUsage) !== JSON.stringify(current.providerUsage)) {
    warnings.push('providerUsage changed');
  }
  const diffs = hardFailures.length > 0
    ? summarizeReferenceFingerprintDiffs(baseline.referenceFingerprints ?? [], current.referenceFingerprints ?? [])
    : [];

  return {
    key,
    layer,
    status: hardFailures.length > 0 ? 'fail' : 'pass',
    hardFailures,
    warnings,
    diffs,
  };
}

function summarizeReferenceFingerprintDiffs(
  baseline: QualityReferenceFingerprint[],
  current: QualityReferenceFingerprint[],
): string[] {
  const currentByIndex = new Map(current.map((fingerprint) => [fingerprint.index, fingerprint]));
  const baselineByIndex = new Map(baseline.map((fingerprint) => [fingerprint.index, fingerprint]));
  const diffs: string[] = [];
  for (const fingerprint of baseline) {
    const next = currentByIndex.get(fingerprint.index);
    if (!next) {
      diffs.push(`missing current ref ${fingerprint.index}: ${fingerprint.rawPreview}`);
      continue;
    }
    const changed: string[] = [];
    if (fingerprint.splitHash !== next.splitHash) changed.push('split');
    if (fingerprint.fieldHash !== next.fieldHash) changed.push('fields');
    if (fingerprint.renderedHash !== next.renderedHash) changed.push('rendered');
    if (fingerprint.semanticHash !== next.semanticHash) changed.push('semantic');
    if (fingerprint.contractHash !== next.contractHash) changed.push('contract');
    if (JSON.stringify(fingerprint.criticalFields) !== JSON.stringify(next.criticalFields)) changed.push('critical-fields');
    if (changed.length > 0) {
      diffs.push(`changed ref ${fingerprint.index} (${changed.join(', ')}): ${fingerprint.rawPreview}`);
    }
    if (diffs.length >= 20) {
      diffs.push('diff preview truncated after 20 entries');
      return diffs;
    }
  }
  for (const fingerprint of current) {
    if (!baselineByIndex.has(fingerprint.index)) {
      diffs.push(`new current ref ${fingerprint.index}: ${fingerprint.rawPreview}`);
    }
    if (diffs.length >= 20) {
      diffs.push('diff preview truncated after 20 entries');
      return diffs;
    }
  }
  return diffs;
}

function directQualityKey(run: Pick<DirectRunSummary, 'parseProfile' | 'runtimeProfile' | 'repeatIndex'>): string {
  return `direct:${run.parseProfile}:${run.runtimeProfile}:repeat-${run.repeatIndex}`;
}

function httpQualityKey(run: Pick<HttpRunSummary, 'payloadMode'>): string {
  return `http:${run.payloadMode}`;
}

function computeQualitySummary(response: QualityPayload): QualitySummary {
  const references = response.references;
  const indexById = new Map(references.map((reference) => [reference.id, reference.index]));
  const splitRows = references.map((reference) => ({
    index: reference.index,
    raw: normalizeQualityText(reference.raw),
  }));
  const fieldRows = references.map((reference) => ({
    index: reference.index,
    fields: fieldValuesOnly(reference.fields),
  }));
  const renderedRows = references.map((reference) => ({
    index: reference.index,
    renderedText: normalizeQualityText(reference.renderedText),
  }));
  const semanticRows = references.map((reference) => ({
    index: reference.index,
    raw: normalizeQualityText(reference.raw),
    referenceType: reference.referenceType,
    detectedStyle: reference.detectedStyle,
    effectiveStyle: reference.effectiveStyle,
    fields: fieldValuesOnly(reference.fields),
    renderedText: normalizeQualityText(reference.renderedText),
    publicStatus: reference.publicStatus,
    parseOutcome: reference.parseOutcome,
    status: reference.status,
    error: reference.error ?? null,
  }));
  const contractRows = references.map((reference) => ({
    index: reference.index,
    referenceType: reference.referenceType,
    detectedStyleFamily: reference.detectedStyleFamily,
    detectedStyle: reference.detectedStyle,
    effectiveStyle: reference.effectiveStyle,
    publicStatus: reference.publicStatus,
    parseOutcome: reference.parseOutcome,
      status: reference.status,
      fields: fieldValuesOnly(reference.fields),
      healthReasons: sortPrimitiveValues(reference.healthReasons),
      healthBreakdown: sortHealthBreakdown(reference.healthBreakdown),
      healthWarnings: sortHealthWarnings(reference.healthWarnings),
      renderedWarnings: sortPrimitiveValues(reference.renderedWarnings),
      error: reference.error ?? null,
      duplicateOfIndex: reference.duplicateOf ? indexById.get(reference.duplicateOf) ?? null : null,
    }));
  return {
    version: 1,
    referenceCount: references.length,
    splitHash: hashCanonicalJson(splitRows),
    fieldHash: hashCanonicalJson(fieldRows),
    renderedHash: hashCanonicalJson(renderedRows),
    semanticHash: hashCanonicalJson(semanticRows),
    contractHash: hashCanonicalJson(contractRows),
    failedCount: response.summary.failed,
    emptyRenderedCount: references.filter((reference) => !reference.renderedText.trim()).length,
    needsReviewCount: response.summary.needsReview,
    needsActionCount: response.summary.needsAction,
    criticalFieldPresence: criticalFieldPresence(references),
    providerUsage: response.providerUsage ?? null,
    referenceFingerprints: references.map((reference, index) => ({
      index: reference.index,
      rawPreview: preview(reference.raw),
      splitHash: hashCanonicalJson(splitRows[index]),
      fieldHash: hashCanonicalJson(fieldRows[index]),
      renderedHash: hashCanonicalJson(renderedRows[index]),
      semanticHash: hashCanonicalJson(semanticRows[index]),
      contractHash: hashCanonicalJson(contractRows[index]),
      publicStatus: reference.publicStatus,
      referenceType: reference.referenceType,
      criticalFields: criticalFieldFlags(reference),
    })),
  };
}

function fieldValuesOnly(fields: ConvertResponse['references'][number]['fields']): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, canonicalizeJsonValue(field.value)]),
  );
}

function criticalFieldPresence(references: ConvertResponse['references']): Record<string, number> {
  const counts = {
    title: 0,
    year: 0,
    authors: 0,
    container: 0,
    doi: 0,
    url: 0,
    pages: 0,
    volume: 0,
    issue: 0,
    knownReferenceType: 0,
  };
  for (const reference of references) {
    const fields = reference.fields;
    if (hasQualityValue(fields.title.value)) counts.title += 1;
    if (hasQualityValue(fields.year.value)) counts.year += 1;
    if (Array.isArray(fields.authors.value) && fields.authors.value.length > 0) counts.authors += 1;
    if (
      hasQualityValue(fields.journal.value)
      || hasQualityValue(fields.bookTitle.value)
      || hasQualityValue(fields.conferenceTitle.value)
      || hasQualityValue(fields.publisher.value)
      || hasQualityValue(fields.siteName.value)
    ) {
      counts.container += 1;
    }
    if (hasQualityValue(fields.doi.value)) counts.doi += 1;
    if (hasQualityValue(fields.url.value)) counts.url += 1;
    if (hasQualityValue(fields.pages.value) || hasQualityValue(fields.articleNumber.value)) counts.pages += 1;
    if (hasQualityValue(fields.volume.value)) counts.volume += 1;
    if (hasQualityValue(fields.issue.value)) counts.issue += 1;
    if (reference.referenceType !== 'unknown') counts.knownReferenceType += 1;
  }
  return counts;
}

function criticalFieldFlags(reference: ConvertResponse['references'][number]): Record<string, boolean> {
  const fields = reference.fields;
  return {
    title: hasQualityValue(fields.title.value),
    year: hasQualityValue(fields.year.value),
    authors: Array.isArray(fields.authors.value) && fields.authors.value.length > 0,
    container: hasQualityValue(fields.journal.value)
      || hasQualityValue(fields.bookTitle.value)
      || hasQualityValue(fields.conferenceTitle.value)
      || hasQualityValue(fields.publisher.value)
      || hasQualityValue(fields.siteName.value),
    doi: hasQualityValue(fields.doi.value),
    url: hasQualityValue(fields.url.value),
    pages: hasQualityValue(fields.pages.value) || hasQualityValue(fields.articleNumber.value),
    volume: hasQualityValue(fields.volume.value),
    issue: hasQualityValue(fields.issue.value),
    knownReferenceType: reference.referenceType !== 'unknown',
  };
}

function sortPrimitiveValues(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortHealthWarnings(
  warnings: ConvertResponse['references'][number]['healthWarnings'],
): ConvertResponse['references'][number]['healthWarnings'] {
  return [...warnings].sort((left, right) =>
    `${left.severity}:${left.code}:${left.message ?? ''}`.localeCompare(
      `${right.severity}:${right.code}:${right.message ?? ''}`,
    ),
  );
}

function sortHealthBreakdown(
  breakdown: ConvertResponse['references'][number]['healthBreakdown'],
): ConvertResponse['references'][number]['healthBreakdown'] {
  return {
    missingMandatory: sortPrimitiveValues(breakdown.missingMandatory),
    invalidMandatory: sortPrimitiveValues(breakdown.invalidMandatory),
    lowConfidenceMandatory: sortPrimitiveValues(breakdown.lowConfidenceMandatory),
    presentMandatory: sortPrimitiveValues(breakdown.presentMandatory),
  };
}

function hasQualityValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normalizeQualityText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function hashCanonicalJson(value: unknown): string {
  return `sha256:${sha256(JSON.stringify(canonicalizeJsonValue(value)))}`;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJsonValue(entry)]),
    );
  }

  return value;
}

function parseList(value: string): string[] {
  return value
    .split(/[,\s]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseParseProfileList(value: string, label: string): ParseProfile[] {
  const values = parseList(value);
  if (values.length === 0) {
    throw new Error(`${label} must include at least one parse profile.`);
  }
  for (const entry of values) {
    if (!ALLOWED_PARSE_PROFILES.has(entry as ParseProfile)) {
      throw new Error(`${label} contains unsupported parse profile "${entry}".`);
    }
  }
  return values as ParseProfile[];
}

function parseRuntimeProfileList(value: string, label: string): PipelineRuntimeProfile[] {
  const values = parseList(value);
  if (values.length === 0) {
    throw new Error(`${label} must include at least one runtime profile.`);
  }
  for (const entry of values) {
    if (!ALLOWED_RUNTIME_PROFILES.has(entry as PipelineRuntimeProfile)) {
      throw new Error(`${label} contains unsupported runtime profile "${entry}".`);
    }
  }
  return values as PipelineRuntimeProfile[];
}

function parseHttpPayloadModeList(value: string, label: string): HttpPayloadMode[] {
  const values = parseList(value);
  if (values.length === 0) {
    throw new Error(`${label} must include at least one HTTP payload mode.`);
  }
  for (const entry of values) {
    if (entry !== 'site_default' && !ALLOWED_PARSE_PROFILES.has(entry as ParseProfile)) {
      throw new Error(`${label} contains unsupported payload mode "${entry}".`);
    }
  }
  return values as HttpPayloadMode[];
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function addHeader(headers: Record<string, string>, raw: string): void {
  const separator = raw.indexOf(':');
  if (separator <= 0) {
    throw new Error(`Header must be "Name: value"; received "${raw}".`);
  }
  const name = raw.slice(0, separator).trim();
  const value = raw.slice(separator + 1).trim();
  if (!name || !value) {
    throw new Error(`Header must be "Name: value"; received "${raw}".`);
  }
  headers[name] = value;
}

function stageTotals(stageTimings: ProcessingPath['stageTimings']): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const timing of stageTimings) {
    totals[timing.phaseId] = round((totals[timing.phaseId] ?? 0) + timing.durationMs);
  }
  return totals;
}

function summarizeDiagnostics(records: StageRunRecord[]): DiagnosticDetail[] {
  return records
    .filter((record) => record.details || record.phaseId === 'author_disambiguation')
    .map((record) => ({
      phaseId: record.phaseId,
      stageId: record.stageId,
      status: record.status,
      durationMs: record.durationMs,
      message: record.message ?? null,
      details: record.details ?? null,
    }));
}

function throughput(count: number, durationMs: number): number {
  return durationMs > 0 ? round(count / (durationMs / 1000)) : 0;
}

function round(value: number, places = ROUND_PLACES): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function preview(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function withConsoleInfoMuted<T>(run: () => Promise<T>): Promise<T> {
  const originalInfo = console.info;
  console.info = () => {};
  try {
    return await run();
  } finally {
    console.info = originalInfo;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function printHelpAndExit(): never {
  process.stdout.write(`Usage:
  pnpm --dir server exec tsx scripts/diagnostics/admin-throughput-gap.ts --input <path>

Options:
  --input <path>                 Text fixture to measure. Defaults to built-in numbered mixed-style fixture.
  --fixture numbered_mixed_style_regression
  --url <url>                    Optional convert endpoint, e.g. http://localhost:2397/api/engine/convert
  --header "Name: value"         Optional HTTP header. Repeatable.
  --bearer <token>               Convenience for Authorization: Bearer <token>.
  --cookie <cookie>              Convenience for Cookie: <cookie>.
  --outputStyle <style>          Default: apa7
  --parseProfiles <csv>          Default: core_parse_fast,core_parse_full
  --runtimeProfiles <csv>        Default: site_default,benchmark_5600h
  --httpPayloadModes <csv>       Default: site_default,core_parse_fast
  --repeat <n>                   Default: 1
  --qualityBaseline <path>       Compare quality hashes against a prior diagnostic report or baseline.
  --writeQualityBaseline <path>  Write a quality-only baseline for this run.
  --output <path>                Default: benchmarks/manual/results/admin_500_throughput_gap.<timestamp>.json
`);
  process.exit(0);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
