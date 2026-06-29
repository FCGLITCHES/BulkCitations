import type { ReferenceCarrier } from '../types/carrier.js';
import type { PipelineContext, PipelineStage, StageRunRecord } from '../types/pipeline.js';
import { synthesizeCandidateEnvelope } from '../reliability.js';
import { emptyField, fieldOf } from '../types/field.js';
import type { ExtractedFields } from '../types/citation.js';
import { hasFieldValue, setExtractedField } from '../utils/fields.js';
import { lookupIssnByJournalTitle } from '../data/journalIssnHints.js';
import { recoverArticleContainerSpill } from '../utils/articleContainer.js';

const CONTRACT_VERSION = 1;
export const PHASE6_8_SHARED_REPAIR_STAGE_ID = 'phase6_8_shared_repair';
const ARTICLE_CONTAINER_CUE_REGEX =
  /\b(?:journal|review|revista|annals?|letters?|transactions?|bulletin|law review|studies|archives?)\b/iu;
const CONFERENCE_CUE_REGEX =
  /\b(?:conference|symposium|workshop|congress|meeting|proceedings|proc\.?|anais|seminar|forum)\b/iu;
const EVENTISH_CONFERENCE_TITLE_REGEX =
  /\b(?:[A-Z][a-z]+\d{1,4}|[A-Z]{2,}\d{1,4}|\d{1,3}(?:st|nd|rd|th))\b|[-:]\s+[A-Z]/u;

export interface SharedRepairApplyOptions {
  suppressContextStageLog?: boolean;
}

export interface SharedRepairStats {
  proposedMoveCount: number;
  durationMs: number;
}

export class Phase6_8SharedRepair implements PipelineStage<ReferenceCarrier[], ReferenceCarrier[]> {
  readonly phaseId = 'shared_repair' as const;
  readonly contractVersion = CONTRACT_VERSION;

  async run(carriers: ReferenceCarrier[], ctx: PipelineContext): Promise<ReferenceCarrier[]> {
    const result = await this.apply(carriers, ctx);
    return result.carriers;
  }

  async apply(
    carriers: ReferenceCarrier[],
    ctx: PipelineContext,
    options: SharedRepairApplyOptions = {},
  ): Promise<{ carriers: ReferenceCarrier[]; stats: SharedRepairStats }> {
    const startedAt = Date.now();
    const captureCarrierDiagnostics = ctx.executionPolicy.debugMode !== 'off';
    let proposedMoveCount = 0;

    for (const carrier of carriers) {
      carrier.candidateEnvelope ??= synthesizeCandidateEnvelope(carrier);
      const proposedMoves = buildProposedMoves(carrier);
      const proposedSuppressions = buildProposedSuppressions(carrier);
      const appliedPrimaryRepairs = applyPrimaryRepairs(carrier, proposedMoves);
      proposedMoveCount += proposedMoves.length;
      carrier.candidateEnvelope = synthesizeCandidateEnvelope(carrier);
      carrier.sharedRepairShadow = {
        proposedMoves,
        proposedSuppressions,
      };

      if (captureCarrierDiagnostics) {
        carrier.stageLog.push(
          stageRecord({
            phaseId: this.phaseId,
            status: proposedMoves.length > 0 || proposedSuppressions.length > 0 ? 'warning' : 'success',
            durationMs: 0,
            message:
              proposedMoves.length > 0 || proposedSuppressions.length > 0
                ? appliedPrimaryRepairs > 0
                  ? `SharedRepair applied ${appliedPrimaryRepairs} primary repair(s) and shadowed ${proposedMoves.length} move(s) plus ${proposedSuppressions.length} suppression(s).`
                  : `SharedRepair shadow proposed ${proposedMoves.length} move(s) and ${proposedSuppressions.length} suppression(s).`
                : 'SharedRepair found no structural repair candidates.',
            details: {
              appliedPrimaryRepairs,
              proposedMoves,
              proposedSuppressions,
            },
          }),
        );
      }
    }

    const stats: SharedRepairStats = {
      proposedMoveCount,
      durationMs: Date.now() - startedAt,
    };

    if (!options.suppressContextStageLog) {
      ctx.stageLog.push(createSharedRepairSummaryRecord(stats));
    }

    return { carriers, stats };
  }
}

export const phase6_8SharedRepair = new Phase6_8SharedRepair();

export function createSharedRepairSummaryRecord(
  stats: SharedRepairStats,
): StageRunRecord {
  return stageRecord({
    phaseId: 'shared_repair',
    status: stats.proposedMoveCount > 0 ? 'warning' : 'success',
    durationMs: stats.durationMs,
    message:
      stats.proposedMoveCount > 0
        ? `SharedRepair shadow surfaced ${stats.proposedMoveCount} proposed move(s).`
        : 'SharedRepair shadow completed without structural repair proposals.',
  });
}

function buildProposedMoves(carrier: ReferenceCarrier): ReferenceCarrier['fieldMoveLedger'] {
  const proposedMoves: ReferenceCarrier['fieldMoveLedger'] = [];
  const title = typeof carrier.fields.title.value === 'string' ? carrier.fields.title.value : '';
  const conferenceTitle = typeof carrier.fields.conferenceTitle.value === 'string'
    ? carrier.fields.conferenceTitle.value
    : '';
  const bookTitle = typeof carrier.fields.bookTitle.value === 'string'
    ? carrier.fields.bookTitle.value
    : '';
  const publisher = typeof carrier.fields.publisher.value === 'string'
    ? carrier.fields.publisher.value
    : '';
  const conferenceProfile =
    Boolean(
      conferenceTitle
      && conferenceTitle !== title
      && (
        CONFERENCE_CUE_REGEX.test(conferenceTitle)
        || EVENTISH_CONFERENCE_TITLE_REGEX.test(conferenceTitle)
      ),
    )
    || CONFERENCE_CUE_REGEX.test(carrier.raw);
  const hasStrongArticleLocators =
    hasFieldValue(carrier.fields.volume)
    || hasFieldValue(carrier.fields.issue)
    || hasFieldValue(carrier.fields.issn);
  const bookTitleArticleSpill = recoverArticleContainerSpill(bookTitle);
  const hasArticleSupport =
    hasStrongArticleLocators
    || hasFieldValue(carrier.fields.pages)
    || hasFieldValue(carrier.fields.doi)
    || Boolean(bookTitleArticleSpill?.issnHint);

  if (
    carrier.type.type === 'article-journal'
    && !carrier.fields.journal.value
    && conferenceTitle
    && hasStrongArticleLocators
    && !CONFERENCE_CUE_REGEX.test(conferenceTitle)
    && (
      typeof carrier.fields.issn.value === 'string'
      || (
      ARTICLE_CONTAINER_CUE_REGEX.test(conferenceTitle)
        || Boolean(lookupIssnByJournalTitle(conferenceTitle))
      )
    )
  ) {
    proposedMoves.push({
      phaseId: 'shared_repair',
      reasonCode: 'conference_container_journal_repair',
      sourceField: 'conferenceTitle',
      destinationField: 'journal',
      action: 'mutate',
      previousValue: conferenceTitle,
      nextValue: conferenceTitle,
      beforeConfidence: carrier.fields.conferenceTitle.confidence,
      afterConfidence: carrier.fields.conferenceTitle.confidence,
    });
  }

  if (
    carrier.type.type === 'article-journal'
    && !carrier.fields.journal.value
    && publisher
    && hasStrongArticleLocators
    && !conferenceProfile
    && !/\b(?:press|publisher|publishing|imprint|springer|elsevier|wiley|sage)\b/iu.test(publisher)
  ) {
    proposedMoves.push({
      phaseId: 'shared_repair',
      reasonCode: 'publisher_to_journal_repair',
      sourceField: 'publisher',
      destinationField: 'journal',
      action: 'mutate',
      previousValue: publisher,
      nextValue: publisher,
      beforeConfidence: carrier.fields.publisher.confidence,
      afterConfidence: carrier.fields.publisher.confidence,
    });
  }

  if (
    carrier.type.type === 'article-journal'
    && !carrier.fields.journal.value
    && bookTitleArticleSpill
    && hasArticleSupport
  ) {
    proposedMoves.push({
      phaseId: 'shared_repair',
      reasonCode: 'book_container_journal_repair',
      sourceField: 'bookTitle',
      destinationField: 'journal',
      action: 'mutate',
      previousValue: bookTitle,
      nextValue: bookTitleArticleSpill.journal,
      beforeConfidence: carrier.fields.bookTitle.confidence,
      afterConfidence: carrier.fields.bookTitle.confidence,
    });

    if (!hasFieldValue(carrier.fields.volume) && bookTitleArticleSpill.volume) {
      proposedMoves.push({
        phaseId: 'shared_repair',
        reasonCode: 'book_container_volume_repair',
        sourceField: 'bookTitle',
        destinationField: 'volume',
        action: 'set',
        previousValue: bookTitle,
        nextValue: bookTitleArticleSpill.volume,
        beforeConfidence: carrier.fields.bookTitle.confidence,
        afterConfidence: carrier.fields.bookTitle.confidence,
      });
    }

    if (!hasFieldValue(carrier.fields.issue) && bookTitleArticleSpill.issue) {
      proposedMoves.push({
        phaseId: 'shared_repair',
        reasonCode: 'book_container_issue_repair',
        sourceField: 'bookTitle',
        destinationField: 'issue',
        action: 'set',
        previousValue: bookTitle,
        nextValue: bookTitleArticleSpill.issue,
        beforeConfidence: carrier.fields.bookTitle.confidence,
        afterConfidence: carrier.fields.bookTitle.confidence,
      });
    }

    if (!hasFieldValue(carrier.fields.issn) && bookTitleArticleSpill.issnHint) {
      proposedMoves.push({
        phaseId: 'shared_repair',
        reasonCode: 'book_container_issn_repair',
        sourceField: 'bookTitle',
        destinationField: 'issn',
        action: 'set',
        previousValue: bookTitle,
        nextValue: bookTitleArticleSpill.issnHint,
        beforeConfidence: carrier.fields.bookTitle.confidence,
        afterConfidence: carrier.fields.bookTitle.confidence,
      });
    }
  }

  if (title && /(?:https?:\/\/|doi:\s*10\.)/iu.test(title)) {
    const tail = title.match(/(?:https?:\/\/|doi:\s*10\.)\S.*$/iu)?.[0]?.trim();
    if (tail) {
      proposedMoves.push({
        phaseId: 'shared_repair',
        reasonCode: 'title_tail_identifier_repair',
        sourceField: 'titleTail',
        destinationField: tail.startsWith('http') ? 'url' : 'doi',
        action: 'mutate',
        previousValue: title,
        nextValue: tail,
        beforeConfidence: carrier.fields.title.confidence,
        afterConfidence: carrier.fields.title.confidence,
      });
    }
  }

  return proposedMoves;
}

function applyPrimaryRepairs(
  carrier: ReferenceCarrier,
  proposedMoves: ReferenceCarrier['fieldMoveLedger'],
): number {
  let applied = 0;
  let clearBookTitleAfterRepair = false;

  for (const move of proposedMoves) {
    if (
      move.reasonCode !== 'conference_container_journal_repair'
      && move.reasonCode !== 'publisher_to_journal_repair'
      && move.reasonCode !== 'book_container_journal_repair'
      && move.reasonCode !== 'book_container_volume_repair'
      && move.reasonCode !== 'book_container_issue_repair'
      && move.reasonCode !== 'book_container_issn_repair'
    ) {
      continue;
    }

    const sourceField = move.sourceField;
    if (
      sourceField !== 'conferenceTitle'
      && sourceField !== 'publisher'
      && sourceField !== 'journal'
      && sourceField !== 'bookTitle'
    ) {
      continue;
    }

    if (carrier.type.type !== 'article-journal') {
      continue;
    }

    if (typeof move.nextValue !== 'string' || move.nextValue.trim().length === 0) {
      continue;
    }

    if (move.reasonCode === 'conference_container_journal_repair' || move.reasonCode === 'publisher_to_journal_repair') {
      if (hasFieldValue(carrier.fields.journal)) {
        continue;
      }

      const source = carrier.fields[sourceField];
      if (!hasFieldValue(source) || typeof source.value !== 'string') {
        continue;
      }

      carrier.fields.journal = fieldOf(
        source.value.trim(),
        'shared_repair',
        PHASE6_8_SHARED_REPAIR_STAGE_ID,
        Math.max(source.confidence, 0.9),
        {
          origin: source.origin,
          uncertain: false,
          previousValue: carrier.fields.journal.value,
          previousSource: carrier.fields.journal.source,
          previousOrigin: carrier.fields.journal.origin,
        },
      );

      if (sourceField !== 'journal') {
        carrier.fields[sourceField] = emptyField(PHASE6_8_SHARED_REPAIR_STAGE_ID, 'shared_repair');
      }

      applied += 1;
      continue;
    }

    if (move.reasonCode === 'book_container_journal_repair') {
      if (hasFieldValue(carrier.fields.journal)) {
        continue;
      }
      applyStringRepairField(carrier, 'journal', move.nextValue.trim(), Math.max(move.afterConfidence ?? 0.9, 0.9));
      clearBookTitleAfterRepair = true;
      applied += 1;
      continue;
    }

    if (move.reasonCode === 'book_container_volume_repair' && !hasFieldValue(carrier.fields.volume)) {
      applyStringRepairField(carrier, 'volume', move.nextValue.trim(), Math.max(move.afterConfidence ?? 0.88, 0.88));
      applied += 1;
      continue;
    }

    if (move.reasonCode === 'book_container_issue_repair' && !hasFieldValue(carrier.fields.issue)) {
      applyStringRepairField(carrier, 'issue', move.nextValue.trim(), Math.max(move.afterConfidence ?? 0.88, 0.88));
      applied += 1;
      continue;
    }

    if (move.reasonCode === 'book_container_issn_repair' && !hasFieldValue(carrier.fields.issn)) {
      applyStringRepairField(carrier, 'issn', move.nextValue.trim(), Math.max(move.afterConfidence ?? 0.9, 0.9));
      applied += 1;
    }
  }

  if (clearBookTitleAfterRepair) {
    carrier.fields.bookTitle = emptyField(PHASE6_8_SHARED_REPAIR_STAGE_ID, 'shared_repair');
  }

  return applied;
}

function buildProposedSuppressions(carrier: ReferenceCarrier): string[] {
  const suppressions: string[] = [];
  if (
    carrier.type.type === 'article-journal'
    && carrier.fields.publisher.value
    && carrier.fields.journal.value
    && JSON.stringify(carrier.fields.publisher.value) === JSON.stringify(carrier.fields.journal.value)
  ) {
    suppressions.push('duplicate_publisher_container');
  }

  if (
    carrier.type.type === 'webpage'
    && carrier.fields.conferenceTitle.value
    && carrier.fields.siteName.value
    && JSON.stringify(carrier.fields.conferenceTitle.value) === JSON.stringify(carrier.fields.siteName.value)
  ) {
    suppressions.push('web_spill_conference_title');
  }

  return suppressions;
}

function stageRecord(
  record: Omit<StageRunRecord, 'stageId' | 'contractVersion'>,
): StageRunRecord {
  return {
    stageId: PHASE6_8_SHARED_REPAIR_STAGE_ID,
    contractVersion: CONTRACT_VERSION,
    ...record,
  };
}

function applyStringRepairField(
  carrier: ReferenceCarrier,
  field: 'journal' | 'volume' | 'issue' | 'issn',
  value: string,
  confidence: number,
): void {
  setExtractedField(
    carrier.fields,
    field,
    fieldOf(
      value,
      'shared_repair',
      PHASE6_8_SHARED_REPAIR_STAGE_ID,
      confidence,
      {
        origin: carrier.fields[field].origin,
        uncertain: false,
        previousValue: carrier.fields[field].value as ExtractedFields[typeof field]['value'],
        previousSource: carrier.fields[field].source,
        previousOrigin: carrier.fields[field].origin,
      },
    ) as ExtractedFields[typeof field],
  );
}
