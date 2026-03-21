import { z } from 'zod';
import type { CanonicalCitation } from '@shared/schema';
import type {
  SplitContaminationFlag,
  SplitRepairAction,
  StrippedRegion,
  V2SplitArtifact,
  V2Stage,
} from '../contracts.js';
import {
  addCitationStageLog,
  attachCitationDebug,
  createEmptyCitation,
  createStageDiagnostic,
  logStructuredDebug,
  normalizeDoiValue,
  normalizeWhitespace,
} from '../utils.js';

export const OVERSIZED_CHUNK_CHARS = 800;
export const OVERSIZED_CHUNK_LINES = 12;
export const SUSPECTED_MULTI_CITATION_CHARS = 2000;

const splitArraySchema = z.array(z.string().trim().min(1));
const CITATION_NUMBERING_PATTERN = /^(?:\[\d+\]|\d+[.)-])\s+/;
const DOI_ONLY_PATTERN = /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,}\/\S+$/i;
const URL_ONLY_PATTERN = /^https?:\/\/\S+$/i;
const CONNECTOR_START_PATTERN = /^(?:and|&|et\s+al\.?)/i;
const LOWERCASE_START_PATTERN = /^[a-z]/;
const BARE_INITIAL_START_PATTERN = /^(?:[A-Z]\.?)(?:\s+[A-Z]\.?){0,5}(?:\s*,)?$/;
const TRUNCATED_END_PATTERN = /(?:[,;:]\s*|\b(?:and|&|et al\.?)\s*)$/i;
const HEADER_BLEED_PATTERN = /\bdoi\b.*\b\d+\s+of\s+\d+\b/i;
const PAGE_ARTIFACT_PATTERN = /\b\d+\s+of\s+\d+\b/i;
const REFERENCE_HEADING_PATTERN = /^references?$/i;
const PAGE_NUMBER_PATTERN = /^(?:page\s+)?\d+(?:\s+(?:of|\/)\s+\d+)?$/i;
const SECONDARY_BOUNDARY_PATTERN = /(?<=\.)\s+(?=[A-Z][A-Za-z'’.-]+,\s+[A-Z][^()]{0,40}\(\d{4}\))/g;

type SourceLine = {
  text: string;
  lineNumber: number;
  startOffset: number;
  endOffset: number;
};

type ChunkEntry = {
  kind: 'kept' | 'stripped';
  line: SourceLine;
  rule?: string;
};

type SplitCandidate = {
  entries: ChunkEntry[];
  splitReasons: string[];
  splitMethod: 'structural' | 'llm' | 'hybrid';
  fallbackUsed: boolean;
};

type PreparedCandidate = SplitCandidate & {
  cleanedChunk: string;
  strippedRegions: StrippedRegion[];
  repairActions: SplitRepairAction[];
  contaminationFlags: SplitContaminationFlag[];
  lineCount: number;
  chunkLength: number;
  confidence: number;
};

function extractJsonContent(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function toSourceLines(rawItem: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const linePattern = /.*?(?:\r\n|\n|$)/g;
  let match: RegExpExecArray | null;
  let lineNumber = 1;

  while ((match = linePattern.exec(rawItem)) !== null) {
    if (match[0] === '') break;
    const text = match[0].replace(/\r?\n$/, '');
    lines.push({
      text,
      lineNumber,
      startOffset: match.index,
      endOffset: match.index + text.length,
    });
    lineNumber += 1;
    if (linePattern.lastIndex >= rawItem.length) break;
  }

  return lines;
}

function stripLeadingCitationNumbering(value: string): string {
  return value.replace(CITATION_NUMBERING_PATTERN, '').trim();
}

function isLikelyRunningTitle(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized || normalized.includes('.')) return false;
  const words = normalized.split(/\s+/);
  if (words.length < 3 || words.length > 12) return false;
  const letters = normalized.replace(/[^A-Za-z]/g, '');
  if (letters.length < 8) return false;
  const uppercaseLetters = letters.split('').filter((char) => char === char.toUpperCase()).length;
  return uppercaseLetters / Math.max(letters.length, 1) > 0.8;
}

function stripRuleForLine(line: SourceLine): string | null {
  const trimmed = line.text.trim();
  if (!trimmed) return null;
  if (REFERENCE_HEADING_PATTERN.test(trimmed)) return 'reference_heading';
  if (PAGE_NUMBER_PATTERN.test(trimmed) && !CITATION_NUMBERING_PATTERN.test(trimmed)) return 'page_number';
  if (HEADER_BLEED_PATTERN.test(trimmed)) return 'header_bleed';
  if (isLikelyRunningTitle(trimmed)) return 'running_title';
  return null;
}

function createCandidate(splitReasons: string[] = [], splitMethod: 'structural' | 'llm' | 'hybrid' = 'structural', fallbackUsed = false): SplitCandidate {
  return {
    entries: [],
    splitReasons: [...splitReasons],
    splitMethod,
    fallbackUsed,
  };
}

function buildInitialCandidates(rawItem: string, baseReasons: string[]): SplitCandidate[] {
  const lines = toSourceLines(rawItem);
  const candidates: SplitCandidate[] = [];
  let current: SplitCandidate | null = null;
  let pendingLeadingEntries: ChunkEntry[] = [];

  const flushCurrent = () => {
    if (!current) return;
    if (current.entries.some((entry) => entry.kind === 'kept' && Boolean(entry.line.text.trim()))) {
      candidates.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (!trimmed) {
      flushCurrent();
      continue;
    }

    const stripRule = stripRuleForLine(line);
    if (stripRule) {
      const strippedEntry: ChunkEntry = { kind: 'stripped', line, rule: stripRule };
      if (current && current.entries.some((entry) => entry.kind === 'kept')) {
        current.entries.push(strippedEntry);
      } else {
        pendingLeadingEntries = [...pendingLeadingEntries, strippedEntry];
      }
      continue;
    }

    const startsNewCitation = CITATION_NUMBERING_PATTERN.test(trimmed);
    if (!current || startsNewCitation) {
      flushCurrent();
      current = createCandidate(baseReasons, 'structural', false);
      if (pendingLeadingEntries.length > 0) {
        current.entries.push(...pendingLeadingEntries);
        pendingLeadingEntries = [];
      }
      if (startsNewCitation && !current.splitReasons.includes('structural_numbering')) {
        current.splitReasons.push('structural_numbering');
      }
    }

    current.entries.push({ kind: 'kept', line });
  }

  flushCurrent();

  if (candidates.length === 0) {
    const fallback = createCandidate(baseReasons, 'structural', false);
    for (const line of lines) {
      if (line.text.trim()) {
        fallback.entries.push({ kind: 'kept', line });
      }
    }
    if (fallback.entries.length > 0) candidates.push(fallback);
  }

  return candidates;
}

function auditRaw(candidate: SplitCandidate): string {
  return candidate.entries
    .map((entry) => entry.line.text)
    .filter(Boolean)
    .join('\n')
    .trim();
}

function keptEntries(candidate: SplitCandidate): ChunkEntry[] {
  return candidate.entries.filter((entry) => entry.kind === 'kept' && Boolean(entry.line.text.trim()));
}

function strippedRegions(candidate: SplitCandidate): StrippedRegion[] {
  return candidate.entries
    .filter((entry): entry is ChunkEntry & { kind: 'stripped'; rule: string } => entry.kind === 'stripped' && Boolean(entry.rule))
    .map((entry) => ({
      rule: entry.rule!,
      rawText: entry.line.text,
      startOffset: entry.line.startOffset,
      endOffset: entry.line.endOffset,
      startLine: entry.line.lineNumber,
      endLine: entry.line.lineNumber,
    }));
}

function continuationRepairAction(previous: string, current: string): string | null {
  if (DOI_ONLY_PATTERN.test(current) || URL_ONLY_PATTERN.test(current)) return 'doi_reattached';
  if (LOWERCASE_START_PATTERN.test(current)) return 'lowercase_continuation_joined';
  if (CONNECTOR_START_PATTERN.test(current)) return 'connector_continuation_joined';
  if (BARE_INITIAL_START_PATTERN.test(current)) return 'bare_initial_continuation_joined';
  if (/[,:;]\s*$/.test(previous) && /^\d{4}$/.test(current)) return 'bare_initial_continuation_joined';
  return null;
}

function hasResidualTruncation(cleanedChunk: string, kept: ChunkEntry[]): boolean {
  if (!cleanedChunk) return false;
  const keptLines = kept.map((entry, index) => (
    index === 0 ? stripLeadingCitationNumbering(entry.line.text.trim()) : entry.line.text.trim()
  )).filter(Boolean);
  if (keptLines.length === 0) return false;
  if (TRUNCATED_END_PATTERN.test(cleanedChunk)) return true;
  if (keptLines.length >= 2) {
    const previous = keptLines[keptLines.length - 2];
    const last = keptLines[keptLines.length - 1];
    if (/[,:;]\s*$/.test(previous) && /^\d{4}$/.test(last)) return true;
  }
  return false;
}

function containsDoi(value: string): boolean {
  return /\b10\.\d{4,}\/\S+\b/i.test(value);
}

function hasOnlyDoiOrUrl(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  return DOI_ONLY_PATTERN.test(normalized) || URL_ONLY_PATTERN.test(normalized);
}

function computeConfidence(candidate: SplitCandidate, contaminationFlags: SplitContaminationFlag[], stripped: StrippedRegion[], repairActions: SplitRepairAction[], chunkLength: number, lineCount: number): number {
  let confidence = candidate.fallbackUsed ? 0.76 : 0.88;
  if (candidate.splitMethod === 'hybrid') confidence = Math.min(confidence, 0.8);
  if (candidate.splitReasons.includes('secondary_boundary_recovery')) confidence -= 0.08;
  if (candidate.splitReasons.includes('llm_multi_citation_resplit')) confidence -= 0.1;
  if (stripped.length > 0) confidence -= 0.05;
  if (repairActions.length > 0) confidence -= Math.min(0.12, repairActions.length * 0.03);
  if (contaminationFlags.length > 0) confidence -= Math.min(0.22, contaminationFlags.length * 0.07);
  if (chunkLength > OVERSIZED_CHUNK_CHARS || lineCount > OVERSIZED_CHUNK_LINES) {
    confidence = Math.min(confidence, 0.58);
  }
  return Number(Math.max(0.3, confidence).toFixed(2));
}

function prepareCandidate(candidate: SplitCandidate): PreparedCandidate {
  const kept = keptEntries(candidate);
  const stripped = strippedRegions(candidate);
  const repairActions: SplitRepairAction[] = [];
  const cleanedSegments: string[] = [];

  kept.forEach((entry, index) => {
    const currentLine = index === 0
      ? stripLeadingCitationNumbering(entry.line.text.trim())
      : entry.line.text.trim();
    if (!currentLine) return;

    if (cleanedSegments.length > 0) {
      const previous = cleanedSegments[cleanedSegments.length - 1];
      const action = continuationRepairAction(previous, currentLine);
      if (action) {
        repairActions.push({
          action,
          rawText: entry.line.text,
          sourceLineNumbers: [entry.line.lineNumber],
        });
      }
    }

    cleanedSegments.push(currentLine);
  });

  const cleanedChunk = normalizeWhitespace(cleanedSegments.join(' '));
  const chunkLength = cleanedChunk.length;
  const lineCount = kept.length;
  const contaminationFlags: SplitContaminationFlag[] = [];

  if (stripped.some((region) => ['header_bleed', 'running_title'].includes(region.rule))) {
    contaminationFlags.push('header_bleed_suspected');
  }
  if (stripped.some((region) => region.rule === 'page_number' || PAGE_ARTIFACT_PATTERN.test(region.rawText))) {
    contaminationFlags.push('page_artifact_present');
  }
  if (hasResidualTruncation(cleanedChunk, kept)) {
    contaminationFlags.push('multiline_truncation_suspected');
  }
  if (hasOnlyDoiOrUrl(cleanedChunk)) {
    contaminationFlags.push('doi_orphan');
  }
  if (chunkLength > OVERSIZED_CHUNK_CHARS || lineCount > OVERSIZED_CHUNK_LINES) {
    contaminationFlags.push('oversized_chunk');
  }

  return {
    ...candidate,
    cleanedChunk,
    strippedRegions: stripped,
    repairActions,
    contaminationFlags,
    lineCount,
    chunkLength,
    confidence: computeConfidence(candidate, contaminationFlags, stripped, repairActions, chunkLength, lineCount),
  };
}

function lineNumbersForCandidate(candidate: PreparedCandidate): number[] {
  return keptEntries(candidate).map((entry) => entry.line.lineNumber);
}

function reattachOrphans(candidates: PreparedCandidate[]): PreparedCandidate[] {
  const nextCandidates = [...candidates];

  for (let index = 0; index < nextCandidates.length; index += 1) {
    const candidate = nextCandidates[index];
    if (!candidate.contaminationFlags.includes('doi_orphan')) continue;

    const previous = nextCandidates[index - 1];
    if (!previous || containsDoi(previous.cleanedChunk)) continue;

    const orphanRaw = auditRaw(candidate);
    previous.entries = [...previous.entries, ...candidate.entries];
    previous.repairActions = [
      ...previous.repairActions,
      {
        action: 'doi_reattached',
        rawText: orphanRaw,
        sourceLineNumbers: lineNumbersForCandidate(candidate),
      },
    ];
    nextCandidates[index - 1] = prepareCandidate(previous);
    nextCandidates.splice(index, 1);
    index -= 1;
  }

  return nextCandidates.map((candidate) => prepareCandidate(candidate));
}

function secondaryBoundaryRecovery(candidate: SplitCandidate): SplitCandidate[] | null {
  const raw = auditRaw(candidate);
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
  if (filtered.length <= 1) return null;

  return filtered.map((part) => {
    const derived = createCandidate([...candidate.splitReasons, 'secondary_boundary_recovery'], candidate.splitMethod, candidate.fallbackUsed);
    derived.entries = toSourceLines(part)
      .filter((line) => Boolean(line.text.trim()))
      .map((line) => ({ kind: 'kept' as const, line }));
    return derived;
  });
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

async function maybeResplitCandidate(candidate: SplitCandidate, fallbacksUsed: string[], context: { partialResult: boolean }): Promise<SplitCandidate[]> {
  const raw = auditRaw(candidate);
  if (normalizeWhitespace(raw).length <= SUSPECTED_MULTI_CITATION_CHARS) {
    return [candidate];
  }

  const recovered = secondaryBoundaryRecovery(candidate);
  if (recovered && recovered.length > 1) {
    return recovered;
  }

  try {
    const llmParts = await splitWithLlm(raw);
    if (llmParts && llmParts.length > 1) {
      fallbacksUsed.push('split:llm');
      context.partialResult = true;
      return llmParts.map((part) => {
        const llmCandidate = createCandidate([...candidate.splitReasons, 'llm_multi_citation_resplit'], candidate.splitMethod === 'structural' ? 'llm' : 'hybrid', true);
        llmCandidate.entries = toSourceLines(part)
          .filter((line) => Boolean(line.text.trim()))
          .map((line) => ({ kind: 'kept' as const, line }));
        return llmCandidate;
      });
    }
    candidate.splitReasons = [...candidate.splitReasons, 'llm_unavailable'];
  } catch (error) {
    candidate.splitReasons = [...candidate.splitReasons, `llm_failed:${error instanceof Error ? error.message : String(error)}`];
    context.partialResult = true;
  }

  return [candidate];
}

function splitArtifact(candidate: PreparedCandidate): V2SplitArtifact {
  return {
    cleanedChunk: candidate.cleanedChunk,
    confidence: candidate.confidence,
    splitReasons: candidate.splitReasons,
    splitMethod: candidate.splitMethod,
    fallbackUsed: candidate.fallbackUsed,
    contaminationFlags: candidate.contaminationFlags,
    strippedRegions: candidate.strippedRegions,
    repairActions: candidate.repairActions,
    chunkLength: candidate.chunkLength,
    lineCount: candidate.lineCount,
  };
}

export function createSplitStage(): V2Stage {
  return {
    id: 'split',
    async run(context) {
      const startedAt = Date.now();
      const citations: CanonicalCitation[] = [];
      const fallbacksUsed = [...context.fallbacksUsed];
      let partialResult = context.partialResult;
      const workingChunkByCitationId = { ...context.workingChunkByCitationId };
      const splitArtifactsByCitationId = { ...context.splitArtifactsByCitationId };

      for (const rawItem of context.rawItems) {
        const isStructuredSource = context.inputProfile?.structure === 'structured'
          || !['text', 'url', 'pdf_base64'].includes(context.request.sourceType);
        const baseReasons = context.inputProfile?.structure === 'unstructured'
          ? ['profiled_unstructured']
          : [];

        let candidates = isStructuredSource
          ? [createCandidate([], 'structural', false)]
          : buildInitialCandidates(rawItem, baseReasons);

        if (isStructuredSource) {
          candidates[0].entries = toSourceLines(rawItem.trim())
            .filter((line) => Boolean(line.text.trim()))
            .map((line) => ({ kind: 'kept' as const, line }));
        }

        const expandedCandidates: SplitCandidate[] = [];
        const resplitState = { partialResult };
        for (const candidate of candidates) {
          const resplit = await maybeResplitCandidate(candidate, fallbacksUsed, resplitState);
          expandedCandidates.push(...resplit);
        }
        partialResult = resplitState.partialResult;

        const preparedCandidates = reattachOrphans(expandedCandidates.map((candidate) => prepareCandidate(candidate)));

        for (const candidate of preparedCandidates) {
          const rawChunk = auditRaw(candidate);
          let citation = createEmptyCitation(rawChunk);
          citation.split = {
            confidence: candidate.confidence,
            reasons: candidate.splitReasons,
            method: candidate.splitMethod,
            fallbackUsed: candidate.fallbackUsed,
          };

          const artifact = splitArtifact(candidate);
          workingChunkByCitationId[citation.id] = artifact.cleanedChunk;
          splitArtifactsByCitationId[citation.id] = artifact;

          citation = attachCitationDebug(citation, 'split', {
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
          }, context.debugEnabled);

          logStructuredDebug(context, 'split', citations.length, citation, {
            warningFlags: [...artifact.splitReasons, ...artifact.contaminationFlags],
            splitConfidence: artifact.confidence,
            method: artifact.splitMethod,
            contaminationFlags: artifact.contaminationFlags,
            strippedRegionCount: artifact.strippedRegions.length,
            repairActionCount: artifact.repairActions.length,
          });

          citations.push(addCitationStageLog(
            citation,
            createStageDiagnostic('split', artifact.contaminationFlags.length > 0 ? 'warning' : 'success', 'Prepared raw citation block for extraction.', {
              splitConfidence: artifact.confidence,
              splitReasons: artifact.splitReasons,
              splitMethod: artifact.splitMethod,
              contaminationFlags: artifact.contaminationFlags,
              strippedRegionCount: artifact.strippedRegions.length,
              repairActionCount: artifact.repairActions.length,
            }),
          ));
        }
      }

      return {
        ...context,
        citations,
        fallbacksUsed,
        partialResult,
        workingChunkByCitationId,
        splitArtifactsByCitationId,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            split: {
              rawItems: context.rawItems.length,
              citationCount: citations.length,
              contaminationCount: citations.filter((citation) => splitArtifactsByCitationId[citation.id]?.contaminationFlags.length > 0).length,
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
