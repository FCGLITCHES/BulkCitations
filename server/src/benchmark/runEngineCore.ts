import type { ConvertRequest } from "../engine/types/api.js";
import type { ProcessedCitation } from "../engine/types/citation.js";
import type { ProcessingPath, ProviderUsage } from "../engine/types/pipeline.js";
import { phase1Ingest } from "../engine/phases/phase1Ingest.js";
import { phase2Split } from "../engine/phases/phase2Split.js";
import type { RawBlock } from "../engine/types/ingestion.js";
import type { ParseProfile } from "../engine/types/parseProfile.js";
import {
  createPipelineContext,
  runConvertPipeline,
  runConvertPipelineFromBlocks,
} from "../pipeline/orchestrator.js";
import type { TruthFieldValue } from "../training/truthFields.js";
import { filterPredictionFieldsByType } from "./integrity.js";
import { deriveVirtualVenue } from "./normalization.js";
import {
  createBenchmarkRuntimeTelemetryAccumulator,
  mergeSlowRows,
  recordRuntimeTelemetry,
  topSlowRows,
  type BenchmarkRuntimeTelemetryAccumulator,
} from "./runtimeTelemetry.js";
import type {
  BenchmarkArtifactDetail,
  BenchmarkManifestRow,
  BenchmarkPredictionRow,
  BenchmarkSlowRow,
  BenchmarkVariant,
} from "./types.js";
import type { BenchmarkRunProfileResolution } from "./runProfile.js";

export interface BenchmarkGroupRunnerOptions {
  runProfile: BenchmarkRunProfileResolution;
  sourceType: ConvertRequest["sourceType"];
  parseProfile: ParseProfile;
  benchmarkVariant?: BenchmarkVariant;
  artifactDetail?: BenchmarkArtifactDetail;
  abortSignal?: AbortSignal;
  collectPredictions?: boolean;
  onChunkComplete?: (chunk: {
    chunkIndex: number;
    predictions: BenchmarkPredictionRow[];
  }) => void | Promise<void>;
}

export interface BenchmarkExecutionPlan {
  executionGroups: BenchmarkManifestRow[][];
  warmupExecutionGroups: BenchmarkManifestRow[][];
}

interface BenchmarkGroupExecutionResult {
  citations: ProcessedCitation[];
  providerUsage: ProviderUsage;
  stageTimings: ProcessingPath["stageTimings"];
  wallClockMs: number;
}

export interface BenchmarkGroupRunResult {
  predictions: BenchmarkPredictionRow[];
  slowRows: BenchmarkSlowRow[];
  telemetry: BenchmarkRuntimeTelemetryAccumulator;
}

export async function withBenchmarkConsoleMuted<T>(run: () => Promise<T>): Promise<T> {
  const originalInfo = console.info;
  console.info = () => {};

  try {
    return await run();
  } finally {
    console.info = originalInfo;
  }
}

export async function runBenchmarkGroups(
  groups: BenchmarkManifestRow[][],
  options: BenchmarkGroupRunnerOptions,
): Promise<BenchmarkPredictionRow[]> {
  const result = await runBenchmarkGroupsWithTelemetry(groups, options);
  return result.predictions;
}

export async function runBenchmarkGroupsWithTelemetry(
  groups: BenchmarkManifestRow[][],
  options: BenchmarkGroupRunnerOptions,
): Promise<BenchmarkGroupRunResult> {
  const predictions: BenchmarkPredictionRow[] = [];
  let slowRows: BenchmarkSlowRow[] = [];
  const executionGroups = coalesceBenchmarkExecutionGroups(groups, options);
  const telemetry = createBenchmarkRuntimeTelemetryAccumulator();
  const collectPredictions = options.collectPredictions !== false;

  for (const [chunkIndex, group] of executionGroups.entries()) {
    throwIfAborted(options.abortSignal);
    const result = await runBenchmarkGroup(group, options);
    const durationPerCitation = result.citations.length > 0
      ? result.wallClockMs / result.citations.length
      : 0;

    recordRuntimeTelemetry(telemetry, {
      providerUsage: result.providerUsage,
      stageTimings: result.stageTimings,
      chunkTelemetry: {
        chunkIndex,
        rowCount: group.length,
        wallClockMs: result.wallClockMs,
        recordIds: [...new Set(group.map((row) => row.record_id))],
      },
    });
    const chunkPredictions = toBenchmarkPredictionRows(
      group,
      result.citations,
      durationPerCitation,
      options.artifactDetail ?? "full",
    );
    slowRows = mergeSlowRows(slowRows, topSlowRows(chunkPredictions));
    if (collectPredictions) {
      predictions.push(...chunkPredictions);
    }
    if (options.onChunkComplete) {
      await options.onChunkComplete({
        chunkIndex,
        predictions: chunkPredictions,
      });
    }
  }

  return {
    predictions,
    slowRows,
    telemetry,
  };
}

export async function runBenchmarkGroup(
  rows: BenchmarkManifestRow[],
  options: BenchmarkGroupRunnerOptions,
): Promise<BenchmarkGroupExecutionResult> {
  const startedAt = Date.now();
  if (shouldUsePresplitFastBenchmark(options)) {
    const presplit = await runPresplitBenchmarkGroup(rows, options);
    return {
      ...presplit,
      wallClockMs: Date.now() - startedAt,
    };
  }

  const separators = options.sourceType === "doi_list" ? ["\n"] : ["\n", "\n\n"];

  for (const separator of separators) {
    throwIfAborted(options.abortSignal);
    const ctx = createPipelineContext({
      outputStyle: "auto",
      options: {
        ...options.runProfile.pipelineOptions,
        parseProfile: options.parseProfile,
      },
      ...(options.runProfile.runtimeTuning
        ? { runtimeTuning: options.runProfile.runtimeTuning }
        : {}),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    });
    const artifacts = await runConvertPipeline(
      {
        sourceType: options.sourceType,
        content: rows.map((row) => row.formatted_string).join(separator),
        outputStyle: "auto",
      },
      ctx,
      options.runProfile.dependencies,
    );

    if (artifacts.response.references.length === rows.length) {
      return {
        citations: artifacts.response.references,
        providerUsage: artifacts.response.providerUsage,
        stageTimings: artifacts.response.processingPath.stageTimings,
        wallClockMs: Date.now() - startedAt,
      };
    }
  }

  const fallbackCitations: ProcessedCitation[] = [];
  const fallbackProviderUsage = createEmptyProviderUsage();
  const fallbackStageTimings: ProcessingPath["stageTimings"] = [];
  for (const row of rows) {
    throwIfAborted(options.abortSignal);
    const ctx = createPipelineContext({
      outputStyle: "auto",
      options: {
        ...options.runProfile.pipelineOptions,
        parseProfile: options.parseProfile,
      },
      ...(options.runProfile.runtimeTuning
        ? { runtimeTuning: options.runProfile.runtimeTuning }
        : {}),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    });
    const artifacts = await runConvertPipeline(
      {
        sourceType: options.sourceType,
        content: row.formatted_string,
        outputStyle: "auto",
      },
      ctx,
      options.runProfile.dependencies,
    );
    const citation = artifacts.response.references[0];
    mergeProviderUsage(fallbackProviderUsage, artifacts.response.providerUsage);
    fallbackStageTimings.push(...artifacts.response.processingPath.stageTimings);
    if (citation) {
      fallbackCitations.push(citation);
    }
  }

  return {
    citations: fallbackCitations,
    providerUsage: fallbackProviderUsage,
    stageTimings: fallbackStageTimings,
    wallClockMs: Date.now() - startedAt,
  };
}

export function groupManifestRows(manifest: BenchmarkManifestRow[]): BenchmarkManifestRow[][] {
  const groups = new Map<string, BenchmarkManifestRow[]>();
  for (const row of manifest) {
    const key = `${row.record_id}:${row.variant_kind}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
      continue;
    }
    groups.set(key, [row]);
  }
  return [...groups.values()];
}

export function selectWarmupGroups(
  groups: BenchmarkManifestRow[][],
  warmupRefs: number,
): BenchmarkManifestRow[][] {
  if (warmupRefs <= 0) {
    return [];
  }

  const selected: BenchmarkManifestRow[][] = [];
  let coveredRefs = 0;
  for (const group of groups) {
    if (coveredRefs >= warmupRefs) {
      break;
    }
    selected.push(group);
    coveredRefs += group.length;
  }

  return selected;
}

export function buildBenchmarkExecutionPlan(
  groups: BenchmarkManifestRow[][],
  warmupRefs: number,
  options: BenchmarkGroupRunnerOptions,
): BenchmarkExecutionPlan {
  const warmupGroups = selectWarmupGroups(groups, warmupRefs);
  if (shouldKeepParallelBenchmarkGroupsRaw(options)) {
    return {
      executionGroups: groups,
      warmupExecutionGroups: warmupGroups,
    };
  }
  return {
    executionGroups: coalesceBenchmarkExecutionGroups(groups, options),
    warmupExecutionGroups: coalesceBenchmarkExecutionGroups(warmupGroups, options),
  };
}

export function coalesceBenchmarkExecutionGroups(
  groups: BenchmarkManifestRow[][],
  options: BenchmarkGroupRunnerOptions,
): BenchmarkManifestRow[][] {
  const targetRows = resolveBenchmarkExecutionTargetRows(options);
  if (targetRows == null || targetRows <= 0) {
    return groups;
  }

  const bundledGroups = bundleBenchmarkGroupsByRecord(groups);
  const coalesced: BenchmarkManifestRow[][] = [];
  let currentGroup: BenchmarkManifestRow[] = [];

  for (const bundle of bundledGroups) {
    if (currentGroup.length > 0 && currentGroup.length + bundle.rowCount > targetRows) {
      coalesced.push(currentGroup);
      currentGroup = [];
    }

    for (const group of bundle.groups) {
      currentGroup.push(...group);
    }

    if (currentGroup.length >= targetRows) {
      coalesced.push(currentGroup);
      currentGroup = [];
    }
  }

  if (currentGroup.length > 0) {
    coalesced.push(currentGroup);
  }

  return coalesced;
}

function resolveBenchmarkExecutionTargetRows(
  options: BenchmarkGroupRunnerOptions,
): number | null {
  if (!shouldCoalesceFastBenchmarkGroups(options)) {
    return null;
  }

  const batchSize = options.runProfile.runtimeTuning?.batchSize ?? 0;
  const multicoreThreshold = options.runProfile.multicoreThreshold ?? 0;
  const targetRows = Math.max(batchSize, multicoreThreshold);
  return targetRows > 0 ? targetRows : null;
}

interface BenchmarkGroupBundle {
  rowCount: number;
  groups: BenchmarkManifestRow[][];
}

function bundleBenchmarkGroupsByRecord(
  groups: BenchmarkManifestRow[][],
): BenchmarkGroupBundle[] {
  const bundles = new Map<string, BenchmarkGroupBundle>();

  for (const group of groups) {
    const recordId = group[0]?.record_id ?? "__missing_record__";
    const existing = bundles.get(recordId);
    if (existing) {
      existing.groups.push(group);
      existing.rowCount += group.length;
      continue;
    }
    bundles.set(recordId, {
      rowCount: group.length,
      groups: [group],
    });
  }

  return [...bundles.values()];
}

async function runPresplitBenchmarkGroup(
  rows: BenchmarkManifestRow[],
  options: BenchmarkGroupRunnerOptions,
): Promise<Omit<BenchmarkGroupExecutionResult, "wallClockMs">> {
  const blocks = await buildBenchmarkRawBlocks(rows, options);
  const ctx = createBenchmarkPipelineContext(options);
  const artifacts = await runConvertPipelineFromBlocks(
    {
      sourceType: options.sourceType,
      blocks,
      countAudit: {
        inputEstimate: rows.length,
        aggregatedCount: rows.length,
        splitCount: rows.length,
        delta: 0,
        needsActionCount: 0,
        droppedCount: 0,
      },
      detectionMeta: {
        confidence: 1,
        sampled: false,
        splitQualityFlag: "ok",
      },
    },
    ctx,
    options.runProfile.dependencies,
  );
  assertBenchmarkGroupAlignment(rows, artifacts.response.references);
  return {
    citations: artifacts.response.references,
    providerUsage: artifacts.response.providerUsage,
    stageTimings: artifacts.response.processingPath.stageTimings,
  };
}

async function buildBenchmarkRawBlocks(
  rows: BenchmarkManifestRow[],
  options: BenchmarkGroupRunnerOptions,
): Promise<RawBlock[]> {
  const blocks: RawBlock[] = [];
  const splitCtx = createSingleRowBenchmarkSplitContext(options);

  for (const [index, row] of rows.entries()) {
    throwIfAborted(options.abortSignal);
    splitCtx.stageLog.length = 0;
    const envelope = await phase1Ingest.run(
      {
        sourceType: options.sourceType,
        content: row.formatted_string,
      },
      splitCtx,
    );
    const split = await phase2Split.run(envelope, splitCtx);
    const block = split.blocks.length === 1
      ? {
          ...split.blocks[0]!,
          index,
          semanticGroupKey: benchmarkSemanticGroupKey(row),
        }
      : createSyntheticBenchmarkRawBlock(row, index, options.sourceType);
    blocks.push(block);
  }

  return blocks;
}

function createSyntheticBenchmarkRawBlock(
  row: BenchmarkManifestRow,
  index: number,
  sourceType: ConvertRequest["sourceType"],
): RawBlock {
  return {
    index,
    text: row.formatted_string,
    semanticGroupKey: benchmarkSemanticGroupKey(row),
    formatMeta: {
      sourceType,
      structure: row.input_structure === "unstructured" ? "unstructured" : "structured",
      detectedFormat: "plain_text",
      formatConfidence: 1,
    },
    splitMethod: "blank_line",
    splitConfidence: 1,
    isDoiResolved: false,
    flags: [],
    splitReason: "benchmark_pre_split",
    blockFormat: "plain_text",
    boundarySignals: ["benchmark_pre_split"],
  };
}

function benchmarkSemanticGroupKey(row: BenchmarkManifestRow): string {
  return `${row.record_id}:${row.variant_kind}`;
}

function createBenchmarkPipelineContext(
  options: BenchmarkGroupRunnerOptions,
  runtimeTuningOverride?: BenchmarkGroupRunnerOptions["runProfile"]["runtimeTuning"],
) {
  const runtimeTuning = runtimeTuningOverride ?? options.runProfile.runtimeTuning;
  return createPipelineContext({
    outputStyle: "auto",
    options: {
      ...options.runProfile.pipelineOptions,
      parseProfile: options.parseProfile,
    },
    ...(runtimeTuning ? { runtimeTuning } : {}),
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
  });
}

function createSingleRowBenchmarkSplitContext(
  options: BenchmarkGroupRunnerOptions,
) {
  return createBenchmarkPipelineContext(options, {
    batchSize: 1,
    maxConcurrency: 1,
    ...(options.runProfile.runtimeTuning?.fastLaneMulticoreMinRefs != null
      ? { fastLaneMulticoreMinRefs: options.runProfile.runtimeTuning.fastLaneMulticoreMinRefs }
      : {}),
  });
}

function shouldUsePresplitFastBenchmark(
  options: BenchmarkGroupRunnerOptions,
): boolean {
  return options.parseProfile === "core_parse_fast"
    && options.sourceType === "text"
    && options.benchmarkVariant !== "diagnostic";
}

function shouldCoalesceFastBenchmarkGroups(
  options: BenchmarkGroupRunnerOptions,
): boolean {
  return shouldUsePresplitFastBenchmark(options);
}

function shouldKeepParallelBenchmarkGroupsRaw(
  options: BenchmarkGroupRunnerOptions,
): boolean {
  return options.benchmarkVariant === "parallel"
    && shouldCoalesceFastBenchmarkGroups(options);
}

function toBenchmarkPredictionRows(
  rows: BenchmarkManifestRow[],
  citations: ProcessedCitation[],
  durationPerCitation: number,
  artifactDetail: BenchmarkArtifactDetail,
): BenchmarkPredictionRow[] {
  return rows.map((row, index) => {
    const citation = citations[index];
    const rawFields = citation ? flattenCitationFields(citation.fields) : {};
    const adapted = citation
      ? filterPredictionFieldsByType(citation.referenceType, rawFields)
      : { fields: {}, strippedFields: [] };
    const prediction: BenchmarkPredictionRow = {
      record_id: row.record_id,
      variant_id: row.variant_id,
      citation_style: row.citation_style,
      formatted_hash: row.formatted_hash,
      reference_type: citation?.referenceType ?? "unknown",
      fields: adapted.fields,
      output_latency_ms: citation?.outputLatencyMs ?? 0,
      duration_ms: durationPerCitation,
      warnings: citation?.healthWarnings.map((warning) => warning.code) ?? [],
    };

    if (artifactDetail === "full") {
      prediction.raw_fields = citation ? rawFields : {};
    }
    prediction.adapter_stripped_fields = adapted.strippedFields;

    const venue = citation
      ? deriveVirtualVenue(citation.referenceType, adapted.fields)
      : undefined;
    if (venue !== undefined) {
      prediction.venue = venue;
    }
    if (citation?.detectedStyle !== undefined) {
      prediction.detected_style = citation.detectedStyle;
    }
    if (citation?.detectedStyleFamily !== undefined) {
      prediction.detected_style_family = citation.detectedStyleFamily;
    }
    if (citation?.referenceType !== undefined) {
      prediction.detected_type = citation.referenceType;
    }
    if (citation?.parseOutcome !== undefined) {
      prediction.parse_outcome = citation.parseOutcome;
    }
    if (citation?.publicStatus !== undefined) {
      prediction.public_status = citation.publicStatus;
    }
    if (citation?.status !== undefined) {
      prediction.status = citation.status;
    }
    const abstainedFields = citation
      ? [...new Set([
          ...citation.healthBreakdown.missingMandatory,
          ...citation.healthBreakdown.invalidMandatory,
          ...citation.healthBreakdown.lowConfidenceMandatory,
        ])].sort()
      : [];
    if (abstainedFields.length > 0) {
      prediction.abstained_fields = abstainedFields;
    }
    if (citation?.healthReasons.length) {
      prediction.health_reason_codes = [...citation.healthReasons];
    }
    if (citation?.healthBreakdown.missingMandatory.length) {
      prediction.missing_mandatory_fields = [...citation.healthBreakdown.missingMandatory];
    }
    if (citation?.healthBreakdown.invalidMandatory.length) {
      prediction.invalid_mandatory_fields = [...citation.healthBreakdown.invalidMandatory];
    }
    if (citation?.healthBreakdown.lowConfidenceMandatory.length) {
      prediction.low_confidence_mandatory_fields = [
        ...citation.healthBreakdown.lowConfidenceMandatory,
      ];
    }
    if (artifactDetail === "full" && citation?.fieldMoveLedger !== undefined) {
      prediction.field_move_ledger = citation.fieldMoveLedger;
    }
    if (artifactDetail === "full" && citation?.renderedText !== undefined) {
      prediction.rendered_text = citation.renderedText;
    }

    return prediction;
  });
}

function flattenCitationFields(fields: ProcessedCitation["fields"]): Record<string, TruthFieldValue> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [
      field,
      Array.isArray(value.value)
        ? value.value.map((entry: unknown) => {
            if (typeof entry !== "object" || entry == null) {
              return toTruthScalar(entry);
            }
            const author = entry as {
              literal?: string;
              family?: string;
              given?: string | null;
            };
            if (typeof author.literal === "string" && author.literal.trim()) {
              return author.literal.trim();
            }
            const family = typeof author.family === "string" ? author.family.trim() : "";
            const given = typeof author.given === "string" ? author.given.trim() : "";
            return family && given ? `${family}, ${given}` : family || given;
          }).filter(Boolean)
        : toTruthScalar(value.value),
    ]),
  );
}

function toTruthScalar(value: unknown): string | number | boolean | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Benchmark run aborted.");
}

function assertBenchmarkGroupAlignment(
  rows: BenchmarkManifestRow[],
  citations: ProcessedCitation[],
): void {
  if (citations.length === rows.length) {
    return;
  }

  throw new Error(
      `Benchmark group produced ${citations.length} citations for ${rows.length} input rows. `
      + "Presplit benchmark groups must preserve 1:1 row alignment; check dedup or row-dropping stages.",
  );
}

function createEmptyProviderUsage(): ProviderUsage {
  return {
    crossrefCalls: 0,
    openalexCalls: 0,
    semanticScholarCalls: 0,
    llmTokensUsed: 0,
    llmRepairCalls: 0,
    cacheHits: 0,
  };
}

function mergeProviderUsage(target: ProviderUsage, source: ProviderUsage): void {
  target.crossrefCalls += source.crossrefCalls;
  target.openalexCalls += source.openalexCalls;
  target.semanticScholarCalls += source.semanticScholarCalls;
  target.llmTokensUsed += source.llmTokensUsed;
  target.llmRepairCalls += source.llmRepairCalls;
  target.cacheHits += source.cacheHits;
}
