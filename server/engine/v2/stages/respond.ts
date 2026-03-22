import type { V2ConversionResponse } from '@shared/schema';
import { buildSignedExportUrl } from '../exportUrls.js';
import { average, createStageDiagnostic, nowIso } from '../utils.js';
import type { V2Stage } from '../contracts.js';

export function createRespondStage(): V2Stage {
  return {
    id: 'respond',
    async run(context) {
      const startedAt = Date.now();
      let inputCount = 0;
      let uniqueCount = 0;
      let enrichedCount = 0;
      let confidenceTotal = 0;
      let exportableCount = 0;
      let retractedCount = 0;
      let llmFallbackCount = 0;
      const extractorPathSet = new Set<string>();

      for (const citation of context.citations) {
        if (citation.status !== 'merged') {
          inputCount += 1;
        }
        if (citation.status !== 'duplicate') {
          uniqueCount += 1;
          exportableCount += 1;
          confidenceTotal += citation.quality?.overall ?? 0;
          if (citation.enrichment?.status === 'fetched') enrichedCount += 1;
          if (citation.enrichment?.retractedFlag) retractedCount += 1;
        }
        if (citation.extraction?.fallbackUsed || citation.split?.fallbackUsed) {
          llmFallbackCount += 1;
        }
        if (citation.extraction?.extractorPath) {
          extractorPathSet.add(citation.extraction.extractorPath);
        }
      }

      const duplicateCount = Math.max(0, inputCount - uniqueCount);
      const avgConfidence = exportableCount > 0 ? confidenceTotal / exportableCount : average([]);
      const extractorPathsUsed = [...extractorPathSet];
      const slowestStages = [...context.stageTimings].sort((left, right) => right.durationMs - left.durationMs);

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
          stageTimings: context.stageTimings,
          slowestStages,
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
