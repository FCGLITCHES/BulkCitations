import { z } from 'zod';
import type { CanonicalCitation } from '@shared/schema';
import type { V2ContentLine, V2SplitArtifact, V2Stage } from '../contracts.js';
import { getOpenAiSplitTimeoutMs, recordLlmCapReached, tryConsumeLlmCall } from '../llmConfig.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createEmptyCitation,
  createStageDiagnostic,
  normalizeWhitespace,
} from '../utils.js';
import { getStageRuntimeTimeoutMs, runStageTasksWithIsolation } from '../stageIsolation.js';
import {
  OPENER_THRESHOLD,
  OVERSIZED_WORKING_CHUNK_CHARS,
  OVERSIZED_WORKING_CHUNK_LINES,
  splitRawReferenceBlock,
} from '../rawPdfCopy.js';

export const OVERSIZED_CHUNK_CHARS = OVERSIZED_WORKING_CHUNK_CHARS;
export const OVERSIZED_CHUNK_LINES = OVERSIZED_WORKING_CHUNK_LINES;
export const SUSPECTED_MULTI_CITATION_CHARS = 2000;

const splitArraySchema = z.array(z.string().trim().min(1));
const SECONDARY_BOUNDARY_PATTERN = /(?<=\.)\s+(?=[A-Z][A-Za-z'’.-]+,\s+[A-Z][^()]{0,40}\(\d{4}\))/g;

function extractJsonContent(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function toSourceLines(rawItem: string): string[] {
  return rawItem.split(/\r?\n/);
}

function createStructuredArtifact(rawItem: string, baseReasons: string[]): { rawChunk: string; splitArtifact: V2SplitArtifact } {
  const sourceLines = toSourceLines(rawItem);
  const contentLines: V2ContentLine[] = sourceLines.map((line, index) => ({
    lineIndex: index,
    sourceLineNumber: index + 1,
    text: line.replace(/\r$/, ''),
    role: line.trim() ? 'content' : 'artifact',
    excluded: !line.trim(),
    rawOpenerScore: index === 0 && line.trim() ? 1 : 0,
    openerConfidence: index === 0 && line.trim() ? 1 : 0,
    continuationSignals: [],
    rule: !line.trim() ? 'blank_equivalent' : undefined,
  }));
  const includedLineIndices = contentLines.filter((line) => !line.excluded).map((line) => line.lineIndex);
  const cleanedChunk = includedLineIndices.map((lineIndex) => contentLines[lineIndex]?.text.trim() ?? '').filter(Boolean).join('\n');
  return {
    rawChunk: rawItem.trim(),
    splitArtifact: {
      cleanedChunk,
      confidence: 0.96,
      splitReasons: baseReasons,
      splitMethod: 'structural',
      fallbackUsed: false,
      contaminationFlags: [],
      strippedRegions: [],
      repairActions: [],
      chunkLength: cleanedChunk.length,
      lineCount: includedLineIndices.length,
      contentLines,
      includedLineIndices,
    },
  };
}

function secondaryBoundaryRecovery(raw: string): string[] | null {
  if (normalizeWhitespace(raw).length <= SUSPECTED_MULTI_CITATION_CHARS) return null;

  const matches = [...raw.matchAll(SECONDARY_BOUNDARY_PATTERN)];
  if (matches.length === 0) return null;

  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of matches) {
    const boundary = match.index ?? 0;
    parts.push(raw.slice(lastIndex, boundary).trim());
    lastIndex = boundary + match[0].length;
  }
  parts.push(raw.slice(lastIndex).trim());

  const filtered = parts.filter(Boolean);
  return filtered.length > 1 ? filtered : null;
}

async function splitWithLlm(rawItem: string): Promise<string[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_SPLIT_MODEL ?? process.env.OPENAI_EXTRACT_MODEL ?? 'gpt-4o-mini';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'Split this text into individual citation strings. Return only a JSON array of strings.',
        },
        {
          role: 'user',
          content: rawItem,
        },
      ],
    }),
    signal: AbortSignal.timeout(getOpenAiSplitTimeoutMs()),
  });

  if (!response.ok) {
    throw new Error(`LLM split failed with status ${response.status}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) return null;
  return splitArraySchema.parse(JSON.parse(extractJsonContent(content)));
}

async function maybeResplitRawBlock(
  rawBlock: string,
  baseReasons: string[],
  context: {
    llmBudget: { maxCalls: number; totalCalls: number; splitCalls: number; extractCalls: number; capReached: boolean };
    partialReasons: string[];
    fallbacksUsed: string[];
    partialResult: boolean;
  },
): Promise<Array<{ raw: string; reasons: string[]; method: 'structural' | 'llm'; fallbackUsed: boolean }>> {
  if (normalizeWhitespace(rawBlock).length <= SUSPECTED_MULTI_CITATION_CHARS) {
    return [{ raw: rawBlock, reasons: baseReasons, method: 'structural', fallbackUsed: false }];
  }

  const recovered = secondaryBoundaryRecovery(rawBlock);
  if (recovered && recovered.length > 1) {
    return recovered.map((part) => ({
      raw: part,
      reasons: [...baseReasons, 'secondary_boundary_recovery'],
      method: 'structural',
      fallbackUsed: false,
    }));
  }

  if (!tryConsumeLlmCall(context.llmBudget, 'split')) {
    context.partialResult = true;
    recordLlmCapReached({ fallbacksUsed: context.fallbacksUsed, partialReasons: context.partialReasons }, 'split');
    return [{ raw: rawBlock, reasons: [...baseReasons, 'llm_cap_reached'], method: 'structural', fallbackUsed: true }];
  }

  try {
    const llmParts = await splitWithLlm(rawBlock);
    if (llmParts && llmParts.length > 1) {
      context.partialResult = true;
      context.fallbacksUsed.push('split:llm');
      return llmParts.map((part) => ({
        raw: part,
        reasons: [...baseReasons, 'llm_multi_citation_resplit'],
        method: 'llm',
        fallbackUsed: true,
      }));
    }
  } catch (error) {
    context.partialResult = true;
    context.partialReasons.push(`split:llm_failed:${error instanceof Error ? error.message : String(error)}`);
  }

  return [{ raw: rawBlock, reasons: [...baseReasons, 'llm_unavailable'], method: 'structural', fallbackUsed: true }];
}

function attachSplitDebug(citation: CanonicalCitation, artifact: V2SplitArtifact, debugEnabled: boolean): CanonicalCitation {
  return attachCitationDebug(citation, 'split', {
    cleanedChunk: artifact.cleanedChunk,
    splitConfidence: artifact.confidence,
    splitReasons: artifact.splitReasons,
    splitMethod: artifact.splitMethod,
    fallbackUsed: artifact.fallbackUsed,
    contaminationFlags: artifact.contaminationFlags,
    strippedRegions: artifact.strippedRegions,
    repairActions: artifact.repairActions,
    chunkLength: artifact.chunkLength,
    lineCount: artifact.lineCount,
    contentLines: artifact.contentLines,
    includedLineIndices: artifact.includedLineIndices,
    openerThreshold: OPENER_THRESHOLD,
  }, debugEnabled);
}

export function createSplitStage(): V2Stage {
  return {
    id: 'split',
    async run(context) {
      const startedAt = Date.now();
      const fallbacksUsed = [...context.fallbacksUsed];
      let partialResult = context.partialResult;
      const partialReasons = [...context.partialReasons];
      const splitArtifactsByCitationId = { ...context.splitArtifactsByCitationId };
      const splitTimeoutMs = getStageRuntimeTimeoutMs('split', context.stageConfig);

      const isolation = await runStageTasksWithIsolation({
        stageId: 'split',
        items: context.rawItems,
        concurrency: 1,
        timeoutMs: splitTimeoutMs,
        run: async (rawItem) => {
          const citations: CanonicalCitation[] = [];
          const localArtifacts: Record<string, V2SplitArtifact> = {};
          const isStructuredSource = context.inputProfile?.structure === 'structured'
            || !['text', 'url', 'pdf_base64'].includes(context.request.sourceType);
          const profileSignals = new Set(context.inputProfile?.signals ?? []);
          const baseReasons = [
            ...(context.inputProfile?.structure === 'unstructured' ? ['profiled_unstructured'] : []),
            ...(['ocr_noise_markers', 'mixed_style_markers', 'book_tail_markers', 'conference_tail_markers', 'doi_heavy']
              .filter((signal) => profileSignals.has(signal))
              .map((signal) => `profile_${signal}`)),
          ];

          const resplitContext = {
            llmBudget: context.llmBudget,
            partialReasons,
            fallbacksUsed,
            partialResult,
          };

          const initialBlocks = [{ raw: rawItem, reasons: baseReasons, method: 'structural' as const, fallbackUsed: false }];

          for (const block of initialBlocks) {
            let prepared = isStructuredSource
              ? [createStructuredArtifact(block.raw, block.reasons)]
              : splitRawReferenceBlock(block.raw, block.reasons).map((candidate) => ({
                rawChunk: candidate.rawChunk,
                splitArtifact: {
                  ...candidate.splitArtifact,
                  splitMethod: block.method,
                  fallbackUsed: block.fallbackUsed,
                },
              }));

            if (!isStructuredSource && prepared.length === 1 && normalizeWhitespace(block.raw).length > SUSPECTED_MULTI_CITATION_CHARS) {
              const resplitBlocks = await maybeResplitRawBlock(block.raw, block.reasons, resplitContext);
              partialResult = resplitContext.partialResult;
              if (resplitBlocks.length > 1 || resplitBlocks[0]?.fallbackUsed) {
                prepared = resplitBlocks.flatMap((resplitBlock) => splitRawReferenceBlock(resplitBlock.raw, resplitBlock.reasons).map((candidate) => ({
                  rawChunk: candidate.rawChunk,
                  splitArtifact: {
                    ...candidate.splitArtifact,
                    splitMethod: resplitBlock.method,
                    fallbackUsed: resplitBlock.fallbackUsed,
                  },
                })));
              }
            }

            for (const candidate of prepared) {
              let citation = createEmptyCitation(candidate.rawChunk);
              citation.split = {
                confidence: candidate.splitArtifact.confidence,
                reasons: candidate.splitArtifact.splitReasons,
                method: candidate.splitArtifact.splitMethod,
                fallbackUsed: candidate.splitArtifact.fallbackUsed,
              };
              citation = attachSplitDebug(citation, candidate.splitArtifact, context.debugEnabled);

              localArtifacts[citation.id] = candidate.splitArtifact;
              citations.push(addCitationStageLog(
                citation,
                createStageDiagnostic(
                  'split',
                  candidate.splitArtifact.contaminationFlags.length > 0 ? 'warning' : 'success',
                  'Prepared structural citation candidate for extraction.',
                  {
                    splitConfidence: candidate.splitArtifact.confidence,
                    splitReasons: candidate.splitArtifact.splitReasons,
                    splitMethod: candidate.splitArtifact.splitMethod,
                    contaminationFlags: candidate.splitArtifact.contaminationFlags,
                    lineCount: candidate.splitArtifact.lineCount,
                  },
                ),
              ));
            }
          }

          return {
            citations,
            splitArtifactsByCitationId: localArtifacts,
          };
        },
        recover: ({ item: rawItem, message, timedOut }) => {
          const fallback = createStructuredArtifact(rawItem, ['stage_isolation_recovery']);
          fallback.splitArtifact.confidence = 0.3;
          fallback.splitArtifact.fallbackUsed = true;
          let citation = createEmptyCitation(fallback.rawChunk || rawItem);
          citation.split = {
            confidence: fallback.splitArtifact.confidence,
            reasons: fallback.splitArtifact.splitReasons,
            method: fallback.splitArtifact.splitMethod,
            fallbackUsed: fallback.splitArtifact.fallbackUsed,
          };
          citation = attachSplitDebug(citation, fallback.splitArtifact, context.debugEnabled);

          return {
            citations: [addCitationStageLog(
              citation,
              createStageDiagnostic(
                'split',
                'warning',
                timedOut
                  ? 'Split timed out for this input block; continuing with a single structural candidate.'
                  : 'Split failed for this input block; continuing with a single structural candidate.',
                { timedOut, message },
              ),
            )],
            splitArtifactsByCitationId: {
              [citation.id]: fallback.splitArtifact,
            },
          };
        },
      });

      const citations = isolation.outcomes.flatMap((outcome) => outcome.result.citations);
      for (const outcome of isolation.outcomes) {
        Object.assign(splitArtifactsByCitationId, outcome.result.splitArtifactsByCitationId);
      }

      const recoveredFallbacks = isolation.outcomes
        .filter((outcome) => outcome.recovered)
        .map((outcome) => outcome.timedOut ? 'split:item-timeout' : 'split:item-error');

      return {
        ...context,
        citations,
        fallbacksUsed: [...fallbacksUsed, ...recoveredFallbacks],
        partialResult: partialResult || isolation.recoveredCount > 0,
        partialReasons: [...new Set([...partialReasons, ...recoveredFallbacks])],
        splitArtifactsByCitationId,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            split: {
              rawItems: context.rawItems.length,
              citationCount: citations.length,
              contaminationCount: citations.filter((citation) => splitArtifactsByCitationId[citation.id]?.contaminationFlags.length > 0).length,
              recoveredCount: isolation.recoveredCount,
              timeoutCount: isolation.timeoutCount,
              openerThreshold: OPENER_THRESHOLD,
              llmBudget: context.llmBudget,
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'split',
            'success',
            `Split ${context.rawItems.length} item(s) into ${citations.length} citation candidate(s).`,
            { rawItems: context.rawItems.length, citationCount: citations.length },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
