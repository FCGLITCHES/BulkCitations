import type { RawBlock } from "../engine/types/ingestion.js";

interface SemanticBlockBundle {
  key: string;
  blocks: RawBlock[];
}

export function chunkBlocksPreservingSemanticGroups(
  blocks: RawBlock[],
  size: number,
): RawBlock[][] {
  if (size <= 0 || blocks.length === 0) {
    return blocks.length > 0 ? [blocks] : [];
  }

  const bundles = buildSemanticBlockBundles(blocks);
  const batches: RawBlock[][] = [];
  let currentBatch: RawBlock[] = [];

  for (const bundle of bundles) {
    if (currentBatch.length > 0 && currentBatch.length + bundle.blocks.length > size) {
      batches.push(currentBatch);
      currentBatch = [];
    }

    currentBatch.push(...bundle.blocks);

    if (currentBatch.length >= size) {
      batches.push(currentBatch);
      currentBatch = [];
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function buildSemanticBlockBundles(blocks: RawBlock[]): SemanticBlockBundle[] {
  const bundles: SemanticBlockBundle[] = [];
  let current: SemanticBlockBundle | null = null;

  for (const block of blocks) {
    const key = block.semanticGroupKey ?? `__block__:${block.index}`;
    if (!current || current.key !== key) {
      current = {
        key,
        blocks: [block],
      };
      bundles.push(current);
      continue;
    }

    current.blocks.push(block);
  }

  return bundles;
}
