import { FIELD_CONFIDENCE_THRESHOLDS, getFieldSchema } from '../mandatory-fields.js';
import {
  calibrateRecoveredFieldConfidence,
  canUseHostedLlmRepair,
} from '../confidenceCalibration.js';
import { syncFieldUncertainty } from '../fieldConfidence.js';
import { canLLMOverwrite } from '../overwrite-policy.js';
import { ErrorCode } from '../errors/index.js';
import {
  normalizeArxiv,
  normalizeHandle,
  normalizeIdentifierForField,
  normalizeIsbn,
  normalizeIssn,
  normalizePatent,
  normalizePmid,
} from '../identifierUtils.js';
import { representativeStyleForFamily } from '../styleDetection.js';
import type { ReferenceCarrier } from '../types/carrier.js';
import { fieldOf } from '../types/field.js';
import type { CitationStyle, ExtractedFields } from '../types/citation.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import { getMissingFieldKeys, hasFieldValue, isExtractedFieldKey, setExtractedField } from '../utils/fields.js';
import { parseAuthorSegment } from '../utils/authors.js';
import { classifyTypeHeuristically, fallbackTypeConfidence } from '../utils/type-classification.js';
import { llmService } from '../../services/openai.js';
import { isStageBudgetExceeded, runWithRemainingStageBudget } from '../../pipeline/performance.js';

const CONTRACT_VERSION = 1;
const STAGE_ID = 'phase6_5_llm_fallback';

export interface LLMRepairCandidate {
  referenceConfidence: number;
  fields: Partial<Record<keyof ExtractedFields, unknown>>;
  tokensUsed?: number;
  source?: 'llm' | 'heuristic';
}

export type LLMRepairer = (carrier: ReferenceCarrier) => Promise<LLMRepairCandidate>;

export class Phase6_5LLMFallback implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'llm_fallback' as const;
  readonly contractVersion = CONTRACT_VERSION;

  constructor(private readonly repairer: LLMRepairer = openaiRepairer) {}

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();
    let fallbackCount = 0;
    let llmRepairCount = 0;
    let heuristicRepairCount = 0;
    let budgetExceeded = false;
    const hostedRepairAllowed = canUseHostedLlmRepair(ctx);

    for (const carrier of carriers) {
      const schemaStyle = ctx.outputStyle !== 'auto' && ctx.outputStyle !== 'unknown'
        ? ctx.outputStyle
        : carrier.styleResolution.effectiveStyleKnown
          ? carrier.styleResolution.effectiveStyle
          : normalizeStyle(carrier.style.primary.style, carrier.style.family);
      const schema = getFieldSchema(carrier.type.type, schemaStyle);
      const missingFields = getMissingFieldKeys(carrier.fields, schema.mandatory);
      const lowConfidenceMandatory = schema.mandatory.filter((field) => {
        const threshold = FIELD_CONFIDENCE_THRESHOLDS[field];
        return threshold != null && hasFieldValue(carrier.fields[field]) && carrier.fields[field].confidence < threshold;
      });
      const weakCoreCoverage = hasWeakCoreCoverage(carrier, schema.mandatory);
      const shouldRepair =
        missingFields.length > 0 ||
        lowConfidenceMandatory.length > 0 ||
        carrier.type.isUnknown ||
        carrier.style.family === 'unknown' ||
        weakCoreCoverage;

      if (!shouldRepair) continue;

      fallbackCount += 1;
      if (isStageBudgetExceeded(ctx, this.phaseId, startedAt)) {
        budgetExceeded = true;
        break;
      }
      const budgeted = await runWithRemainingStageBudget(ctx, this.phaseId, startedAt, () =>
        hostedRepairAllowed ? this.repairer(carrier) : heuristicRepairer(carrier),
      );
      if (budgeted.timedOut) {
        budgetExceeded = true;
        break;
      }
      const repair = budgeted.value;

      if (repair.tokensUsed) {
        ctx.providerUsage.llmTokensUsed += repair.tokensUsed;
      }

      if (repair.source === 'llm') {
        llmRepairCount += 1;
        ctx.providerUsage.llmRepairCalls += 1;
      } else {
        heuristicRepairCount += 1;
      }

      for (const [field, rawValue] of Object.entries(repair.fields)) {
        if (!isExtractedFieldKey(field)) continue;
        if (rawValue == null) continue;
        const existingField = carrier.fields[field];
        if (!canLLMOverwrite(existingField, repair.referenceConfidence)) continue;

        const normalizedValue = normalizeRepairValue(field, rawValue);
        setExtractedField(carrier.fields, field, fieldOf(
          normalizedValue as never,
          'llm_fallback',
          STAGE_ID,
          calibrateRecoveredFieldConfidence(
            field,
            normalizedValue as ExtractedFields[typeof field]['value'],
            repair.referenceConfidence,
          ),
        ) as ExtractedFields[typeof field]);
        if (!carrier.healthEvidence.validSpanFields.includes(field)) {
          carrier.healthEvidence.validSpanFields.push(field);
        }
      }
      syncFieldUncertainty(carrier.fields);

      if (!carrier.doiFastPath && carrier.type.isUnknown) {
        const nextType = classifyTypeHeuristically(carrier);
        if (nextType !== 'unknown') {
          carrier.type = {
            type: nextType,
            confidence: fallbackTypeConfidence(nextType),
            isUnknown: false,
          };
        }
      }

      const repairSource = repair.source === 'llm' ? 'OpenAI LLM' : 'heuristic fallback';
      carrier.stageLog.push(
        stageRecord({
          phaseId: this.phaseId,
          status: 'warning',
          durationMs: 0,
          code: ErrorCode.LLM_LOW_CONFIDENCE,
          message: `Repair applied via ${repairSource} to recover missing fields.`,
          details: {
              missingFields,
              lowConfidenceMandatory,
              weakCoreCoverage,
              referenceConfidence: repair.referenceConfidence,
              source: repair.source ?? 'heuristic',
              hostedRepairAllowed,
              tenantTier: ctx.tenantContext.tier,
            },
        }),
      );
    }

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: fallbackCount > 0 ? 'warning' : 'skipped',
        durationMs: Date.now() - startedAt,
        ...(fallbackCount > 0 ? { code: ErrorCode.LLM_LOW_CONFIDENCE } : {}),
        message: fallbackCount > 0
          ? budgetExceeded
            ? `Phase 6.5 reached its latency budget after repairing ${fallbackCount} references (${llmRepairCount} via LLM, ${heuristicRepairCount} via heuristic).`
            : `Phase 6.5 repaired ${fallbackCount} references (${llmRepairCount} via LLM, ${heuristicRepairCount} via heuristic).`
          : 'Phase 6.5 was not needed.',
      }),
    );

    return carriers;
  }
}

export const phase6_5LLMFallback = new Phase6_5LLMFallback();

async function openaiRepairer(carrier: ReferenceCarrier): Promise<LLMRepairCandidate> {
  const schemaStyle = carrier.styleResolution.effectiveStyleKnown
    ? carrier.styleResolution.effectiveStyle
    : normalizeStyle(carrier.style.primary.style, carrier.style.family);
  const schema = getFieldSchema(carrier.type.type, schemaStyle);
  const missingFieldNames = getMissingFieldKeys(carrier.fields, schema.mandatory);
  const completeness = schema.mandatory.length === 0
    ? 1
    : (schema.mandatory.length - missingFieldNames.length) / schema.mandatory.length;

  // Plan gating:
  // - never call OpenAI for unknown type
  // - never call OpenAI for high-completeness citations
  if (carrier.type.isUnknown) {
    const heuristic = await heuristicRepairer(carrier);
    return { ...heuristic, source: 'heuristic' };
  }
  if (completeness > 0.8) {
    const heuristic = await heuristicRepairer(carrier);
    return { ...heuristic, source: 'heuristic' };
  }
  if (missingFieldNames.length === 0) {
    const heuristic = await heuristicRepairer(carrier);
    return { ...heuristic, source: 'heuristic' };
  }

  try {
    const result = await llmService.repair(
      carrier.raw,
      carrier.type.type,
      schemaStyle,
      missingFieldNames,
    );

    if (result.referenceConfidence === 0) {
      const heuristic = await heuristicRepairer(carrier);
      return { ...heuristic, tokensUsed: result.tokensUsed, source: 'heuristic' };
    }

    return {
      referenceConfidence: result.referenceConfidence,
      fields: result.fields as Partial<Record<keyof ExtractedFields, unknown>>,
      tokensUsed: result.tokensUsed,
      source: 'llm',
    };
  } catch {
    const heuristic = await heuristicRepairer(carrier);
    return { ...heuristic, source: 'heuristic' };
  }
}

async function heuristicRepairer(carrier: ReferenceCarrier): Promise<LLMRepairCandidate> {
  const raw = carrier.raw.replace(/\s+/g, ' ').trim();
  const fields: Partial<Record<keyof ExtractedFields, unknown>> = {};

  if (!hasFieldValue(carrier.fields.authors)) {
    const authorSegment = raw.split(/\((?:19|20)\d{2}[a-z]?\)/)[0]?.trim() ?? '';
    if (authorSegment) fields.authors = parseAuthorSegment(authorSegment);
  }

  if (!hasFieldValue(carrier.fields.title)) {
    const title = raw.match(/\)\.?\s*([^.;]+(?:\.[^.;]+)*)/)?.[1]?.trim();
    if (title) fields.title = title.replace(/\s+/g, ' ').trim();
  }

  if (!hasFieldValue(carrier.fields.year)) {
    const year = raw.match(/\b((?:19|20)\d{2})\b/)?.[1];
    if (year) fields.year = Number(year);
  }

  if (!hasFieldValue(carrier.fields.url)) {
    const url = raw.match(/https?:\/\/[^\s)]+/)?.[0];
    if (url) fields.url = url;
  }

  if (!hasFieldValue(carrier.fields.pmid)) {
    const pmid = raw.match(/\bPMID[:\s]*(\d{5,9})\b/i)?.[1];
    if (pmid) fields.pmid = normalizePmid(pmid);
  }

  if (!hasFieldValue(carrier.fields.arxiv)) {
    const arxiv = raw.match(/\b(?:arXiv:\s*|10\.48550\/arXiv\.)(\d{4}\.\d{4,5}(?:v\d+)?)\b/i)?.[0];
    if (arxiv) fields.arxiv = normalizeArxiv(arxiv);
  }

  if (!hasFieldValue(carrier.fields.isbn)) {
    const isbn = raw.match(/\bISBN(?:-1[03])?:?\s*((?:97[89][-\s]?)?\d(?:[-\s]?\d){8,}[0-9Xx])\b/i)?.[1];
    if (isbn) fields.isbn = normalizeIsbn(isbn);
  }

  if (!hasFieldValue(carrier.fields.issn)) {
    const issn = raw.match(/\bISSN:?\s*(\d{4}-?\d{3}[\dXx])\b/i)?.[1];
    if (issn) fields.issn = normalizeIssn(issn);
  }

  if (!hasFieldValue(carrier.fields.handle)) {
    const handle = raw.match(/\b(?:hdl:\s*|https?:\/\/(?:hdl\.)?handle\.net\/)(\d+(?:\.\d+)*\/\S+)\b/i)?.[1];
    if (handle) fields.handle = normalizeHandle(handle);
  }

  if (!hasFieldValue(carrier.fields.patent) && /\bpatent\b/i.test(raw)) {
    fields.patent = normalizePatent(raw);
  }

  if (!hasFieldValue(carrier.fields.accessedDate) && /Accessed|Retrieved/i.test(raw)) {
    const accessedDate = raw.match(/(?:Accessed|Retrieved)\s+(.*?)(?:\.|$)/i)?.[1]?.trim();
    if (accessedDate) fields.accessedDate = accessedDate;
  }

  if (!hasFieldValue(carrier.fields.repository) && /arXiv|SSRN|bioRxiv|medRxiv|Zenodo|Figshare/i.test(raw)) {
    fields.repository = raw.match(/(arXiv|SSRN|bioRxiv|medRxiv|Zenodo|Figshare)/i)?.[1];
  }

  const populated = Object.keys(fields).length;
  const referenceConfidence = populated >= 3 ? 0.86 : populated > 0 ? 0.74 : 0.4;
  return { referenceConfidence, fields };
}

function normalizeRepairValue(field: keyof ExtractedFields, value: unknown): unknown {
  if ((field === 'authors' || field === 'editors') && typeof value === 'string') {
    return parseAuthorSegment(value);
  }
  if (
    field === 'doi'
    || field === 'pmid'
    || field === 'arxiv'
    || field === 'isbn'
    || field === 'issn'
    || field === 'handle'
    || field === 'patent'
  ) {
    return normalizeIdentifierForField(field, value);
  }
  return value;
}

function hasWeakCoreCoverage(
  carrier: ReferenceCarrier,
  mandatoryFields: ReadonlyArray<keyof ExtractedFields>,
): boolean {
  const populatedCoreFields = mandatoryFields.filter((field) => hasFieldValue(carrier.fields[field])).length;
  if (populatedCoreFields < 3) {
    return true;
  }

  if (mandatoryFields.length === 0) {
    return false;
  }

  return populatedCoreFields / mandatoryFields.length < 0.6;
}

function normalizeStyle(style: CitationStyle, family: ReferenceCarrier['style']['family']): CitationStyle {
  return style === 'auto' || style === 'unknown' ? representativeStyleForFamily(family) : style;
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
