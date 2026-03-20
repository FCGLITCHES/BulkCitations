import pLimit from 'p-limit';
import type { CanonicalCitation } from '@shared/schema';
import type { ExtractorAdapter, V2Stage } from '../contracts.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createFieldValue,
  createStageDiagnostic,
  logStructuredDebug,
  parseAuthorsForStyle,
} from '../utils.js';

export function createExtractStage(extractor: ExtractorAdapter): V2Stage {
  return {
    id: 'extract',
    async run(context) {
      const startedAt = Date.now();
      const fallbacksUsed = [...context.fallbacksUsed];
      const grobidEnabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_GROBID_EXTRACTOR ?? '');
      const defaultExtractConcurrency = grobidEnabled ? 2 : 6;
      const configuredExtractConcurrency = Number.parseInt(
        process.env.V2_EXTRACT_CONCURRENCY ?? String(defaultExtractConcurrency),
        10,
      );
      const effectiveExtractConcurrency = Number.isFinite(configuredExtractConcurrency) && configuredExtractConcurrency > 0
        ? configuredExtractConcurrency
        : defaultExtractConcurrency;
      const limit = pLimit(effectiveExtractConcurrency);

      const citations = await Promise.all(context.citations.map((citation, citationIndex) => limit(async () => {
        const effectiveStyle = citation.detectedStyle.value ?? context.request.inputStyle;
        const result = await extractor.extract(citation.raw, effectiveStyle ?? context.request.inputStyle, {
          inputProfile: context.inputProfile,
          detectionConfidence: citation.detectedStyle.confidence,
          batchSize: context.inputProfile?.estimatedCount ?? context.citations.length,
        });
        const authorParseResult = parseAuthorsForStyle(result.parsed.authors ?? [], effectiveStyle);
        const yearValue = result.parsed.year ? Number.parseInt(result.parsed.year, 10) : null;
        if (result.fallbackUsed) {
          fallbacksUsed.push(`extract:${result.method}`);
        }

        let nextCitation: CanonicalCitation = {
          ...citation,
          referenceType: result.referenceType,
          authors: createFieldValue(authorParseResult.authors, 'extracted', result.fieldConfidence.authors ?? 0, 'extract'),
          title: createFieldValue(result.parsed.title ?? null, 'extracted', result.fieldConfidence.title ?? 0, 'extract'),
          year: createFieldValue(Number.isFinite(yearValue) ? yearValue : null, 'extracted', result.fieldConfidence.year ?? 0, 'extract'),
          journal: createFieldValue(result.parsed.journal ?? null, 'extracted', result.fieldConfidence.journal ?? 0, 'extract'),
          volume: createFieldValue(result.parsed.volume ?? null, 'extracted', result.fieldConfidence.volume ?? 0, 'extract'),
          issue: createFieldValue(result.parsed.issue ?? null, 'extracted', result.fieldConfidence.issue ?? 0, 'extract'),
          pages: createFieldValue(result.parsed.pages ?? null, 'extracted', result.fieldConfidence.pages ?? 0, 'extract'),
          doi: createFieldValue(result.parsed.doi ?? null, 'extracted', result.fieldConfidence.doi ?? 0, 'extract'),
          publisher: createFieldValue(result.parsed.publisher ?? null, 'extracted', result.fieldConfidence.publisher ?? 0, 'extract'),
          url: createFieldValue(result.parsed.url ?? null, 'extracted', result.fieldConfidence.url ?? 0, 'extract'),
          conferenceTitle: createFieldValue(result.parsed.conferenceTitle ?? null, 'extracted', result.fieldConfidence.journal ?? 0, 'extract'),
          bookTitle: createFieldValue(result.parsed.bookTitle ?? null, 'extracted', result.fieldConfidence.journal ?? 0, 'extract'),
          institution: createFieldValue(result.parsed.institution ?? null, 'extracted', result.fieldConfidence.publisher ?? 0, 'extract'),
          edition: createFieldValue(result.parsed.edition ?? null, 'extracted', result.fieldConfidence.publisher ?? 0, 'extract'),
          editor: createFieldValue(result.parsed.editor ?? null, 'extracted', result.fieldConfidence.authors ?? 0, 'extract'),
          extraction: {
            method: result.method,
            fallbackUsed: result.fallbackUsed,
            extractorPath: result.extractorPath,
            selectedBranch: result.selectedBranch,
            selectionReason: result.selectionReason,
            authorParserMode: result.authorParserMode ?? authorParseResult.parserMode,
            rejectedCandidates: [
              ...(result.rejectedCandidates ?? []),
              ...authorParseResult.rejectedCandidates,
            ],
          },
        };
        nextCitation = attachCitationDebug(nextCitation, 'extract', {
          selectedBranch: result.selectedBranch,
          selectionReason: result.selectionReason,
          extractorPath: result.extractorPath,
          authorParserMode: result.authorParserMode ?? authorParseResult.parserMode,
          warningFlags: authorParseResult.warningFlags,
          rejectedCandidates: [
            ...(result.rejectedCandidates ?? []),
            ...authorParseResult.rejectedCandidates,
          ],
          ...(result.debug ?? {}),
          selectedParsed: {
            authors: result.parsed.authors ?? [],
            title: result.parsed.title ?? null,
            year: result.parsed.year ?? null,
            journal: result.parsed.journal ?? null,
            conferenceTitle: result.parsed.conferenceTitle ?? null,
            bookTitle: result.parsed.bookTitle ?? null,
            volume: result.parsed.volume ?? null,
            issue: result.parsed.issue ?? null,
            pages: result.parsed.pages ?? null,
          },
          canonicalAuthors: authorParseResult.authors,
        }, context.debugEnabled);
        logStructuredDebug(context, 'extract', citationIndex, nextCitation, {
          selectedBranch: result.selectedBranch,
          selectionReason: result.selectionReason,
          extractorPath: result.extractorPath,
          authorParserMode: result.authorParserMode ?? authorParseResult.parserMode,
          warningFlags: authorParseResult.warningFlags,
          rejectedCandidates: [
            ...(result.rejectedCandidates ?? []),
            ...authorParseResult.rejectedCandidates,
          ],
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
              warnings: [
                ...result.warnings,
                ...authorParseResult.warningFlags,
              ],
              selectedBranch: result.selectedBranch,
              selectionReason: result.selectionReason,
              authorParserMode: result.authorParserMode ?? authorParseResult.parserMode,
            },
          ),
        );
      })));

      return {
        ...context,
        citations,
        fallbacksUsed,
        partialResult: context.partialResult || fallbacksUsed.length > context.fallbacksUsed.length,
        partialReasons: fallbacksUsed.length > context.fallbacksUsed.length
          ? [...context.partialReasons, 'extract:fallback_used']
          : context.partialReasons,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            extract: {
              adapter: extractor.id,
              citationCount: citations.length,
              extractConcurrency: effectiveExtractConcurrency,
              fallbacksUsed,
              extractorPathsUsed: [...new Set(citations.map((citation) => citation.extraction?.extractorPath).filter(Boolean))],
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
