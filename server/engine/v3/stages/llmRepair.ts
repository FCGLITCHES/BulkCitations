import type { CanonicalCitation, ParsedReference } from '@shared/schema';
import { isPlaceholderFieldValue } from '@shared/referencePlaceholders';
import { runLLMFallbackRepair } from '../../stages/phase6_5LLMFallback.js';
import type { V3Stage } from '../contracts.js';
import { LOCKABLE_FIELDS } from '../locks.js';
import {
  addCitationStageLog,
  canonicalToParsedReference,
  createFieldValue,
  createStageDiagnostic,
  fixUnicodeText,
  normalizeDoiValue,
  normalizeWhitespace,
  parseAuthorsForStyle,
} from '../../v2/utils.js';

const LLM_TIMEOUT_MS = 4_000;

const MANDATORY_FIELDS_BY_TYPE: Record<string, Array<keyof ParsedReference | 'authors'>> = {
  journal: ['authors', 'year', 'title', 'journal', 'volume', 'pages'],
  conference: ['authors', 'year', 'title', 'conferenceTitle'],
  chapter: ['authors', 'year', 'title', 'bookTitle', 'pages'],
  book: ['authors', 'year', 'title', 'publisher'],
  thesis: ['authors', 'year', 'title', 'institution'],
  website: ['authors', 'year', 'title', 'url'],
  report: ['authors', 'year', 'title', 'institution'],
  preprint: ['authors', 'year', 'title'],
  unknown: ['authors', 'year', 'title'],
};

function timeoutPromise<T>(ms: number): Promise<T> {
  return new Promise<T>((_, reject) => {
    setTimeout(() => reject(new Error(`llm_repair_timeout_${ms}`)), ms);
  });
}

function requiredFieldsForCitation(citation: CanonicalCitation): string[] {
  return MANDATORY_FIELDS_BY_TYPE[citation.referenceType] ?? MANDATORY_FIELDS_BY_TYPE.unknown;
}

function fieldConfidence(citation: CanonicalCitation, field: string): number {
  const candidate = (citation as Record<string, any>)[field];
  if (!candidate || typeof candidate !== 'object') return 0;
  return typeof candidate.confidence === 'number' ? candidate.confidence : 0;
}

function fieldValue(citation: CanonicalCitation, field: string): unknown {
  const candidate = (citation as Record<string, any>)[field];
  if (!candidate || typeof candidate !== 'object' || !('value' in candidate)) return undefined;
  return candidate.value;
}

function normalizeFieldValue(field: string, value: unknown): unknown {
  if (value == null) return null;
  if (field === 'doi') {
    const normalized = normalizeDoiValue(String(value));
    return normalized || null;
  }
  if (field === 'year') {
    const match = String(value).match(/\b(19|20)\d{2}\b/);
    return match ? Number.parseInt(match[0], 10) : null;
  }
  if (field === 'authors' && Array.isArray(value)) {
    return value.map((item) => normalizeWhitespace(String(item))).filter(Boolean);
  }
  return normalizeWhitespace(fixUnicodeText(String(value)));
}

function isStructurallyValid(field: string, value: unknown): boolean {
  if (value == null) return false;
  if (field === 'doi') return /^10\.\d{4,9}\/\S+$/i.test(String(value));
  if (field === 'year') return typeof value === 'number' && Number.isFinite(value);
  if (field === 'authors') return Array.isArray(value) && value.length > 0;
  if (field === 'url') return /^https?:\/\//i.test(String(value));
  return !isPlaceholderFieldValue(String(value));
}

function canImproveCitation(citation: CanonicalCitation, field: string, candidate: unknown): boolean {
  const currentValue = fieldValue(citation, field);
  const currentConfidence = fieldConfidence(citation, field);

  if (candidate == null || !isStructurallyValid(field, candidate)) return false;
  if (field === 'authors') {
    return (!Array.isArray(currentValue) || currentValue.length === 0 || currentConfidence < 0.7)
      && JSON.stringify(currentValue ?? []) !== JSON.stringify(candidate);
  }

  const normalizedCurrent = currentValue == null ? '' : normalizeWhitespace(String(currentValue));
  const normalizedCandidate = normalizeWhitespace(String(candidate));
  if (normalizedCurrent === normalizedCandidate) return false;
  if (!normalizedCurrent) return true;
  if (isPlaceholderFieldValue(normalizedCurrent)) return true;
  return currentConfidence < 0.7;
}

function applyRepairedFields(
  citation: CanonicalCitation,
  repaired: Partial<ParsedReference>,
): { citation: CanonicalCitation; improvedFields: string[]; noOp: boolean } {
  const improvedFields: string[] = [];
  let nextCitation = { ...citation };

  for (const field of LOCKABLE_FIELDS) {
    if (!(field in repaired)) continue;
    const normalized = normalizeFieldValue(field, (repaired as Record<string, unknown>)[field]);
    if (!canImproveCitation(nextCitation, field, normalized)) continue;

    if (field === 'authors' && Array.isArray(normalized)) {
      const parsed = parseAuthorsForStyle(
        normalized,
        nextCitation.detectedStyle.value ?? 'auto',
      );
      nextCitation = {
        ...nextCitation,
        authors: createFieldValue(parsed.authors, 'extracted', 0.82, 'llm_repair'),
      };
      improvedFields.push(field);
      continue;
    }

    const existingField = (nextCitation as Record<string, any>)[field];
    if (!existingField || typeof existingField !== 'object') continue;
    (nextCitation as Record<string, any>)[field] = createFieldValue(
      normalized as never,
      'extracted',
      Math.min(0.82, Math.max(existingField.confidence ?? 0, 0.7)),
      'llm_repair',
    );
    improvedFields.push(field);
  }

  const extraction = {
    method: citation.extraction?.method ?? 'hybrid',
    fallbackUsed: citation.extraction?.fallbackUsed ?? false,
    ...citation.extraction,
  };

  nextCitation = {
    ...nextCitation,
    extraction: {
      ...extraction,
      llmFallbackAttempted: true,
      llmFallbackAccepted: improvedFields.length > 0,
      llmFallbackFieldsImproved: improvedFields,
      llmFallbackNoOpAccepted: improvedFields.length === 0,
      llmFallbackReason: improvedFields.length > 0 ? 'mandatory_fields_repaired' : 'no_structural_improvement',
    },
  };

  return {
    citation: nextCitation,
    improvedFields,
    noOp: improvedFields.length === 0,
  };
}

async function repairCitation(citation: CanonicalCitation): Promise<CanonicalCitation> {
  const requiredFields = requiredFieldsForCitation(citation);
  const missingOrWeak = requiredFields.filter((field) => {
    const value = fieldValue(citation, field);
    const confidence = fieldConfidence(citation, field);
    if (field === 'authors') {
      return !Array.isArray(value) || value.length === 0 || confidence < 0.7;
    }
    return !value || isPlaceholderFieldValue(String(value)) || confidence < 0.7;
  });

  if (missingOrWeak.length === 0) {
    return addCitationStageLog(citation, createStageDiagnostic('llm_repair', 'skipped', 'No mandatory low-confidence fields required LLM repair.'));
  }

  if (!process.env.OPENAI_API_KEY) {
    const extraction = {
      method: citation.extraction?.method ?? 'hybrid',
      fallbackUsed: citation.extraction?.fallbackUsed ?? false,
      ...citation.extraction,
    };
    return addCitationStageLog({
      ...citation,
      extraction: {
        ...extraction,
        llmFallbackAttempted: false,
        llmFallbackAccepted: false,
        llmFallbackReason: 'missing_api_key',
      },
    }, createStageDiagnostic('llm_repair', 'skipped', 'LLM repair skipped because no OpenAI API key is configured.'));
  }

  try {
    const repaired = await Promise.race([
      runLLMFallbackRepair(citation.raw, canonicalToParsedReference(citation)),
      timeoutPromise<Partial<ParsedReference> | null>(LLM_TIMEOUT_MS),
    ]);

    if (!repaired) {
      const extraction = {
        method: citation.extraction?.method ?? 'hybrid',
        fallbackUsed: citation.extraction?.fallbackUsed ?? false,
        ...citation.extraction,
      };
      return addCitationStageLog({
        ...citation,
        extraction: {
          ...extraction,
          llmFallbackAttempted: true,
          llmFallbackAccepted: false,
          llmFallbackReason: 'empty_response',
        },
      }, createStageDiagnostic('llm_repair', 'warning', 'LLM repair returned no usable fields.'));
    }

    const applied = applyRepairedFields(citation, repaired);
    return addCitationStageLog(applied.citation, createStageDiagnostic(
      'llm_repair',
      applied.improvedFields.length > 0 ? 'success' : 'warning',
      applied.improvedFields.length > 0
        ? `LLM repair improved ${applied.improvedFields.join(', ')}.`
        : 'LLM repair returned fields but produced no accepted improvements.',
      {
        improvedFields: applied.improvedFields,
        requiredFields: missingOrWeak,
      },
    ));
  } catch (error) {
    const extraction = {
      method: citation.extraction?.method ?? 'hybrid',
      fallbackUsed: citation.extraction?.fallbackUsed ?? false,
      ...citation.extraction,
    };
    return addCitationStageLog({
      ...citation,
      extraction: {
        ...extraction,
        llmFallbackAttempted: true,
        llmFallbackAccepted: false,
        llmFallbackReason: error instanceof Error ? error.message : String(error),
      },
    }, createStageDiagnostic('llm_repair', 'warning', 'LLM repair failed or timed out; preserving extracted fields.', {
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

export function createV3LlmRepairStage(): V3Stage {
  return {
    id: 'llm_repair',
    async run(context) {
      const citations: CanonicalCitation[] = [];
      for (const citation of context.v2.citations) {
        citations.push(await repairCitation(citation));
      }
      return {
        ...context,
        v2: {
          ...context.v2,
          citations,
          fallbacksUsed: citations.some((citation) => citation.extraction?.llmFallbackAccepted)
            ? [...context.v2.fallbacksUsed, 'llm_repair:applied']
            : context.v2.fallbacksUsed,
        },
      };
    },
  };
}
