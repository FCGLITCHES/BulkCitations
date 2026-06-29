import { env } from '../config.js';
import type { PhaseId, PipelineContext, ProcessingPath } from '../engine/types/pipeline.js';

const BUDGETED_PHASES = [
  'style_detection',
  'extraction',
  'author_disambiguation',
  'type_classification',
  'llm_fallback',
  'enrichment',
  'authority_validation',
] satisfies PhaseId[];
const STAGE_BUDGET_HEADROOM_MS = 20;

export type StageBudgetMap = Partial<Record<PhaseId, number>>;

export function createStageBudgets(
  defaultBudgetMs = env.PIPELINE_STAGE_BUDGET_MS,
): StageBudgetMap {
  const budgets: StageBudgetMap = {};

  for (const phaseId of BUDGETED_PHASES) {
    budgets[phaseId] = defaultBudgetMs;
  }

  return budgets;
}

export function getStageBudgetMs(
  ctx: Pick<PipelineContext, 'performanceBudgets'>,
  phaseId: PhaseId,
): number | null {
  return ctx.performanceBudgets[phaseId] ?? null;
}

export function getRemainingStageBudgetMs(
  ctx: Pick<PipelineContext, 'performanceBudgets'>,
  phaseId: PhaseId,
  startedAt: number,
): number | null {
  const budgetMs = getStageBudgetMs(ctx, phaseId);
  if (budgetMs == null) return null;
  return Math.max(0, budgetMs - (Date.now() - startedAt) - STAGE_BUDGET_HEADROOM_MS);
}

export function isStageBudgetExceeded(
  ctx: Pick<PipelineContext, 'performanceBudgets'>,
  phaseId: PhaseId,
  startedAt: number,
): boolean {
  const remainingMs = getRemainingStageBudgetMs(ctx, phaseId, startedAt);
  return remainingMs != null && remainingMs <= 0;
}

export async function runWithRemainingStageBudget<T>(
  ctx: Pick<PipelineContext, 'performanceBudgets'>,
  phaseId: PhaseId,
  startedAt: number,
  run: () => Promise<T>,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  const remainingMs = getRemainingStageBudgetMs(ctx, phaseId, startedAt);
  if (remainingMs != null && remainingMs <= 0) {
    return { timedOut: true };
  }

  if (remainingMs == null) {
    return {
      timedOut: false,
      value: await run(),
    };
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({ timedOut: true });
    }, remainingMs);

    void run()
      .then((value) => {
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function runWithRemainingStageBudgetAbortable<T>(
  ctx: Pick<PipelineContext, 'performanceBudgets'>,
  phaseId: PhaseId,
  startedAt: number,
  run: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  const remainingMs = getRemainingStageBudgetMs(ctx, phaseId, startedAt);
  if (remainingMs != null && remainingMs <= 0) {
    return { timedOut: true };
  }

  const controller = new AbortController();
  const cleanupAbortLink = linkAbortSignal(externalSignal, controller);

  if (remainingMs == null) {
    try {
      return {
        timedOut: false,
        value: await run(controller.signal),
      };
    } finally {
      cleanupAbortLink();
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      controller.abort(new Error(`Stage ${phaseId} exceeded its remaining budget.`));
      cleanupAbortLink();
      resolve({ timedOut: true });
    }, remainingMs);

    void run(controller.signal)
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        cleanupAbortLink();
        resolve({ timedOut: false, value });
      })
      .catch((error) => {
        if (settled && isAbortLikeError(error)) {
          return;
        }
        if (settled && externalSignal?.aborted) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        cleanupAbortLink();
        reject(error);
      });
  });
}

export async function runWithConcurrencyLimit<T>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, values.length));
  let cursor = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;

      if (index >= values.length) return;

      const value = values[index];
      if (value === undefined) return;
      await worker(value, index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

export function toStageTimingSummary(
  ctx: Pick<PipelineContext, 'performanceBudgets' | 'stageLog'>,
): ProcessingPath['stageTimings'] {
  return ctx.stageLog.map((record) => {
    const budgetMs = getStageBudgetMs(ctx, record.phaseId);
    return {
      phaseId: record.phaseId,
      durationMs: record.durationMs,
      status: record.status,
      budgetMs,
      withinBudget: budgetMs == null ? null : record.durationMs <= budgetMs,
    };
  });
}

function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) {
    return () => {};
  }

  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }

  const onAbort = () => {
    controller.abort(signal.reason);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  return () => {
    signal.removeEventListener('abort', onAbort);
  };
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (typeof error === 'object' && error != null && 'code' in error) {
    return (error as { code?: unknown }).code === 'INFERENCE_TIMEOUT';
  }
  return false;
}
