import type { V2LlmBudget, V2PipelineContext } from './contracts.js';

const DEFAULT_OPENAI_EXTRACT_TIMEOUT_MS = 8_000;
const DEFAULT_OPENAI_SPLIT_TIMEOUT_MS = 12_000;
const DEFAULT_V2_LLM_MAX_CALLS_SYNC = 90;
const DEFAULT_V2_LLM_MAX_CALLS_ASYNC = 150;
const DEFAULT_V2_EXTRACT_FALLBACK_BATCH_BUDGET = 10;
const MAX_V2_EXTRACT_FALLBACK_BATCH_BUDGET = 50;
const DEFAULT_V2_EXTRACT_MAX_CONCURRENT = 2;

export function readPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getOpenAiExtractTimeoutMs(): number {
  return readPositiveIntEnv('OPENAI_EXTRACT_TIMEOUT_MS', DEFAULT_OPENAI_EXTRACT_TIMEOUT_MS);
}

export function getOpenAiExtractModel(): string {
  return process.env.OPENAI_EXTRACT_MODEL ?? 'gpt-5.4-nano';
}

export function getOpenAiSplitTimeoutMs(): number {
  return readPositiveIntEnv('OPENAI_SPLIT_TIMEOUT_MS', DEFAULT_OPENAI_SPLIT_TIMEOUT_MS);
}

export function getMaxExtractFallbackCallsPerBatch(): number {
  return Math.min(
    readPositiveIntEnv('V2_EXTRACT_FALLBACK_MAX_CALLS_PER_BATCH', DEFAULT_V2_EXTRACT_FALLBACK_BATCH_BUDGET),
    MAX_V2_EXTRACT_FALLBACK_BATCH_BUDGET,
  );
}

export function getMaxExtractFallbackCallsForBatch(batchSize: number): number {
  const normalizedBatchSize = Math.max(batchSize, 1);
  return Math.min(normalizedBatchSize, getMaxExtractFallbackCallsPerBatch());
}

export function getMaxExtractConcurrentFallbackCalls(): number {
  return readPositiveIntEnv('V2_EXTRACT_MAX_CONCURRENT_FALLBACK_CALLS', DEFAULT_V2_EXTRACT_MAX_CONCURRENT);
}

export function createLlmBudget(executionMode: 'sync' | 'async'): V2LlmBudget {
  const maxCalls = executionMode === 'async'
    ? readPositiveIntEnv('V2_LLM_MAX_CALLS_ASYNC', DEFAULT_V2_LLM_MAX_CALLS_ASYNC)
    : readPositiveIntEnv('V2_LLM_MAX_CALLS_SYNC', DEFAULT_V2_LLM_MAX_CALLS_SYNC);

  return {
    maxCalls,
    totalCalls: 0,
    splitCalls: 0,
    extractCalls: 0,
    capReached: false,
    extractBatchBudget: undefined,
    extractBatchCapReached: false,
    fallbackConcurrency: getMaxExtractConcurrentFallbackCalls(),
    _extractReservationVersion: 0,
    _extractReservationLock: Promise.resolve(),
  };
}

export function tryConsumeLlmCall(budget: V2LlmBudget | undefined, kind: 'split' | 'extract'): boolean {
  if (!budget) return true;
  if (budget.totalCalls >= budget.maxCalls) {
    budget.capReached = true;
    return false;
  }

  budget.totalCalls += 1;
  if (kind === 'split') budget.splitCalls += 1;
  if (kind === 'extract') budget.extractCalls += 1;
  return true;
}

export async function reserveExtractFallbackCall(
  budget: V2LlmBudget | undefined,
  batchSize: number,
): Promise<boolean> {
  if (!budget) return true;

  if (budget.extractBatchBudget == null) {
    budget.extractBatchBudget = getMaxExtractFallbackCallsForBatch(batchSize);
  }

  const lock = budget._extractReservationLock ?? Promise.resolve();
  let granted = false;
  let nextVersion = budget._extractReservationVersion ?? 0;

  const reservation = lock.then(() => {
    const currentVersion = budget._extractReservationVersion ?? 0;
    const currentBatchBudget = budget.extractBatchBudget ?? getMaxExtractFallbackCallsForBatch(batchSize);
    const extractCapReached = budget.extractCalls >= currentBatchBudget;
    if (extractCapReached) {
      budget.extractBatchCapReached = true;
      return;
    }
    if (budget.totalCalls >= budget.maxCalls) {
      budget.capReached = true;
      return;
    }

    nextVersion = currentVersion + 1;
    budget._extractReservationVersion = nextVersion;
    budget.totalCalls += 1;
    budget.extractCalls += 1;
    granted = true;
  });

  budget._extractReservationLock = reservation.then(() => undefined, () => undefined);
  await reservation;
  return granted;
}

export function recordLlmCapReached(context: Pick<V2PipelineContext, 'fallbacksUsed' | 'partialReasons'> | { fallbacksUsed: string[]; partialReasons: string[] }, stageId: 'split' | 'extract') {
  const marker = `${stageId}:llm_cap_reached`;
  if (!context.fallbacksUsed.includes(marker)) context.fallbacksUsed.push(marker);
  if (!context.partialReasons.includes(marker)) context.partialReasons.push(marker);
}
