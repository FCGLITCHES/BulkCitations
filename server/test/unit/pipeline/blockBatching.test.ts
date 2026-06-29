import { describe, expect, it } from 'vitest';

import type { RawBlock } from '../../../src/engine/types/ingestion.js';
import { chunkBlocksPreservingSemanticGroups } from '../../../src/pipeline/blockBatching.js';

function makeBlock(index: number, semanticGroupKey?: string): RawBlock {
  return {
    index,
    text: `Block ${index}`,
    ...(semanticGroupKey ? { semanticGroupKey } : {}),
    formatMeta: {
      sourceType: 'text',
      structure: 'structured',
      detectedFormat: 'plain_text',
      formatConfidence: 1,
    },
    splitMethod: 'blank_line',
    splitConfidence: 1,
    isDoiResolved: false,
    flags: [],
    splitReason: 'unit_test',
    blockFormat: 'plain_text',
    boundarySignals: ['unit_test'],
  };
}

describe('semantic block batching', () => {
  it('keeps semantic groups intact when chunk boundaries would otherwise split them', () => {
    const batches = chunkBlocksPreservingSemanticGroups(
      [
        makeBlock(0, 'record-a:clean'),
        makeBlock(1, 'record-a:clean'),
        makeBlock(2, 'record-a:clean'),
        makeBlock(3, 'record-b:clean'),
        makeBlock(4, 'record-b:clean'),
        makeBlock(5, 'record-c:clean'),
      ],
      4,
    );

    expect(batches.map((batch) => batch.map((block) => block.semanticGroupKey ?? null))).toEqual([
      ['record-a:clean', 'record-a:clean', 'record-a:clean'],
      ['record-b:clean', 'record-b:clean', 'record-c:clean'],
    ]);
  });

  it('keeps oversized semantic groups together instead of slicing them apart', () => {
    const batches = chunkBlocksPreservingSemanticGroups(
      [
        makeBlock(0, 'record-a:noisy'),
        makeBlock(1, 'record-a:noisy'),
        makeBlock(2, 'record-a:noisy'),
        makeBlock(3, 'record-a:noisy'),
        makeBlock(4, 'record-a:noisy'),
        makeBlock(5, 'record-b:noisy'),
      ],
      4,
    );

    expect(batches).toHaveLength(2);
    expect(batches[0]?.map((block) => block.semanticGroupKey ?? null)).toEqual([
      'record-a:noisy',
      'record-a:noisy',
      'record-a:noisy',
      'record-a:noisy',
      'record-a:noisy',
    ]);
    expect(batches[1]?.map((block) => block.semanticGroupKey ?? null)).toEqual([
      'record-b:noisy',
    ]);
  });
});
