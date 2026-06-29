import { describe, expect, it } from 'vitest';
import {
  groupLearningQueueItems,
  normalizeLearningQueueRawInputForGrouping,
} from '../../../src/runtime/learningQueueGroups.js';
import type { LearningQueueItem } from '../../../src/runtime/store.js';

function buildQueueItem(input: {
  id: string;
  rawInput: string;
  source?: 'user_edit' | 'user_report';
  priority?: number;
  processed?: boolean;
  processedAt?: string | null;
  createdAt?: string;
}): LearningQueueItem {
  return {
    id: input.id,
    citationId: '',
    jobId: '',
    source: input.source ?? 'user_report',
    priority: input.priority ?? 1,
    trainingData: {
      rawInput: input.rawInput,
    },
    processed: input.processed ?? false,
    processedAt: input.processedAt ?? null,
    createdAt: input.createdAt ?? '2026-04-23T00:00:00.000Z',
    promotedToTruthId: null,
  };
}

describe('learningQueueGroups', () => {
  it('normalizes numbered-list markers into a citation-comparable grouping key', () => {
    const expected =
      'kumar a kini sg rathi e a recent appraisal of artificial intelligence';

    expect(
      normalizeLearningQueueRawInputForGrouping(
        '22. Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.',
      ),
    ).toBe(expected);
    expect(
      normalizeLearningQueueRawInputForGrouping(
        '[22] Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.',
      ),
    ).toBe(expected);
    expect(
      normalizeLearningQueueRawInputForGrouping(
        'No. 22. Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence.',
      ),
    ).toBe(expected);
    expect(
      normalizeLearningQueueRawInputForGrouping(
        '2021. Artificial intelligence in drug discovery remains a fast-moving field.',
      ),
    ).toBe(
      '2021 artificial intelligence in drug discovery remains a fast moving field',
    );
  });

  it('normalizes trailing identifier-tail variants of the same citation into the same grouping key', () => {
    const plainReference =
      'Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800.';
    const variants = [
      '22. Kumar A, Kini SG, Rathi E: A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021, 21:2788-800. 10.2174/1389557521666210401091147',
      '22. Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800. doi:10.2174/1389557521666210401091147',
      '22. Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800. https://doi.org/10.2174/1389557521666210401091147',
      '22. Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800. Available at: https://example.org/kumar-admet',
      '22. Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800. Retrieved from https://example.org/kumar-admet',
    ];

    const plainNormalized = normalizeLearningQueueRawInputForGrouping(plainReference);

    for (const variant of variants) {
      const normalized = normalizeLearningQueueRawInputForGrouping(variant);
      expect(normalized).toBe(plainNormalized);
      expect(normalized).not.toContain('10 2174');
      expect(normalized).not.toContain('doi');
      expect(normalized).not.toContain('https');
      expect(normalized).not.toContain('available at');
      expect(normalized).not.toContain('retrieved from');
    }
  });

  it('groups numbered and identifier-tail variants into one queue item', () => {
    const plainReference =
      'Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800.';
    const numberedReferenceWithDoi =
      '22. Kumar A, Kini SG, Rathi E: A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021, 21:2788-800. 10.2174/1389557521666210401091147';
    const numberedReferenceWithUrl =
      '22. Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800. Available at: https://example.org/kumar-admet';

    const grouped = groupLearningQueueItems([
      buildQueueItem({
        id: 'queue-numbered',
        rawInput: numberedReferenceWithDoi,
        source: 'user_report',
        priority: 1,
        createdAt: '2026-04-23T00:00:00.000Z',
      }),
      buildQueueItem({
        id: 'queue-plain',
        rawInput: plainReference,
        source: 'user_edit',
        priority: 2,
        createdAt: '2026-04-23T00:00:01.000Z',
      }),
      buildQueueItem({
        id: 'queue-url',
        rawInput: numberedReferenceWithUrl,
        source: 'user_report',
        priority: 1,
        createdAt: '2026-04-23T00:00:02.000Z',
      }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      id: 'queue-plain',
      duplicateCount: 3,
      groupedQueueIds: ['queue-plain', 'queue-url', 'queue-numbered'],
      groupedSources: ['user_edit', 'user_report'],
      processed: false,
    });
  });

  it('does not group clearly different citations that only share a numbering pattern', () => {
    const grouped = groupLearningQueueItems([
      buildQueueItem({
        id: 'queue-kumar',
        rawInput:
          '22. Kumar A, Kini SG, Rathi E. A recent appraisal of artificial intelligence and in silico ADMET prediction in the early stages of drug discovery. Mini Rev Med Chem. 2021;21:2788-800.',
      }),
      buildQueueItem({
        id: 'queue-different',
        rawInput:
          '23. Smith J, Doe A. A different article title. Journal of Testing. 2021;5(2):10-12.',
      }),
    ]);

    expect(grouped).toHaveLength(2);
  });

  it('sorts processed queue groups by the most recent processed timestamp', () => {
    const grouped = groupLearningQueueItems([
      buildQueueItem({
        id: 'older-processed',
        rawInput: 'Older A. Processed reference. Journal. 2024;1:1-2.',
        processed: true,
        processedAt: '2026-04-23T12:00:00.000Z',
        createdAt: '2026-04-23T00:00:00.000Z',
      }),
      buildQueueItem({
        id: 'newer-processed',
        rawInput: 'Newer A. Processed reference. Journal. 2024;1:1-2.',
        processed: true,
        processedAt: '2026-04-24T12:00:00.000Z',
        createdAt: '2026-04-23T00:00:00.000Z',
      }),
      buildQueueItem({
        id: 'pending-high-priority',
        rawInput: 'Pending A. Pending reference. Journal. 2024;1:1-2.',
        priority: 100,
        createdAt: '2026-04-23T00:00:00.000Z',
      }),
    ]);

    expect(grouped.map((item) => item.id)).toEqual([
      'pending-high-priority',
      'newer-processed',
      'older-processed',
    ]);
  });

  it('uses the newest processed timestamp when summarizing duplicate processed groups', () => {
    const grouped = groupLearningQueueItems([
      buildQueueItem({
        id: 'processed-variant-old',
        rawInput: '1. Example A. Duplicate processed reference. Journal. 2024;1:1-2.',
        processed: true,
        processedAt: '2026-04-22T12:00:00.000Z',
      }),
      buildQueueItem({
        id: 'processed-variant-new',
        rawInput: 'Example A. Duplicate processed reference. Journal. 2024;1:1-2.',
        processed: true,
        processedAt: '2026-04-24T12:00:00.000Z',
      }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      processed: true,
      processedAt: '2026-04-24T12:00:00.000Z',
      duplicateCount: 2,
    });
  });
});
