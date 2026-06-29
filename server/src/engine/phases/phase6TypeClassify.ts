import type { MLClient } from '../../ml/client.js';
import { ErrorCode } from '../errors/index.js';
import type { ReferenceCarrier } from '../types/carrier.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import { classifyTypeHeuristically, fallbackTypeConfidence } from '../utils/type-classification.js';
import { isStageBudgetExceeded, runWithRemainingStageBudget } from '../../pipeline/performance.js';

const CONTRACT_VERSION = 1;
const STAGE_ID = 'phase6_type_classification';

export class Phase6TypeClassify implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'type_classification' as const;
  readonly contractVersion = CONTRACT_VERSION;

  constructor(private readonly mlClient?: MLClient) {}

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();
    let usedFallback = false;
    let usedStructuralRouting = false;
    let budgetExceeded = false;
    const allowMlTypeClassification = ctx.executionPolicy.typeClassificationMl !== 'off';

    for (const carrier of carriers) {
      const structuralRoute = carrier.structuralRouting;
      const shouldAcceptStructuralRoute = shouldPromoteStructuralRoute(structuralRoute);

      if (shouldAcceptStructuralRoute && structuralRoute) {
        usedStructuralRouting = true;
        carrier.type = {
          type: structuralRoute.type,
          confidence: structuralRoute.confidence,
          isUnknown: false,
        };

        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'success',
            durationMs: 0,
            message: `Type classification accepted structural routing for ${structuralRoute.type}.`,
            details: {
              source: structuralRoute.source,
              confidence: structuralRoute.confidence,
              reasonCodes: structuralRoute.reasonCodes,
            },
          }),
        );
        continue;
      }

      const deterministicType = classifyTypeHeuristically(carrier);
      const deterministicConfidence = fallbackTypeConfidence(deterministicType);
      const shouldAttemptMl = shouldAttemptMlTypeResolution(
        carrier,
        deterministicType,
        deterministicConfidence,
      );
      if (!allowMlTypeClassification || !shouldAttemptMl) {
        carrier.type = {
          type: deterministicType,
          confidence: deterministicConfidence,
          isUnknown: deterministicConfidence < 0.6 || deterministicType === 'unknown',
        };
        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'success',
            durationMs: 0,
            message: 'Type classification resolved deterministically without ML conflict.',
          }),
        );
        continue;
      }

      let carrierUsedFallback = false;
      let carrierBudgetExceeded = false;
      try {
        if (!allowMlTypeClassification) {
          throw new Error('Execution policy disabled ML type classification.');
        }
        if (!this.mlClient) throw new Error('No ML client configured.');
        if (isStageBudgetExceeded(ctx, this.phaseId, startedAt)) {
          budgetExceeded = true;
          carrierBudgetExceeded = true;
          throw new Error('Phase budget exceeded.');
        }
        const budgeted = await runWithRemainingStageBudget(ctx, this.phaseId, startedAt, () =>
          this.mlClient!.classifyType([carrier.raw]),
        );
        if (budgeted.timedOut) {
          budgetExceeded = true;
          carrierBudgetExceeded = true;
          throw new Error('Phase budget exceeded.');
        }
        const [prediction] = budgeted.value;
        const safeType = prediction?.type ?? classifyTypeHeuristically(carrier);
        const confidence = prediction?.confidence ?? 0.62;
        carrier.type = {
          type: safeType,
          confidence,
          isUnknown: confidence < 0.6 || safeType === 'unknown',
        };
      } catch {
        usedFallback = true;
        carrierUsedFallback = true;
        const type = deterministicType;
        const confidence = deterministicConfidence;
        carrier.type = {
          type,
          confidence,
          isUnknown: confidence < 0.6 || type === 'unknown',
        };
      }

      carrier.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: carrierUsedFallback ? 'warning' : 'success',
          durationMs: 0,
          ...(carrierUsedFallback ? { code: ErrorCode.TYPE_ML_UNAVAILABLE } : {}),
          message: carrierUsedFallback
            ? carrierBudgetExceeded
              ? 'Type classification used rule-based fallback after the phase budget was exceeded.'
              : 'Type classification used rule-based fallback.'
            : 'Type classification completed.',
        }),
      );
    }

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: usedFallback ? 'warning' : 'success',
        durationMs: Date.now() - startedAt,
        ...(usedFallback ? { code: ErrorCode.TYPE_ML_UNAVAILABLE } : {}),
        message: usedFallback
          ? budgetExceeded
            ? 'Phase 6 exceeded its latency budget and used rule-based type classification.'
            : 'Phase 6 used rule-based type classification.'
          : usedStructuralRouting
            ? 'Phase 6 accepted structural routing for high-confidence citations.'
          : 'Phase 6 type classification completed.',
      }),
    );

    return carriers;
  }
}

export const phase6TypeClassify = new Phase6TypeClassify();

function shouldAttemptMlTypeResolution(
  carrier: ReferenceCarrier,
  deterministicType: ReferenceCarrier['type']['type'],
  deterministicConfidence: number,
): boolean {
  if (deterministicType === 'unknown') {
    return true;
  }

  if (deterministicConfidence < 0.74) {
    return true;
  }

  const routedType = carrier.structuralRouting?.type;
  if (routedType && routedType !== 'unknown' && routedType !== deterministicType) {
    return true;
  }

  const family = carrier.style.family;
  if (family === 'web_accessed') {
    return !['webpage', 'report', 'dataset', 'preprint'].includes(deterministicType);
  }

  if (family === 'numeric' && deterministicType === 'webpage') {
    return !/\b(?:doi\b|10\.\d{4,9}\/|rfc-editor\.org|patent)\b/iu.test(carrier.raw);
  }

  if (family === 'author_date' && deterministicType === 'patent') {
    return true;
  }

  return false;
}

function shouldPromoteStructuralRoute(
  route: ReferenceCarrier['structuralRouting'],
): route is NonNullable<ReferenceCarrier['structuralRouting']> {
  if (!route || route.type === 'unknown') {
    return false;
  }

  if (route.source === 'approved_truth') {
    return true;
  }
  if (route.source === 'authority_pack') {
    switch (route.type) {
      case 'conference-paper':
      case 'book-chapter':
      case 'report':
        return route.confidence >= 0.92;
      default:
        return route.confidence >= 0.95;
    }
  }

  switch (route.type) {
    case 'article-journal':
      return route.confidence >= 0.95;
    case 'conference-paper':
      return route.confidence >= 0.93;
    case 'book-chapter':
      return route.confidence >= 0.93;
    case 'report':
      return route.confidence >= 0.9;
    case 'preprint':
      return route.confidence >= 0.95;
    case 'thesis':
      return route.confidence >= 0.97;
    case 'patent':
      return route.confidence >= 0.98;
    default:
      return false;
  }
}

function stageRecord(
  record: Omit<StageRunRecord, 'stageId' | 'contractVersion'>,
): StageRunRecord {
  return {
    stageId: STAGE_ID,
    contractVersion: CONTRACT_VERSION,
    ...record,
  };
}
