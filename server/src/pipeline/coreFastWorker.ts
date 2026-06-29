import { parentPort, workerData } from 'node:worker_threads';
import type { CitationStyle } from '../engine/types/citation.js';
import type { ReferenceCarrier } from '../engine/types/carrier.js';
import type { RawBlock } from '../engine/types/ingestion.js';
import type {
  PipelineOptions,
  PipelineContext,
  PipelineRuntimeTuning,
  ProviderUsage,
  StageRunRecord,
  TenantContext,
} from '../engine/types/pipeline.js';
import { createPipelineContext } from './context.js';
import { runCorePipelineBatch } from './coreBatch.js';
import { createPipelineDependencies } from './dependencies.js';
import type { IntegratedFastLaneStageStats } from './fastLane.js';
import { resolveSingleWorkerRuntimeTuning } from './runtimeProfiles.js';

export interface CoreFastWorkerAssignment {
  batchIndex: number;
  blocks: RawBlock[];
}

export interface CoreFastWorkerRequest {
  assignments: CoreFastWorkerAssignment[];
  outputStyle: CitationStyle;
  pipelineOptions: PipelineOptions;
  runtimeTuning: PipelineRuntimeTuning;
  tenantContext: TenantContext;
  detectionMeta?: PipelineContext['detectionMeta'];
}

export interface CoreFastWorkerAssignmentResult {
  batchIndex: number;
  carriers: ReferenceCarrier[];
  stageLog: StageRunRecord[];
  providerUsage: ProviderUsage;
  integratedStageStats: IntegratedFastLaneStageStats | null;
}

export interface CoreFastWorkerResult {
  assignments: CoreFastWorkerAssignmentResult[];
}

interface PersistentCoreFastWorkerData {
  mode: 'persistent';
}

interface PersistentCoreFastWorkerMessage {
  requestId: number;
  request: CoreFastWorkerRequest;
}

function isPersistentCoreFastWorkerData(value: unknown): value is PersistentCoreFastWorkerData {
  return Boolean(value && typeof value === 'object' && (value as PersistentCoreFastWorkerData).mode === 'persistent');
}

function serializeError(error: unknown): { message: string; stack?: string } {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return {
    message,
    ...(stack ? { stack } : {}),
  };
}

async function runAssignments(
  request: CoreFastWorkerRequest,
  deps: ReturnType<typeof createPipelineDependencies>,
): Promise<CoreFastWorkerResult> {
  const assignments: CoreFastWorkerAssignmentResult[] = [];

  for (const assignment of request.assignments) {
    const runtimeTuning = resolveSingleWorkerRuntimeTuning(request.runtimeTuning);
    const ctx = createPipelineContext({
      outputStyle: request.outputStyle,
      options: request.pipelineOptions,
      ...(runtimeTuning ? { runtimeTuning } : {}),
      tenantContext: request.tenantContext,
      ...(request.detectionMeta ? { detectionMeta: request.detectionMeta } : {}),
    });
    const result = await runCorePipelineBatch(assignment.blocks, ctx, deps);
    assignments.push({
      batchIndex: assignment.batchIndex,
      carriers: result.carriers,
      stageLog: ctx.stageLog,
      providerUsage: ctx.providerUsage,
      integratedStageStats: result.integratedStageStats,
    });
  }

  return { assignments };
}

async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error('Core fast worker must run under worker_threads.');
  }

  const deps = createPipelineDependencies();

  if (isPersistentCoreFastWorkerData(workerData)) {
    parentPort.on('message', (message: PersistentCoreFastWorkerMessage) => {
      void runAssignments(message.request, deps)
        .then((payload) => {
          parentPort?.postMessage({
            type: 'result',
            requestId: message.requestId,
            payload,
          });
        })
        .catch((error: unknown) => {
          parentPort?.postMessage({
            type: 'error',
            requestId: message.requestId,
            error: serializeError(error),
          });
        });
    });
    parentPort.postMessage({ type: 'ready' });
    return;
  }

  try {
    const payload = await runAssignments(workerData as CoreFastWorkerRequest, deps);
    parentPort.postMessage({
      type: 'result',
      payload,
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: serializeError(error),
    });
    process.exitCode = 1;
  }
}

void main();
