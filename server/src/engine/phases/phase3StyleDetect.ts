import type { MLClient, StyleDetectionPrediction } from '../../ml/client.js';
import { detectCitationStyles } from '../styleDetection.js';
import { ErrorCode } from '../errors/index.js';
import type { RawBlock } from '../types/ingestion.js';
import type { ReferenceCarrier, StyleDetectionResult } from '../types/carrier.js';
import type { CitationStyle, StyleFamily } from '../types/citation.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import { buildReferenceCarrier } from '../utils/carriers.js';
import { runWithRemainingStageBudgetAbortable } from '../../pipeline/performance.js';

const CONTRACT_VERSION = 2;

export class Phase3StyleDetect implements PipelineStage<RawBlock[], ReferenceCarrier[]> {
  readonly phaseId = 'style_detection' as const;
  readonly contractVersion = CONTRACT_VERSION;

  constructor(private readonly mlClient?: MLClient) {}

  async run(blocks: RawBlock[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();
    const captureCarrierDiagnostics = ctx.executionPolicy.debugMode !== 'off';
    const texts = blocks.map((block) => block.text);
    let usedFallback = false;
    let budgetExceeded = false;
    let mlHintsDisabledByPolicy = false;
    let skippedMlForConfidentSingle = false;
    let mlPredictions: StyleDetectionPrediction[] = [];
    const deterministicStyleResults =
      shouldPrecomputeDeterministicStyleResults(ctx, texts.length)
        ? detectCitationStyles(texts)
        : null;

    if (ctx.executionPolicy.styleDetectionMl === 'off') {
      mlHintsDisabledByPolicy = true;
    } else if (
      deterministicStyleResults
      && deterministicStyleResults.length === 1
      && shouldSkipMlHintsForDeterministicSingle(deterministicStyleResults[0])
    ) {
      skippedMlForConfidentSingle = true;
    } else {
      try {
        if (!this.mlClient) {
          throw new Error('No ML client configured.');
        }
        const budgeted = await runWithRemainingStageBudgetAbortable(ctx, this.phaseId, startedAt, (signal) =>
          this.mlClient!.detectStyle(texts, { signal }),
          ctx.abortSignal,
        );
        if (budgeted.timedOut) {
          usedFallback = true;
          budgetExceeded = true;
        } else {
          mlPredictions = budgeted.value;
        }
      } catch (error) {
        if (ctx.abortSignal?.aborted) {
          throw error;
        }
        usedFallback = true;
      }
    }

    const styleResults =
      mlHintsDisabledByPolicy || skippedMlForConfidentSingle
        ? deterministicStyleResults ?? detectCitationStyles(texts)
        : detectCitationStyles(
          texts,
          texts.map((_, index) => toMlStyleHint(mlPredictions[index] ?? null)),
        );

    const primaryFamilies = styleResults.map((result) => result.family);
    const modeFamily = getMode(primaryFamilies);
    const familyDrift = modeFamily === 'unknown'
      ? 0
      : primaryFamilies.filter((family) => family !== modeFamily).length / Math.max(1, primaryFamilies.length);
    const isMultiStyle = styleResults.some((result) => result.isMultiStyle) || familyDrift > 0.2;

    const carriers = blocks.map((block, index) => {
      const style = {
        ...styleResults[index]!,
        isMultiStyle,
      };
      const carrier = buildReferenceCarrier(block, style, ctx.detectionMeta, ctx.outputStyle);
      if (captureCarrierDiagnostics) {
        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: usedFallback ? 'warning' : 'success',
            durationMs: 0,
            ...(usedFallback ? { code: ErrorCode.STYLE_ML_UNAVAILABLE } : {}),
            message: usedFallback
              ? budgetExceeded
                ? 'Style detection used deterministic structured scoring after the phase budget was exceeded.'
                : 'Style detection used deterministic structured scoring without ML hints.'
              : mlHintsDisabledByPolicy
                ? 'Style detection completed with deterministic structured scoring; ML hints were disabled by the execution policy.'
                : skippedMlForConfidentSingle
                  ? 'Style detection completed with deterministic structured scoring; ML hints were skipped for a high-confidence single citation.'
              : 'Style detection completed with structured family-first scoring.',
            details: {
              detectedStyleFamily: style.family,
              detectedStyle: style.primary.style,
              familyConfidence: style.familyConfidence,
              styleConfidence: style.styleConfidence,
              certaintyTier: style.certaintyTier,
              signalCount: style.signals.length,
            },
          }),
        );
      }
      return carrier;
    });

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: usedFallback ? 'warning' : 'success',
        durationMs: Date.now() - startedAt,
        ...(usedFallback ? { code: ErrorCode.STYLE_ML_UNAVAILABLE } : {}),
        message: usedFallback
          ? budgetExceeded
            ? 'Phase 3 exceeded its latency budget and used deterministic family-first style detection without ML hints.'
            : 'Phase 3 used deterministic family-first style detection without ML hints.'
          : mlHintsDisabledByPolicy
            ? 'Phase 3 deterministic family-first style detection completed with ML hints disabled by the execution policy.'
            : skippedMlForConfidentSingle
              ? 'Phase 3 deterministic family-first style detection completed without ML hints for a high-confidence single citation.'
          : 'Phase 3 family-first style detection completed.',
        details: {
          blockCount: blocks.length,
          isMultiStyle,
          modeFamily,
        },
      }),
    );

    return carriers;
  }
}

export const phase3StyleDetect = new Phase3StyleDetect();

function shouldPrecomputeDeterministicStyleResults(ctx: PipelineContext, blockCount: number): boolean {
  return ctx.executionPolicy.styleDetectionMl === 'off' || blockCount === 1;
}

function shouldSkipMlHintsForDeterministicSingle(result: StyleDetectionResult | undefined): boolean {
  if (!result) {
    return false;
  }

  return (
    !result.isUnknown
    && result.certaintyTier === 'high'
    && result.primary.style !== 'unknown'
    && result.familyConfidence >= 0.88
    && result.styleConfidence >= 0.72
  );
}

function getMode<T extends CitationStyle | StyleFamily>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let best = values[0] ?? ('unknown' as T);
  let max = 0;
  for (const [value, count] of counts.entries()) {
    if (count > max) {
      best = value;
      max = count;
    }
  }

  return best;
}

function stageRecord(
  record: Omit<StageRunRecord, 'stageId' | 'contractVersion'>,
): StageRunRecord {
  return {
    stageId: 'phase3_style_detection',
    contractVersion: CONTRACT_VERSION,
    ...record,
  };
}

function toMlStyleHint(prediction: StyleDetectionPrediction | null): StyleDetectionPrediction | null {
  if (!prediction) {
    return null;
  }

  if (!prediction.decision) {
    return prediction;
  }

  if (prediction.decision !== 'supported_exact') {
    return null;
  }

  if (!prediction.exactStyle || prediction.exactStyle === 'unknown' || prediction.exactStyle === 'auto') {
    return null;
  }

  return {
    ...prediction,
    primary: {
      style: prediction.exactStyle,
      confidence: prediction.confidence ?? prediction.primary.confidence,
    },
    secondary: prediction.secondary,
  };
}
