import type { V2StageId } from '@shared/schema';

export type StageFallbackMode = 'continue' | 'skip' | 'fail';

export interface V2StageRuntimeConfig {
  enabled: boolean;
  timeoutMs: number;
  fallback: StageFallbackMode;
}

export const V2_STAGE_ORDER: V2StageId[] = [
  'ingest',
  'split',
  'detect',
  'extract',
  'enrich',
  'normalize',
  'validate',
  'truth',
  'dedup',
  'group',
  'score',
  'render',
  'respond',
];

export const DEFAULT_V2_STAGE_CONFIG: Record<V2StageId, V2StageRuntimeConfig> = {
  ingest: { enabled: true, timeoutMs: 3_000, fallback: 'fail' },
  split: { enabled: true, timeoutMs: 3_000, fallback: 'fail' },
  extract: { enabled: true, timeoutMs: 6_000, fallback: 'fail' },
  validate: { enabled: true, timeoutMs: 3_000, fallback: 'continue' },
  truth: { enabled: true, timeoutMs: 2_000, fallback: 'continue' },
  dedup: { enabled: true, timeoutMs: 2_000, fallback: 'continue' },
  enrich: { enabled: true, timeoutMs: 5_000, fallback: 'continue' },
  group: { enabled: false, timeoutMs: 1_000, fallback: 'skip' },
  detect: { enabled: true, timeoutMs: 2_000, fallback: 'continue' },
  score: { enabled: true, timeoutMs: 2_000, fallback: 'continue' },
  normalize: { enabled: true, timeoutMs: 2_000, fallback: 'continue' },
  render: { enabled: true, timeoutMs: 5_000, fallback: 'continue' },
  respond: { enabled: true, timeoutMs: 2_000, fallback: 'fail' },
};

export function buildStageConfig(
  overrides?: Partial<Record<V2StageId, Partial<V2StageRuntimeConfig>>>,
): Record<V2StageId, V2StageRuntimeConfig> {
  const config = { ...DEFAULT_V2_STAGE_CONFIG };
  if (!overrides) return config;

  for (const stageId of Object.keys(overrides) as V2StageId[]) {
    config[stageId] = {
      ...config[stageId],
      ...overrides[stageId],
    };
  }

  return config;
}
