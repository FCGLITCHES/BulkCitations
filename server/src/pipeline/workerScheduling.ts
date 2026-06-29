export interface WeightedWorkerAssignment<T> {
  workerIndex: number;
  totalWeight: number;
  items: T[];
}

interface IndexedWeightedItem<T> {
  item: T;
  index: number;
  weight: number;
}

export function createWeightedWorkerAssignments<T>(
  items: readonly T[],
  workerCount: number,
  getWeight: (item: T) => number,
): WeightedWorkerAssignment<T>[] {
  if (items.length === 0) {
    return [];
  }

  const normalizedWorkerCount = Math.max(1, Math.min(workerCount, items.length));
  const buckets = Array.from({ length: normalizedWorkerCount }, (_, workerIndex) => ({
    workerIndex,
    totalWeight: 0,
    items: [] as T[],
  }));

  const weightedItems: IndexedWeightedItem<T>[] = items
    .map((item, index) => ({
      item,
      index,
      weight: Math.max(0, getWeight(item)),
    }))
    .sort((left, right) => right.weight - left.weight || left.index - right.index);

  for (const weightedItem of weightedItems) {
    const bucket = buckets.reduce((best, current) => {
      if (current.totalWeight < best.totalWeight) {
        return current;
      }
      if (current.totalWeight === best.totalWeight && current.workerIndex < best.workerIndex) {
        return current;
      }
      return best;
    });
    bucket.items.push(weightedItem.item);
    bucket.totalWeight += weightedItem.weight;
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
}
