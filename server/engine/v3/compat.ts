import type {
  V2ConversionRequest,
  V2ConversionResponse,
  V3ConversionResponse,
} from '@shared/schema';
import type { LegacyCompatRecord } from '../v2/compat.js';
import { mapV2ResponseToLegacyRecords } from '../v2/compat.js';

export function mapV3ResponseToLegacyRecords(
  response: V3ConversionResponse,
  request: Pick<V2ConversionRequest, 'inputStyle' | 'outputStyle'>,
): Array<LegacyCompatRecord & { sourceId: string }> {
  return mapV2ResponseToLegacyRecords(response as unknown as V2ConversionResponse, request).map((record) => {
    const uiData = {
      ...record.uiData,
      reportEngineSnapshot: {
        ...record.uiData.reportEngineSnapshot,
        engineVersion: 'v3' as const,
        processingPath: {
          ...record.uiData.reportEngineSnapshot?.processingPath,
          stagesRun: response.processingPath.stagesRun,
          fallbacksUsed: response.processingPath.fallbacksUsed,
          partialResult: response.processingPath.partialResult,
          partialReasons: response.processingPath.partialReasons,
        },
      },
      analyticsPayload: {
        ...record.uiData.analyticsPayload,
        engineVersion: 'v3' as const,
        warningCount: record.uiData.analyticsPayload?.warningCount ?? record.uiData.warnings?.length ?? 0,
        styleDetectionFailed: record.uiData.analyticsPayload?.styleDetectionFailed ?? Boolean(record.uiData.styleDetectionFailed),
        partialResult: record.uiData.analyticsPayload?.partialResult ?? Boolean(record.uiData.reportEngineSnapshot?.processingPath?.partialResult),
        truthApplied: record.uiData.analyticsPayload?.truthApplied ?? Boolean(record.uiData.truthProvenance?.truthApplied),
      },
    };

    return {
      ...record,
      uiData,
    };
  });
}
