import type { CanonicalCitation } from '@shared/schema';
import type { ExtractorAdapter, V2Stage } from '../contracts.js';
import { getMaxExtractConcurrentFallbackCalls, getOpenAiExtractTimeoutMs } from '../llmConfig.js';
import { prepareWorkingChunk } from '../rawPdfCopy.js';
import {
  getStageRuntimeTimeoutMs,
  runStageTasksWithIsolation,
} from '../stageIsolation.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  canonicalAuthorToDisplay,
  createFieldValue,
  createStageDiagnostic,
  isVerboseDebugEnabled,
  logStructuredDebug,
  parseAuthorsForStyle,
} from '../utils.js';

export function createExtractStage(extractor: ExtractorAdapter): V2Stage {
  return {
    id: 'extract',
    async run(context) {
      const startedAt = Date.now();
      const verboseDebug = isVerboseDebugEnabled();
      const fallbacksUsed = [...context.fallbacksUsed];
      const grobidEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_GROBID_EXTRACTOR ?? '');
      const llmEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_LLM_EXTRACTOR ?? '1') && Boolean(process.env.OPENAI_API_KEY);
      const defaultExtractConcurrency = grobidEnabled
        ? 1
        : llmEnabled
          ? getMaxExtractConcurrentFallbackCalls()
          : 12;
      const configuredExtractConcurrency = Number.parseInt(
        process.env.V2_EXTRACT_CONCURRENCY ?? String(defaultExtractConcurrency),
        10,
      );
      const effectiveExtractConcurrency = Number.isFinite(configuredExtractConcurrency) && configuredExtractConcurrency > 0
        ? configuredExtractConcurrency
        : defaultExtractConcurrency;
      const extractTimeoutMs = getStageRuntimeTimeoutMs('extract', context.stageConfig);
      const itemTimeoutMs = Math.max(
        extractTimeoutMs,
        grobidEnabled ? 4_000 : extractTimeoutMs,
        llmEnabled ? getOpenAiExtractTimeoutMs() + 1_000 : extractTimeoutMs,
      );
      const workingChunkByCitationId = { ...context.workingChunkByCitationId };
      const runCitation = async (citation: CanonicalCitation, citationIndex: number) => {
        const effectiveStyle = citation.detectedStyle.value ?? context.request.inputStyle;
        const splitArtifact = context.splitArtifactsByCitationId[citation.id];
        const preparedWorkingChunk = splitArtifact
          ? prepareWorkingChunk(splitArtifact)
          : {
            includedLineIndices: [],
            joinedText: citation.raw,
            fieldHints: [],
            appliedRepairs: [],
            repairMisses: [],
            residualArtifacts: [],
            citationRepairConfidence: 'high' as const,
          };
        workingChunkByCitationId[citation.id] = preparedWorkingChunk;

        const result = await extractor.extract(preparedWorkingChunk.joinedText, effectiveStyle ?? context.request.inputStyle, {
          inputProfile: context.inputProfile,
          detectionConfidence: citation.detectedStyle.confidence,
          batchSize: context.inputProfile?.estimatedCount ?? context.citations.length,
          executionMode: context.executionMode,
          splitArtifact,
          llmBudget: context.llmBudget,
          debugEnabled: context.debugEnabled,
        });
        const authorParseResult = result.canonicalAuthors
          ? {
            authors: result.canonicalAuthors,
            parserMode: result.authorParserMode ?? 'none',
            warningFlags: result.authorWarningFlags ?? [],
            rejectedCandidates: result.rejectedCandidates ?? [],
          }
          : parseAuthorsForStyle(result.parsed.authors ?? [], result.detectedStyle ?? effectiveStyle);
        const yearValue = result.parsed.year ? Number.parseInt(result.parsed.year, 10) : null;
        const parsedEditors = (result.parsed.editors ?? []).filter((editor) => Boolean(editor?.last || editor?.literal));
        const fallbackEditor = parsedEditors.length > 0
          ? canonicalAuthorToDisplay(parsedEditors[0]!)
          : (result.parsed.editor ?? null);
        if (result.fallbackUsed) {
          fallbacksUsed.push(`extract:${result.method}`);
        }
        if (result.llmCapReached) {
          fallbacksUsed.push('extract:llm_cap_reached');
        }

        const mergedDetectedStyleConfidence = result.detectedStyle
          ? (
            citation.detectedStyle.value != null
              ? Math.min(
                citation.detectedStyle.confidence,
                result.detectedStyleConfidence ?? citation.detectedStyle.confidence,
              )
              : (result.detectedStyleConfidence ?? citation.detectedStyle.confidence)
          )
          : citation.detectedStyle.confidence;

        let nextCitation: CanonicalCitation = {
          ...citation,
          referenceType: result.referenceType,
          detectedStyle: result.detectedStyle
            ? createFieldValue(
              result.detectedStyle,
              'extracted',
              mergedDetectedStyleConfidence,
              'extract',
            )
            : citation.detectedStyle,
          authors: createFieldValue(authorParseResult.authors, 'extracted', result.fieldConfidence.authors ?? 0, 'extract'),
          title: createFieldValue(result.parsed.title ?? null, 'extracted', result.fieldConfidence.title ?? 0, 'extract'),
          year: createFieldValue(Number.isFinite(yearValue) ? yearValue : null, 'extracted', result.fieldConfidence.year ?? 0, 'extract'),
          journal: createFieldValue(result.parsed.journal ?? null, 'extracted', result.fieldConfidence.journal ?? 0, 'extract'),
          volume: createFieldValue(result.parsed.volume ?? null, 'extracted', result.fieldConfidence.volume ?? 0, 'extract'),
          issue: createFieldValue(result.parsed.issue ?? null, 'extracted', result.fieldConfidence.issue ?? 0, 'extract'),
          pages: createFieldValue(result.parsed.pages ?? result.parsed['article-number'] ?? null, 'extracted', result.fieldConfidence.pages ?? 0, 'extract'),
          doi: createFieldValue(result.parsed.doi ?? null, 'extracted', result.fieldConfidence.doi ?? 0, 'extract'),
          publisher: createFieldValue(result.parsed.publisher ?? null, 'extracted', result.fieldConfidence.publisher ?? 0, 'extract'),
          placeOfPublication: createFieldValue(result.parsed.placeOfPublication ?? null, 'extracted', result.fieldConfidence.publisher ?? 0, 'extract'),
          url: createFieldValue(result.parsed.url ?? null, 'extracted', result.fieldConfidence.url ?? 0, 'extract'),
          conferenceTitle: createFieldValue(result.parsed.conferenceTitle ?? null, 'extracted', result.fieldConfidence.journal ?? 0, 'extract'),
          bookTitle: createFieldValue(result.parsed.bookTitle ?? null, 'extracted', result.fieldConfidence.journal ?? 0, 'extract'),
          institution: createFieldValue(result.parsed.institution ?? null, 'extracted', result.fieldConfidence.publisher ?? 0, 'extract'),
          edition: createFieldValue(result.parsed.edition ?? null, 'extracted', result.fieldConfidence.publisher ?? 0, 'extract'),
          editors: createFieldValue(parsedEditors, 'extracted', result.fieldConfidence.authors ?? 0, 'extract'),
          editor: createFieldValue(fallbackEditor, 'extracted', result.fieldConfidence.authors ?? 0, 'extract'),
          thesisType: createFieldValue(result.parsed.thesisType ?? null, 'extracted', result.fieldConfidence.publisher ?? 0, 'extract'),
          repository: createFieldValue(result.parsed.repository ?? null, 'extracted', result.fieldConfidence.publisher ?? 0, 'extract'),
          institutionMapping: result.referenceType === 'thesis'
            ? result.parsed.institution
              ? {
                  mapped: true,
                  source: 'parsed_institution',
                  originalValue: result.parsed.institution,
                }
              : result.parsed.publisher
                ? {
                    mapped: true,
                    source: 'parsed_publisher',
                    originalValue: result.parsed.publisher,
                  }
                : {
                    mapped: false,
                    source: 'none',
                    originalValue: null,
                  }
            : citation.institutionMapping,
          extraction: {
            method: result.method,
            fallbackUsed: result.fallbackUsed,
            extractorPath: result.extractorPath,
            selectedBranch: result.selectedBranch,
            selectionReason: result.selectionReason,
            selectorMode: result.selectorMode,
            selectionMode: result.selectionMode,
            winnerAdapterId: result.winnerAdapterId,
            winnerCandidateId: result.winnerCandidateId,
            typeResolutionReason: result.typeResolutionReason,
            authorParserMode: result.authorParserMode ?? authorParseResult.parserMode,
            llmFallbackAttempted: result.llmFallbackAttempted,
            llmFallbackAccepted: result.llmFallbackAccepted,
            llmFallbackReason: result.llmFallbackReason,
            llmFallbackSkippedByBudget: result.llmFallbackSkippedByBudget,
            llmFallbackFieldsImproved: result.llmFallbackFieldsImproved,
            llmFallbackStrictPassDelta: result.llmFallbackStrictPassDelta,
            llmFallbackFirstAuthorConfidence: result.llmFallbackFirstAuthorConfidence,
            rejectedCandidates: [
              ...(result.rejectedCandidates ?? []),
              ...authorParseResult.rejectedCandidates,
            ],
          },
        };
        nextCitation = attachCitationDebug(nextCitation, 'extract', {
          detectedStyle: result.detectedStyle,
          detectedStyleConfidence: result.detectedStyleConfidence,
          selectedBranch: result.selectedBranch,
          selectionReason: result.selectionReason,
          selectorMode: result.selectorMode,
          selectionMode: result.selectionMode,
          winnerAdapterId: result.winnerAdapterId,
          winnerCandidateId: result.winnerCandidateId,
          typeResolutionReason: result.typeResolutionReason,
          extractorPath: result.extractorPath,
          authorParserMode: result.authorParserMode ?? authorParseResult.parserMode,
          llmFallbackAttempted: result.llmFallbackAttempted,
          llmFallbackAccepted: result.llmFallbackAccepted,
          llmFallbackReason: result.llmFallbackReason,
          llmFallbackSkippedByBudget: result.llmFallbackSkippedByBudget,
          llmFallbackFieldsImproved: result.llmFallbackFieldsImproved,
          llmFallbackStrictPassDelta: result.llmFallbackStrictPassDelta,
          llmFallbackFirstAuthorConfidence: result.llmFallbackFirstAuthorConfidence,
          llmRawExtraction: result.debug?.llm_raw_extraction,
          llmBeforeParsed: result.debug?.llm_before_parsed,
          llmCandidateAfterMerge: result.debug?.llm_candidate_after_merge,
          llmFailureMessage: result.debug?.llm_failure_message,
          llmTrigger: result.debug?.llm_trigger,
          llmInferenceNote: result.parsed.inferenceNote,
          preparedWorkingChunk: {
            joinedText: preparedWorkingChunk.joinedText,
            fieldHints: preparedWorkingChunk.fieldHints,
            appliedRepairs: preparedWorkingChunk.appliedRepairs,
            repairMisses: preparedWorkingChunk.repairMisses,
            residualArtifacts: preparedWorkingChunk.residualArtifacts,
            citationRepairConfidence: preparedWorkingChunk.citationRepairConfidence,
          },
          splitContaminationFlags: splitArtifact?.contaminationFlags ?? [],
          splitContaminationPenalty: result.debug?.split_contamination_penalty ?? 0,
          warningFlags: authorParseResult.warningFlags,
          rejectedCandidates: [...(result.rejectedCandidates ?? []), ...authorParseResult.rejectedCandidates],
          selectedParsed: result.parsed,
          ...(verboseDebug ? (result.debug ?? {}) : {}),
        }, context.debugEnabled);
        logStructuredDebug(context, 'extract', citationIndex, nextCitation, {
          detectedStyle: result.detectedStyle,
          detectedStyleConfidence: result.detectedStyleConfidence,
          selectedBranch: result.selectedBranch,
          selectionReason: result.selectionReason,
          selectorMode: result.selectorMode,
          selectionMode: result.selectionMode,
          winnerAdapterId: result.winnerAdapterId,
          winnerCandidateId: result.winnerCandidateId,
          typeResolutionReason: result.typeResolutionReason,
          extractorPath: result.extractorPath,
          authorParserMode: result.authorParserMode ?? authorParseResult.parserMode,
          llmFallbackAttempted: result.llmFallbackAttempted,
          llmFallbackAccepted: result.llmFallbackAccepted,
          llmFallbackReason: result.llmFallbackReason,
          llmFallbackSkippedByBudget: result.llmFallbackSkippedByBudget,
          llmFallbackFieldsImproved: result.llmFallbackFieldsImproved,
          llmFallbackStrictPassDelta: result.llmFallbackStrictPassDelta,
          llmFallbackFirstAuthorConfidence: result.llmFallbackFirstAuthorConfidence,
          splitContaminationFlags: splitArtifact?.contaminationFlags ?? [],
          splitContaminationPenalty: result.debug?.split_contamination_penalty ?? 0,
          warningFlags: authorParseResult.warningFlags,
          rejectedCandidates: [...(result.rejectedCandidates ?? []), ...authorParseResult.rejectedCandidates],
        });

        return addCitationStageLog(
          nextCitation,
          createStageDiagnostic(
            'extract',
            result.warnings.length > 0 ? 'warning' : 'success',
            result.warnings.length > 0 ? `Extracted citation with ${result.warnings.length} parser warning(s).` : 'Extracted canonical fields from raw citation.',
            {
              method: result.method,
              fallbackUsed: result.fallbackUsed,
              extractorPath: result.extractorPath,
                detectedStyle: result.detectedStyle,
                detectedStyleConfidence: result.detectedStyleConfidence,
                warnings: [
                  ...result.warnings,
                  ...authorParseResult.warningFlags,
                ],
                selectedBranch: result.selectedBranch,
                selectionReason: result.selectionReason,
                selectorMode: result.selectorMode,
                selectionMode: result.selectionMode,
                winnerAdapterId: result.winnerAdapterId,
                winnerCandidateId: result.winnerCandidateId,
                typeResolutionReason: result.typeResolutionReason,
                authorParserMode: result.authorParserMode ?? authorParseResult.parserMode,
                llmFallbackAttempted: result.llmFallbackAttempted,
                llmFallbackAccepted: result.llmFallbackAccepted,
                llmFallbackReason: result.llmFallbackReason,
                llmFallbackSkippedByBudget: result.llmFallbackSkippedByBudget,
                llmFallbackFieldsImproved: result.llmFallbackFieldsImproved,
                llmFallbackStrictPassDelta: result.llmFallbackStrictPassDelta,
                llmFallbackFirstAuthorConfidence: result.llmFallbackFirstAuthorConfidence,
                rejectedCandidates: [...(result.rejectedCandidates ?? []), ...authorParseResult.rejectedCandidates],
              },
            ),
          );
      };
      const recoverCitation = ({ item: citation, message, timedOut }: {
        item: CanonicalCitation;
        index: number;
        message: string;
        timedOut: boolean;
      }) => {
        const nextCitation = attachCitationDebug({
          ...citation,
          extraction: {
            method: 'deterministic',
            fallbackUsed: true,
            extractorPath: 'deterministic',
            selectionReason: timedOut ? 'extract_item_timeout_isolated' : 'extract_item_error_isolated',
            rejectedCandidates: [message],
          },
        }, 'extract', {
          isolationRecovered: true,
          timedOut,
          errorMessage: message,
        }, context.debugEnabled);
        return addCitationStageLog(
          nextCitation,
          createStageDiagnostic(
            'extract',
            'warning',
            timedOut
              ? 'Extraction timed out for this citation; continuing with the raw split candidate.'
              : 'Extraction failed for this citation; continuing with the raw split candidate.',
            { timedOut, message },
          ),
        );
      };
      const isolation = await runStageTasksWithIsolation({
        stageId: 'extract',
        items: context.citations,
        concurrency: effectiveExtractConcurrency,
        timeoutMs: itemTimeoutMs,
        run: runCitation,
        recover: recoverCitation,
      });
      const citations = isolation.outcomes.map((outcome) => outcome.result);
      const recoveredFallbacks = isolation.outcomes
        .filter((outcome) => outcome.recovered)
        .map((outcome) => outcome.timedOut ? 'extract:item-timeout' : 'extract:item-error');
      fallbacksUsed.push(...recoveredFallbacks);
      const extractionDegraded = recoveredFallbacks.length > 0 || fallbacksUsed.includes('extract:llm_cap_reached');

      return {
        ...context,
        citations,
        workingChunkByCitationId,
        fallbacksUsed,
        partialResult: context.partialResult || extractionDegraded,
        partialReasons: [...new Set([
          ...context.partialReasons,
          ...(fallbacksUsed.includes('extract:llm_cap_reached') ? ['extract:llm_cap_reached'] : []),
          ...recoveredFallbacks,
        ])],
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            extract: {
              adapter: extractor.id,
              citationCount: citations.length,
              extractConcurrency: effectiveExtractConcurrency,
              fallbacksUsed,
              recoveredCount: isolation.recoveredCount,
              timeoutCount: isolation.timeoutCount,
              extractorPathsUsed: [...new Set(citations.map((citation) => citation.extraction?.extractorPath).filter(Boolean))],
              llmFallbackAttemptedCount: citations.filter((citation) => citation.extraction?.llmFallbackAttempted).length,
              llmFallbackAcceptedCount: citations.filter((citation) => citation.extraction?.llmFallbackAccepted).length,
              llmFallbackBudgetSkippedCount: citations.filter((citation) => citation.extraction?.llmFallbackSkippedByBudget).length,
              llmBudget: context.llmBudget,
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'extract',
            'success',
            `Extracted canonical fields for ${citations.length} citation(s) using ${extractor.id}.`,
            { adapter: extractor.id, citationCount: citations.length },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
