import type { V2LlmBudget, V2PipelineContext } from './contracts.js';

const DEFAULT_OPENAI_EXTRACT_TIMEOUT_MS = 8_000;
const DEFAULT_OPENAI_SPLIT_TIMEOUT_MS = 12_000;
const DEFAULT_V2_LLM_MAX_CALLS_SYNC = 25;
const DEFAULT_V2_LLM_MAX_CALLS_ASYNC = 100;

export function readPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getOpenAiExtractTimeoutMs(): number {
  return readPositiveIntEnv('OPENAI_EXTRACT_TIMEOUT_MS', DEFAULT_OPENAI_EXTRACT_TIMEOUT_MS);
}

export function getOpenAiSplitTimeoutMs(): number {
  return readPositiveIntEnv('OPENAI_SPLIT_TIMEOUT_MS', DEFAULT_OPENAI_SPLIT_TIMEOUT_MS);
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

export function recordLlmCapReached(context: Pick<V2PipelineContext, 'fallbacksUsed' | 'partialReasons'> | { fallbacksUsed: string[]; partialReasons: string[] }, stageId: 'split' | 'extract') {
  const marker = `${stageId}:llm_cap_reached`;
  if (!context.fallbacksUsed.includes(marker)) context.fallbacksUsed.push(marker);
  if (!context.partialReasons.includes(marker)) context.partialReasons.push(marker);
}
