import { z } from 'zod';
import type { CanonicalCitation } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import { addCitationStageLog, attachCitationDebug, createEmptyCitation, createStageDiagnostic, logStructuredDebug, normalizeWhitespace } from '../utils.js';

const splitArraySchema = z.array(z.string().trim().min(1));

function extractJsonContent(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function splitTextBlockStructural(block: string): string[] {
  const trimmed = block.trim();
  if (!trimmed) return [];

  const paragraphSplit = trimmed
    .split(/\n\s*\n/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  if (paragraphSplit.length > 1) return paragraphSplit;

  const numberedParts = trimmed
    .split(/\n(?=(?:\[\d+\]|\d+[.)-]|[A-Za-z][.)]))/)
    .map((part) => normalizeWhitespace(part.replace(/^(?:\[\d+\]|\d+[.)-]|[A-Za-z][.)])\s*/, '')))
    .filter(Boolean);
  if (numberedParts.length > 1) return numberedParts;

  return [normalizeWhitespace(trimmed)];
}

function splitNeedsFallback(rawItem: string, structuralParts: string[]): string[] {
  const reasons: string[] = [];
  const normalizedLength = normalizeWhitespace(rawItem).length;

  if (structuralParts.length === 1 && normalizedLength > 240) {
    reasons.push('single_long_block');
  }
  if (structuralParts.some((part) => part.split(/\s+/).length > 140)) {
    reasons.push('oversized_chunk');
  }
  if ((rawItem.match(/\n\s*\d+[.)]/g) ?? []).length >= 2 && structuralParts.length === 1) {
    reasons.push('malformed_numbering');
  }

  return reasons;
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
    signal: AbortSignal.timeout(4500),
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

export function createSplitStage(): V2Stage {
  return {
    id: 'split',
    async run(context) {
      const startedAt = Date.now();
      const citations: CanonicalCitation[] = [];
      const fallbacksUsed = [...context.fallbacksUsed];
      let partialResult = context.partialResult;

      for (const rawItem of context.rawItems) {
        const isStructuredSource = context.inputProfile?.structure === 'structured'
          || !['text', 'url', 'pdf_base64'].includes(context.request.sourceType);
        const shouldEscalateUnstructured = context.inputProfile?.structure === 'unstructured';
        const structuralParts = isStructuredSource ? [rawItem.trim()] : splitTextBlockStructural(rawItem);
        const splitReasons = isStructuredSource ? [] : splitNeedsFallback(rawItem, structuralParts);
        if (shouldEscalateUnstructured && !splitReasons.includes('profiled_unstructured')) {
          splitReasons.push('profiled_unstructured');
        }
        let finalParts = structuralParts;
        let method: 'structural' | 'llm' | 'hybrid' = 'structural';
        let fallbackUsed = false;

        if (splitReasons.length > 0) {
          try {
            const llmParts = await splitWithLlm(rawItem);
            if (llmParts && llmParts.length > 0) {
              finalParts = llmParts.map((part) => normalizeWhitespace(part));
              method = structuralParts.length > 1 ? 'hybrid' : 'llm';
              fallbackUsed = true;
              fallbacksUsed.push('split:llm');
              partialResult = true;
            } else {
              splitReasons.push('llm_unavailable');
            }
          } catch (error) {
            splitReasons.push(`llm_failed:${error instanceof Error ? error.message : String(error)}`);
            partialResult = true;
          }
        }

        const confidence = fallbackUsed
          ? 0.76
          : finalParts.length > 1
            ? 0.92
            : splitReasons.length === 0
              ? 0.85
              : 0.55;

        for (const part of finalParts) {
          let citation = createEmptyCitation(part);
          citation.split = {
            confidence,
            reasons: splitReasons,
            method,
            fallbackUsed,
          };
          citation = attachCitationDebug(citation, 'split', {
            splitConfidence: confidence,
            splitReasons,
            method,
            fallbackUsed,
            producedPart: part,
          }, context.debugEnabled);
          logStructuredDebug(context, 'split', citations.length, citation, {
            warningFlags: splitReasons,
            splitConfidence: confidence,
            method,
          });
          citations.push(addCitationStageLog(
            citation,
            createStageDiagnostic('split', 'success', 'Prepared raw citation block for extraction.', {
              splitConfidence: confidence,
              splitReasons,
              method,
            }),
          ));
        }
      }

      return {
        ...context,
        citations,
        fallbacksUsed,
        partialResult,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            split: {
              rawItems: context.rawItems.length,
              citationCount: citations.length,
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
