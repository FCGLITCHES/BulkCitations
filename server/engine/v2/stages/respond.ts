import type { V2ConversionResponse } from '@shared/schema';
import { buildSignedExportUrl } from '../exportUrls.js';
import { average, createStageDiagnostic, nowIso } from '../utils.js';
import type { V2Stage } from '../contracts.js';

export function createRespondStage(): V2Stage {
  return {
    id: 'respond',
    async run(context) {
      const startedAt = Date.now();
      const inputCount = context.citations.filter((citation) => citation.status !== 'merged').length;
      const uniqueCount = context.citations.filter((citation) => citation.status !== 'duplicate').length;
      const duplicateCount = Math.max(0, inputCount - uniqueCount);
      const exportableCitations = context.citations.filter((citation) => citation.status !== 'duplicate');
      const enrichedCount = exportableCitations.filter((citation) => citation.enrichment?.status === 'fetched').length;
      const avgConfidence = average(exportableCitations.map((citation) => citation.quality?.overall ?? 0));
      const retractedCount = exportableCitations.filter((citation) => citation.enrichment?.retractedFlag).length;
      const llmFallbackCount = context.citations.filter((citation) => citation.extraction?.fallbackUsed || citation.split?.fallbackUsed).length;
      const extractorPathsUsed = [...new Set(
        context.citations
          .map((citation) => citation.extraction?.extractorPath)
          .filter((value): value is NonNullable<typeof value> => Boolean(value)),
      )];

      const response: V2ConversionResponse = {
        job_id: context.jobId,
        processed_at: nowIso(),
        stats: {
          input_count: inputCount,
          unique_count: uniqueCount,
          duplicate_count: duplicateCount,
          enriched_count: enrichedCount,
          avg_confidence: Number(avgConfidence.toFixed(2)),
          retracted_count: retractedCount,
          llm_fallback_count: llmFallbackCount,
        },
        citations: context.citations,
        groups: context.groups,
        duplicates: context.duplicates,
        exports: {
          txt: buildSignedExportUrl(context.jobId, 'txt'),
          bib: buildSignedExportUrl(context.jobId, 'bib'),
          ris: buildSignedExportUrl(context.jobId, 'ris'),
          csv: buildSignedExportUrl(context.jobId, 'csv'),
          docx: buildSignedExportUrl(context.jobId, 'docx'),
        },
        processingPath: {
          stagesRun: context.stagesRun,
          fallbacksUsed: context.fallbacksUsed,
          durationMs: Date.now() - context.startedAtMs,
          partialResult: context.partialResult,
          executionMode: context.executionMode,
          extractorPathsUsed,
          partialReasons: context.partialReasons,
        },
        debug: context.debugEnabled
          ? {
            enabled: true,
            jobStages: context.jobDebug,
            citations: context.citations.map((citation) => ({
              citationId: citation.id,
              raw: citation.raw,
              status: citation.status,
              stages: citation.stageDebug ?? {},
            })),
          }
          : undefined,
        pipeline_log: context.pipelineLog,
        inputProfile: context.inputProfile,
      };

      return {
        ...context,
        response,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'respond',
            'success',
            'Built the v2 response envelope.',
            { citationCount: context.citations.length, duplicateCount },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
