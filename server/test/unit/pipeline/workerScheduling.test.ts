import { describe, expect, it } from 'vitest';

import { createWeightedWorkerAssignments } from '../../../src/pipeline/workerScheduling.js';

describe('worker scheduling', () => {
  it('balances weighted work across workers deterministically', () => {
    const assignments = createWeightedWorkerAssignments(
      [
        { id: 'group-a', weight: 2 },
        { id: 'group-b', weight: 5 },
        { id: 'group-c', weight: 3 },
        { id: 'group-d', weight: 1 },
      ],
      2,
      (item) => item.weight,
    );

    expect(assignments.map((assignment) => assignment.totalWeight)).toEqual([6, 5]);
    expect(assignments[0]?.items.map((item) => item.id)).toEqual(['group-b', 'group-d']);
    expect(assignments[1]?.items.map((item) => item.id)).toEqual(['group-c', 'group-a']);
  });

  it('breaks equal-load ties by lower worker index', () => {
    const assignments = createWeightedWorkerAssignments(
      [
        { id: 'item-a', weight: 1 },
        { id: 'item-b', weight: 1 },
        { id: 'item-c', weight: 1 },
      ],
      2,
      (item) => item.weight,
    );

    expect(assignments[0]?.items.map((item) => item.id)).toEqual(['item-a', 'item-c']);
    expect(assignments[1]?.items.map((item) => item.id)).toEqual(['item-b']);
  });
});
