import { ErrorCode } from '../errors/index.js';
import { toHealthWarning, uniqueHealthWarnings } from '../healthWarnings.js';
import { finalizeDisplayScore } from '../scoringHelpers.js';
import type { ReferenceCarrier } from '../types/carrier.js';
import type { AuthorityFlag } from '../types/citation.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import { retractionWatchService } from '../../services/retractionWatch.js';
import { env } from '../../config.js';
import {
  isStageBudgetExceeded,
  runWithConcurrencyLimit,
  runWithRemainingStageBudget,
} from '../../pipeline/performance.js';

const CONTRACT_VERSION = 1;
const STAGE_ID = 'phase11_authority_validation';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const SCORE_PENALTY: Partial<Record<AuthorityFlag['type'], number>> = {
  retracted: -45,
  expression_of_concern: -25,
  author_conflict: -10,
  metadata_mismatch: -10,
};

export interface AuthorityCheck {
  checked: boolean;
  flags: AuthorityFlag[];
  scoreAdjustment: number;
}

export interface AuthorityChecker {
  check(carrier: ReferenceCarrier): Promise<AuthorityCheck>;
}

export class HeuristicAuthorityChecker implements AuthorityChecker {
  async check(carrier: ReferenceCarrier): Promise<AuthorityCheck> {
    const haystack = `${carrier.raw} ${carrier.fields.title.value ?? ''}`.toLowerCase();
    const flags: AuthorityFlag[] = [];
    let scoreAdjustment = 0;

    if (haystack.includes('retracted')) {
      flags.push({
        type: 'retracted',
        source: 'heuristic_retraction_watch',
        details: 'Reference text contains a retraction marker.',
      });
      scoreAdjustment -= 45;
    }

    if (haystack.includes('expression of concern')) {
      flags.push({
        type: 'expression_of_concern',
        source: 'heuristic_retraction_watch',
        details: 'Reference text contains an expression-of-concern marker.',
      });
      scoreAdjustment -= 25;
    }

    return { checked: true, flags, scoreAdjustment };
  }
}

export class RealAuthorityChecker implements AuthorityChecker {
  private readonly heuristic = new HeuristicAuthorityChecker();

  async check(carrier: ReferenceCarrier): Promise<AuthorityCheck> {
    const flagsByType = new Map<AuthorityFlag['type'], AuthorityFlag>();

    const heuristicResult = await this.heuristic.check(carrier);
    for (const flag of heuristicResult.flags) {
      flagsByType.set(flag.type, flag);
    }

    const doi = carrier.fields.doi.value;
    if (doi) {
      try {
        const result = await retractionWatchService.check(doi);
        if (result) {
          if (result.retracted) {
            const flag: AuthorityFlag = {
              type: 'retracted',
              source: 'retraction_watch',
            };
            if (result.date) flag.date = result.date;
            flagsByType.set('retracted', flag);
          }
          if (result.expressionOfConcern) {
            const flag: AuthorityFlag = {
              type: 'expression_of_concern',
              source: 'retraction_watch',
            };
            if (result.date) flag.date = result.date;
            flagsByType.set('expression_of_concern', flag);
          }
        }
      } catch {
        // API failure: heuristic flags remain as fallback
      }
    }

    if (carrier.enrichment.crossrefHit) {
      const conflict = detectAuthorConflict(carrier);
      if (conflict) {
        flagsByType.set(conflict.type, conflict);
      }
      const mismatch = detectMetadataMismatch(carrier);
      if (mismatch) {
        flagsByType.set(mismatch.type, mismatch);
      }
    }

    const flags = [...flagsByType.values()];
    let scoreAdjustment = 0;
    for (const flag of flags) {
      scoreAdjustment += SCORE_PENALTY[flag.type] ?? 0;
    }

    return { checked: true, flags, scoreAdjustment };
  }
}

function detectAuthorConflict(carrier: ReferenceCarrier): AuthorityFlag | null {
  const authorField = carrier.fields.authors;

  if (
    authorField.source !== 'enrichment_crossref' ||
    !authorField.previousValue ||
    authorField.previousValue.length === 0
  ) {
    return null;
  }

  const enriched = authorField.value;
  if (enriched.length === 0) return null;

  const prevFirst = authorField.previousValue[0];
  const enrFirst = enriched[0];
  if (!prevFirst || !enrFirst) return null;

  const extractedFirst = prevFirst.family.toLowerCase().trim();
  const enrichedFirst = enrFirst.family.toLowerCase().trim();

  if (!extractedFirst || !enrichedFirst || extractedFirst === enrichedFirst) return null;

  return {
    type: 'author_conflict',
    source: 'crossref_author_verification',
    details: `First-author family name mismatch: extracted "${prevFirst.family}" vs enriched "${enrFirst.family}".`,
  };
}

function detectMetadataMismatch(carrier: ReferenceCarrier): AuthorityFlag | null {
  // A large year jump introduced by enrichment is a strong wrong-record signal (a different
  // edition/work — e.g. a 2019 journal article "corrected" to a 2025 book), even when the
  // title looks similar. Flag it regardless of the title comparison below.
  const yearField = carrier.fields.year;
  if (
    (yearField.source === 'enrichment_crossref' || yearField.source === 'enrichment_openalex') &&
    typeof yearField.value === 'number' &&
    typeof yearField.previousValue === 'number' &&
    Math.abs(yearField.value - yearField.previousValue) > 1
  ) {
    return {
      type: 'metadata_mismatch',
      source: 'provider_metadata_verification',
      details: `Year mismatch: extracted ${yearField.previousValue} vs enriched ${yearField.value} — possible wrong-record match.`,
    };
  }

  // A journal article / conference paper resolving to a BOOK record (a book/chapter DOI, an
  // embedded ISBN, or an enrichment-added ISBN) is a wrong-record match — books don't carry the
  // volume/issue the journal had, so this is exactly the "wrong work, silently accepted" case.
  if (carrier.type.type === 'article-journal' || carrier.type.type === 'conference-paper') {
    const doi = typeof carrier.fields.doi.value === 'string' ? carrier.fields.doi.value : '';
    const doiFromEnrichment =
      carrier.fields.doi.source === 'enrichment_crossref' || carrier.fields.doi.source === 'enrichment_openalex';
    const isbnFromEnrichment =
      (carrier.fields.isbn.source === 'enrichment_crossref' || carrier.fields.isbn.source === 'enrichment_openalex') &&
      typeof carrier.fields.isbn.value === 'string' &&
      carrier.fields.isbn.value.trim().length > 0;
    if ((doiFromEnrichment && /\/book|\/chapter|97[89][\d-]{8,}/i.test(doi)) || isbnFromEnrichment) {
      return {
        type: 'metadata_mismatch',
        source: 'provider_metadata_verification',
        details: `Type mismatch: ${carrier.type.type} resolved to a book record — possible wrong-record match.`,
      };
    }
  }

  const titleField = carrier.fields.title;

  if (
    titleField.source !== 'enrichment_crossref' &&
    titleField.source !== 'enrichment_openalex'
  ) {
    return null;
  }

  if (typeof titleField.previousValue !== 'string' || !titleField.previousValue.trim()) {
    return null;
  }

  const previous = normalizeComparableText(titleField.previousValue);
  const current = normalizeComparableText(titleField.value ?? '');
  if (!previous || !current || previous === current) return null;

  // Phase 8 only overwrites when the provider record agreed with an independent anchor
  // (DOI/year/author), so an enriched title that stays largely similar is a TRUSTED
  // correction — ground truth, not a conflict — and must not demote the citation. Only a
  // wildly-different enriched title (a possible wrong-record match) is worth a review flag.
  if (titleTokenSimilarity(previous, current) >= 0.5) return null;

  return {
    type: 'metadata_mismatch',
    source: 'provider_metadata_verification',
    details: `Title mismatch: extracted "${titleField.previousValue}" vs enriched "${titleField.value}".`,
  };
}

function titleTokenSimilarity(previousNormalized: string, currentNormalized: string): number {
  const previousTokens = new Set(previousNormalized.split(/\s+/).filter(Boolean));
  const currentTokens = new Set(currentNormalized.split(/\s+/).filter(Boolean));
  if (previousTokens.size === 0 || currentTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of previousTokens) if (currentTokens.has(token)) intersection += 1;
  return intersection / (previousTokens.size + currentTokens.size - intersection);
}

export class Phase11Authority implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'authority_validation' as const;
  readonly contractVersion = CONTRACT_VERSION;

  constructor(private readonly checker: AuthorityChecker = new RealAuthorityChecker()) {}

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const startedAt = Date.now();
    let warningCount = 0;
    let budgetExceeded = false;

    await runWithConcurrencyLimit(
      carriers,
      Math.min(env.PIPELINE_MAX_CONCURRENCY, Math.max(1, carriers.length)),
      async (carrier) => {
        if (isStageBudgetExceeded(ctx, this.phaseId, startedAt)) {
          warningCount += 1;
          carrier.authority = {
            checked: false,
            flags: [],
            scoreAdjustment: 0,
            nextRecheckAt: new Date(Date.now() + THIRTY_DAYS_MS),
          };
          carrier.scoring.displayScore = carrier.scoring.rawScore;
          carrier.scoring.breakdown = {
            ...carrier.scoring.breakdown,
            authorityAdjustment: 0,
            rawScore: carrier.scoring.rawScore,
            displayScore: carrier.scoring.rawScore,
          };

          carrier.stageLog.push(
            stageRecord({
              phaseId: this.phaseId,
              status: 'warning',
              durationMs: 0,
              code: ErrorCode.AUTHORITY_RETRACTION_WATCH_TIMEOUT,
              message: 'Authority validation skipped because the phase latency budget was exhausted.',
            }),
          );
          return;
        }

      try {
        const budgeted = await runWithRemainingStageBudget(ctx, this.phaseId, startedAt, () =>
          this.checker.check(carrier),
        );
        if (budgeted.timedOut) {
          budgetExceeded = true;
          throw new Error('Phase budget exceeded.');
        }
        const result = budgeted.value;
        const displayScore = finalizeDisplayScore(carrier.scoring.rawScore, result.scoreAdjustment);

        carrier.authority = {
          checked: result.checked,
          flags: result.flags,
          scoreAdjustment: result.scoreAdjustment,
          nextRecheckAt: new Date(Date.now() + THIRTY_DAYS_MS),
        };
        carrier.scoring.displayScore = displayScore;
        carrier.scoring.breakdown = {
          ...carrier.scoring.breakdown,
          authorityAdjustment: result.scoreAdjustment,
          rawScore: carrier.scoring.rawScore,
          displayScore,
        };

        if (result.flags.some((flag) => flag.type === 'retracted')) {
          carrier.publicStatus = 'needs_action';
        } else if (
          result.flags.some((flag) =>
            flag.type === 'expression_of_concern'
            || flag.type === 'author_conflict'
            || flag.type === 'metadata_mismatch',
          ) &&
          carrier.publicStatus === 'ready'
        ) {
          carrier.publicStatus = 'needs_review';
        }
        applyAuthorityHealthDemotions(carrier, result.flags);

        if (result.flags.length > 0) warningCount += 1;

        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: result.flags.length > 0 ? 'warning' : 'success',
            durationMs: 0,
            ...(
              result.flags.some((flag) => flag.type === 'retracted')
                ? { code: ErrorCode.AUTHORITY_RETRACTED }
                : result.flags.some((flag) => flag.type === 'expression_of_concern')
                  ? { code: ErrorCode.AUTHORITY_EXPRESSION_OF_CONCERN }
                  : {}
            ),
            message: result.flags.length > 0
              ? `Authority validation raised ${result.flags.length} flag(s).`
              : 'Authority validation completed.',
          }),
        );
      } catch (error) {
        warningCount += 1;
        if (error instanceof Error && error.message === 'Phase budget exceeded.') {
          budgetExceeded = true;
        }
        carrier.authority = {
          checked: false,
          flags: [],
          scoreAdjustment: 0,
          nextRecheckAt: new Date(Date.now() + THIRTY_DAYS_MS),
        };
        carrier.scoring.displayScore = carrier.scoring.rawScore;
        carrier.scoring.breakdown = {
          ...carrier.scoring.breakdown,
          authorityAdjustment: 0,
          rawScore: carrier.scoring.rawScore,
          displayScore: carrier.scoring.rawScore,
        };

        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: 'warning',
            durationMs: 0,
            code: error instanceof Error && error.message === 'Phase budget exceeded.'
              ? ErrorCode.AUTHORITY_RETRACTION_WATCH_TIMEOUT
              : ErrorCode.AUTHORITY_RETRACTION_WATCH_ERROR,
            message: error instanceof Error && error.message === 'Phase budget exceeded.'
              ? 'Authority validation stopped for this reference because the phase latency budget was reached.'
              : 'Authority validation failed for this reference and was isolated.',
          }),
        );
      }
      },
    );

    ctx.stageLog.push(
      stageRecord({
        phaseId: this.phaseId,
        status: warningCount > 0 ? 'warning' : 'success',
        durationMs: Date.now() - startedAt,
        ...(warningCount > 0
          ? {
              code: budgetExceeded || isStageBudgetExceeded(ctx, this.phaseId, startedAt)
                ? ErrorCode.AUTHORITY_RETRACTION_WATCH_TIMEOUT
                : ErrorCode.AUTHORITY_RETRACTION_WATCH_ERROR,
            }
          : {}),
        message: budgetExceeded || isStageBudgetExceeded(ctx, this.phaseId, startedAt)
          ? 'Phase 11 reached its latency budget and degraded to local authority handling.'
          : 'Phase 11 authority validation completed.',
      }),
    );

    return carriers;
  }
}

export const phase11Authority = new Phase11Authority();

function applyAuthorityHealthDemotions(
  carrier: ReferenceCarrier,
  flags: AuthorityFlag[],
): void {
  const warnings = [...carrier.health.warnings];
  const reasons = [...carrier.health.reasons];

  for (const flag of flags) {
    if (flag.type === 'retracted') {
      warnings.push(toHealthWarning('authority_retraction_notice', 'retraction notice'));
      reasons.push('retraction notice');
      carrier.health.demotedBy = 'authority';
      continue;
    }

    if (flag.type === 'expression_of_concern') {
      warnings.push(toHealthWarning('authority_expression_of_concern', 'expression of concern'));
      reasons.push('expression of concern');
      carrier.health.demotedBy = 'authority';
      continue;
    }

    if (flag.type === 'author_conflict') {
      warnings.push(toHealthWarning('authority_author_conflict', 'author conflict with external authority'));
      reasons.push('author conflict with external authority');
      carrier.health.demotedBy = 'authority';
      continue;
    }

    if (flag.type === 'metadata_mismatch') {
      warnings.push(toHealthWarning('authority_metadata_mismatch', 'metadata mismatch with external authority'));
      reasons.push('metadata mismatch with external authority');
      carrier.health.demotedBy = 'authority';
    }
  }

  carrier.health.publicStatus = carrier.publicStatus;
  carrier.health.warnings = uniqueHealthWarnings(warnings);
  carrier.health.reasons = [...new Set(reasons)];
}

function normalizeComparableText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
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
