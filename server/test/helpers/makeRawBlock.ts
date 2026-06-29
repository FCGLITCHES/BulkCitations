import type { RawBlock } from '../../src/engine/types/ingestion.js';

export function makeRawBlock(
  text: string,
  overrides: Partial<RawBlock> = {},
): RawBlock {
  return {
    index: 0,
    text,
    splitMethod: 'numbered',
    splitConfidence: 0.95,
    isDoiResolved: false,
    flags: [],
    ...overrides,
  };
}
