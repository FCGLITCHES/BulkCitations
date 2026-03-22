import pLimit from 'p-limit';
import type { V2StageId } from '@shared/schema';
import type { V2StageRuntimeConfig } from './config.js';
import { DEFAULT_V2_STAGE_CONFIG } from './config.js';
import { isTimeoutError, runWithTimeout } from './utils.js';

type StageIsolationMeta<TItem> = {
  item: TItem;
  index: number;
  message: string;
  timedOut: boolean;
  error: unknown;
};

export type StageIsolationOutcome<TResult> = {
  result: TResult;
  recovered: boolean;
  timedOut: boolean;
  errorMessage?: string;
};

type StageRuntimeConfigMap = Partial<Record<V2StageId, Partial<V2StageRuntimeConfig>>>;

function readPositiveIntEnv(name: string): number | null {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getStageIsolationConcurrency(stageId: V2StageId, fallback = 6): number {
  const override = readPositiveIntEnv(`V2_${stageId.toUpperCase()}_CONCURRENCY`);
  if (override) return override;

  switch (stageId) {
    case 'split':
      return 1;
    case 'detect':
      return 12;
    case 'extract':
      return 6;
    case 'enrich':
      return 3;
    case 'normalize':
      return 10;
    case 'validate':
      return 8;
    case 'truth':
      return 6;
    case 'dedup':
      return 4;
    case 'score':
      return 10;
    case 'render':
      return 6;
    default:
      return fallback;
  }
}

export function getStageIsolationTimeoutMs(stageId: V2StageId, fallbackMs: number): number {
  const override = readPositiveIntEnv(`V2_${stageId.toUpperCase()}_ITEM_TIMEOUT_MS`);
  if (override) return override;

  switch (stageId) {
    case 'detect':
      return Math.min(fallbackMs, 750);
    case 'normalize':
      return Math.min(fallbackMs, 1_000);
    case 'validate':
      return Math.min(fallbackMs, 1_200);
    case 'truth':
      return Math.min(fallbackMs, 1_500);
    case 'score':
      return Math.min(fallbackMs, 900);
    case 'render':
      return Math.min(Math.max(fallbackMs, 1_500), 2_500);
    default:
      return fallbackMs;
  }
}

export function getStageRuntimeTimeoutMs(
  stageId: V2StageId,
  stageConfig?: StageRuntimeConfigMap | null,
): number {
  const configured = stageConfig?.[stageId]?.timeoutMs;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_V2_STAGE_CONFIG[stageId].timeoutMs;
}

export async function runStageTasksWithIsolation<TItem, TResult>(options: {
  stageId: V2StageId;
  items: readonly TItem[];
  concurrency?: number;
  timeoutMs?: number;
  label?: (item: TItem, index: number) => string;
  run: (item: TItem, index: number) => Promise<TResult> | TResult;
  recover: (meta: StageIsolationMeta<TItem>) => Promise<TResult> | TResult;
}): Promise<{
  outcomes: Array<StageIsolationOutcome<TResult>>;
  recoveredCount: number;
  timeoutCount: number;
  errorCount: number;
}> {
  const limit = pLimit(Math.max(1, options.concurrency ?? getStageIsolationConcurrency(options.stageId)));
  const outcomes = await Promise.all(options.items.map((item, index) => limit(async () => {
    const label = options.label?.(item, index) ?? `${options.stageId}[${index + 1}]`;
    try {
      const task = Promise.resolve().then(() => options.run(item, index));
      const result = options.timeoutMs && options.timeoutMs > 0
        ? await runWithTimeout(label, task, options.timeoutMs)
        : await task;
      return {
        result,
        recovered: false,
        timedOut: false,
      } satisfies StageIsolationOutcome<TResult>;
    } catch (error) {
      const timedOut = isTimeoutError(error);
      const message = error instanceof Error ? error.message : String(error);
      const result = await options.recover({
        item,
        index,
        message,
        timedOut,
        error,
      });
      return {
        result,
        recovered: true,
        timedOut,
        errorMessage: message,
      } satisfies StageIsolationOutcome<TResult>;
    }
  })));

  return summarizeIsolationOutcomes(outcomes);
}

export async function runStageTasksSequentiallyWithIsolation<TItem, TResult>(options: {
  stageId: V2StageId;
  items: readonly TItem[];
  run: (item: TItem, index: number) => Promise<TResult> | TResult;
  recover: (meta: StageIsolationMeta<TItem>) => Promise<TResult> | TResult;
}): Promise<{
  outcomes: Array<StageIsolationOutcome<TResult>>;
  recoveredCount: number;
  timeoutCount: number;
  errorCount: number;
}> {
  const outcomes: Array<StageIsolationOutcome<TResult>> = [];

  for (const [index, item] of options.items.entries()) {
    try {
      outcomes.push({
        result: await options.run(item, index),
        recovered: false,
        timedOut: false,
      });
    } catch (error) {
      const timedOut = isTimeoutError(error);
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({
        result: await options.recover({
          item,
          index,
          message,
          timedOut,
          error,
        }),
        recovered: true,
        timedOut,
        errorMessage: message,
      });
    }
  }

  return summarizeIsolationOutcomes(outcomes);
}

function summarizeIsolationOutcomes<TResult>(outcomes: Array<StageIsolationOutcome<TResult>>) {
  return {
    outcomes,
    recoveredCount: outcomes.filter((outcome) => outcome.recovered).length,
    timeoutCount: outcomes.filter((outcome) => outcome.timedOut).length,
    errorCount: outcomes.filter((outcome) => outcome.recovered && !outcome.timedOut).length,
  };
}
