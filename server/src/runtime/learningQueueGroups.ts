import {
  normalizeExtractionInput,
  stripTrailingIdentifierTailForParsing,
} from '../engine/rawCitationSupport.js';
import { hashInputForTruth } from '../training/truthHash.js';
import type { LearningQueueItem } from './store.js';
import { stripLeadingReferenceNumbering } from '../lib/referenceNumbering.js';

function normalizeComparableCitationText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .replace(/&/gu, ' and ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeLearningQueueRawInputForGrouping(rawInput: string): string {
  const withoutNumbering = stripLeadingReferenceNumbering(rawInput);
  const normalizedInput = normalizeExtractionInput(withoutNumbering);
  const withoutIdentifierTail = stripTrailingIdentifierTailForParsing(normalizedInput);
  // Queue grouping is broader than truth hashing so admins review one work once.
  return normalizeComparableCitationText(withoutIdentifierTail);
}

function rawInputFromQueue(item: LearningQueueItem): string | null {
  const rawInput = item.trainingData.rawInput;
  if (typeof rawInput !== 'string') {
    return null;
  }
  const normalized = normalizeLearningQueueRawInputForGrouping(rawInput);
  return normalized.length > 0 ? normalized : null;
}

function learningQueueGroupKey(item: LearningQueueItem): string {
  const rawInput = rawInputFromQueue(item);
  if (rawInput) {
    return `raw:${hashInputForTruth(rawInput)}`;
  }

  const citationId = item.citationId.trim();
  if (citationId.length > 0) {
    return `citation:${citationId}`;
  }

  return `item:${item.id}`;
}

function compareLearningQueueItems(left: LearningQueueItem, right: LearningQueueItem): number {
  if (left.processed !== right.processed) {
    return left.processed ? 1 : -1;
  }
  if (left.processed && right.processed) {
    const leftProcessedAt = left.processedAt ?? left.createdAt;
    const rightProcessedAt = right.processedAt ?? right.createdAt;
    const processedCompare = rightProcessedAt.localeCompare(leftProcessedAt);
    if (processedCompare !== 0) {
      return processedCompare;
    }
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  const createdCompare = right.createdAt.localeCompare(left.createdAt);
  if (createdCompare !== 0) {
    return createdCompare;
  }
  return left.id.localeCompare(right.id);
}

function uniqueGroupedSources(
  items: readonly LearningQueueItem[],
): Array<'user_edit' | 'user_report'> {
  const sources = new Set<'user_edit' | 'user_report'>();
  for (const item of items) {
    sources.add(item.source);
  }
  return [...sources].sort();
}

export function groupLearningQueueItems(
  items: readonly LearningQueueItem[],
): LearningQueueItem[] {
  const grouped = new Map<string, LearningQueueItem[]>();

  for (const item of items) {
    const key = learningQueueGroupKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  const result: LearningQueueItem[] = [];
  for (const itemsInGroup of grouped.values()) {
    const sorted = [...itemsInGroup].sort(compareLearningQueueItems);
    const representative = sorted[0]!;
    const promotedToTruthId =
      sorted.find((item) => typeof item.promotedToTruthId === 'string' && item.promotedToTruthId.length > 0)
        ?.promotedToTruthId
      ?? null;

    result.push({
      ...representative,
      priority: Math.max(...sorted.map((item) => item.priority)),
      processed: sorted.every((item) => item.processed),
      processedAt: sorted
        .map((item) => item.processedAt)
        .filter((processedAt): processedAt is string => typeof processedAt === 'string' && processedAt.length > 0)
        .sort((left, right) => right.localeCompare(left))[0] ?? null,
      createdAt: sorted[0]!.createdAt,
      promotedToTruthId,
      duplicateCount: sorted.length,
      groupedQueueIds: sorted.map((item) => item.id),
      groupedSources: uniqueGroupedSources(sorted),
    });
  }

  return result.sort(compareLearningQueueItems);
}
