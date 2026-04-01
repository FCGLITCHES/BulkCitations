import type {
  StageDiagnostic,
  V2ConversionRequest,
  V2StageTiming,
  V3ConversionResponse,
  V3StageId,
} from '@shared/schema';
import type { V2AdapterBundle, V2PipelineContext } from '../v2/contracts.js';
import type { V3RuntimeFieldLock } from './locks.js';

export interface V3PipelineContext {
  request: V2ConversionRequest;
  executionMode: 'sync' | 'async';
  debugEnabled: boolean;
  receivedAt: string;
  startedAtMs: number;
  documentStyleHint: string | null;
  adapters: V2AdapterBundle;
  v2: V2PipelineContext;
  stagesRun: V3StageId[];
  stageTimings: V2StageTiming[];
  pipelineLog: StageDiagnostic[];
  fieldLocksByCitationId: Record<string, Record<string, V3RuntimeFieldLock>>;
  response?: V3ConversionResponse;
}

export interface V3Stage {
  readonly id: V3StageId;
  run(context: V3PipelineContext): Promise<V3PipelineContext>;
}
