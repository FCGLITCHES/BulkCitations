import {
  captureCarrierFieldSnapshot,
  captureStickyInvariantSnapshot,
  deriveParseOutcome,
  enforceStickyInvariants,
  recordFieldMoves,
  synthesizeCandidateEnvelope,
  type CarrierFieldSnapshot,
} from '../engine/reliability.js';
import {
  createSharedRepairSummaryRecord,
  phase6_8SharedRepair,
  type SharedRepairStats,
} from '../engine/phases/phase6_8SharedRepair.js';
import {
  createNormalizationSummaryRecord,
  phase7Normalize,
  type NormalizeStats,
} from '../engine/phases/phase7Normalize.js';
import type { ReferenceCarrier } from '../engine/types/carrier.js';
import type { PipelineContext } from '../engine/types/pipeline.js';

export interface IntegratedFastLaneStageStats {
  sharedRepair: SharedRepairStats;
  normalization: NormalizeStats;
}

export function shouldInlineFastLanePostProcessing(ctx: PipelineContext): boolean {
  return ctx.executionPolicy.parseProfile === 'core_parse_fast';
}

export function pushIntegratedFastLaneStageSummaries(
  ctx: PipelineContext,
  stats: IntegratedFastLaneStageStats,
): void {
  ctx.stageLog.push(createSharedRepairSummaryRecord(stats.sharedRepair));
  ctx.stageLog.push(createNormalizationSummaryRecord(stats.normalization));
}

export function mergeSharedRepairStats(
  values: Array<SharedRepairStats | undefined>,
): SharedRepairStats {
  return values.reduce<SharedRepairStats>(
    (aggregate, current) => ({
      proposedMoveCount: aggregate.proposedMoveCount + (current?.proposedMoveCount ?? 0),
      durationMs: aggregate.durationMs + (current?.durationMs ?? 0),
    }),
    createEmptySharedRepairStats(),
  );
}

export function mergeNormalizationStats(
  values: Array<NormalizeStats | undefined>,
): NormalizeStats {
  return values.reduce<NormalizeStats>(
    (aggregate, current) => ({
      carrierWarnings: aggregate.carrierWarnings + (current?.carrierWarnings ?? 0),
      durationMs: aggregate.durationMs + (current?.durationMs ?? 0),
    }),
    createEmptyNormalizationStats(),
  );
}

export function initializeReliabilityState(carriers: ReferenceCarrier[]): void {
  for (const carrier of carriers) {
    carrier.fieldMoveLedger ??= [];
    carrier.candidateEnvelope ??= synthesizeCandidateEnvelope(carrier);
    carrier.stickyInvariantSnapshot ??= captureStickyInvariantSnapshot(carrier.fields);
    carrier.parseOutcome = deriveParseOutcome(carrier);
  }
}

export async function runInlineFastLanePostProcessing(
  carriers: ReferenceCarrier[],
  ctx: PipelineContext,
): Promise<{ carriers: ReferenceCarrier[] } & IntegratedFastLaneStageStats> {
  initializeReliabilityState(carriers);

  let sharedRepair = createEmptySharedRepairStats();
  carriers = await runObservedMutationStage(
    carriers,
    ctx,
    'shared_repair',
    async () => {
      const result = await phase6_8SharedRepair.apply(carriers, ctx, { suppressContextStageLog: true });
      sharedRepair = result.stats;
      return result.carriers;
    },
  );

  let normalization = createEmptyNormalizationStats();
  carriers = await runObservedMutationStage(
    carriers,
    ctx,
    'normalization',
    async () => {
      const result = await phase7Normalize.apply(carriers, ctx, { suppressContextStageLog: true });
      normalization = result.stats;
      return result.carriers;
    },
  );

  return {
    carriers,
    sharedRepair,
    normalization,
  };
}

function createEmptySharedRepairStats(): SharedRepairStats {
  return {
    proposedMoveCount: 0,
    durationMs: 0,
  };
}

function createEmptyNormalizationStats(): NormalizeStats {
  return {
    carrierWarnings: 0,
    durationMs: 0,
  };
}

export async function runObservedMutationStage(
  carriers: ReferenceCarrier[],
  ctx: PipelineContext,
  phaseId: 'llm_fallback' | 'shared_repair' | 'normalization' | 'enrichment' | 'feedback_loop',
  runStage: () => Promise<ReferenceCarrier[]>,
): Promise<ReferenceCarrier[]> {
  const snapshots = new Map<string, CarrierFieldSnapshot>(
    carriers.map((carrier) => [carrier.id, captureCarrierFieldSnapshot(carrier.fields)]),
  );
  const next = await runStage();

  for (const carrier of next) {
    const before = snapshots.get(carrier.id);
    if (!before) {
      continue;
    }
    recordFieldMoves(carrier, before, phaseId, `${phaseId}_field_mutation`);
    const restored = enforceStickyInvariants(carrier, before, phaseId);
    if (restored > 0) {
      carrier.stageLog.push({
        stageId: `${phaseId}_sticky_invariant_guard`,
        contractVersion: 1,
        phaseId,
        status: 'warning',
        durationMs: 0,
        message: `Sticky invariant guard restored ${restored} field(s) after ${phaseId}.`,
        details: {
          restoredFields: restored,
        },
      });
    }
    carrier.candidateEnvelope ??= synthesizeCandidateEnvelope(carrier);
    carrier.parseOutcome = deriveParseOutcome(carrier);
  }

  return next;
}
