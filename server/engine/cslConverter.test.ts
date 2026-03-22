import { beforeAll, describe, expect, it } from 'vitest';
import { formatCSLData, initCSLStyles, parsedReferenceToCSL } from './cslConverter.js';

describe('cslConverter formatter reuse', () => {
  beforeAll(() => {
    initCSLStyles();
  });

  it('keeps repeated APA renders stable across different citations', () => {
    const first = parsedReferenceToCSL({
      authors: ['Smith, J.'],
      title: 'Stable formatter reuse',
      year: '2020',
      journal: 'Journal of Quality',
      volume: '10',
      issue: '2',
      pages: '11-19',
      doi: '10.1000/example-one',
    }, 'journal', 'first');
    const second = parsedReferenceToCSL({
      authors: ['Jones, R.'],
      title: 'Second citation',
      year: '2021',
      journal: 'Journal of Testing',
      volume: '12',
      issue: '1',
      pages: '20-29',
      doi: '10.1000/example-two',
    }, 'journal', 'second');

    const firstOutput = formatCSLData(first, 'apa', { includeDoi: false });
    const secondOutput = formatCSLData(second, 'apa', { includeDoi: false });
    const firstOutputAgain = formatCSLData(first, 'apa', { includeDoi: false });

    expect(firstOutputAgain).toBe(firstOutput);
    expect(secondOutput).toContain('Second citation');
    expect(firstOutputAgain).toContain('Stable formatter reuse');
  });

  it('does not leak style state when switching templates between calls', () => {
    const cslData = parsedReferenceToCSL({
      authors: ['Page, M. J.'],
      title: 'The PRISMA 2020 statement',
      year: '2021',
      journal: 'BMJ',
      volume: '372',
      'article-number': 'n71',
    }, 'journal', 'prisma');

    const apa = formatCSLData(cslData, 'apa', { includeDoi: false });
    const ieee = formatCSLData(cslData, 'ieee', { includeDoi: false });
    const apaAgain = formatCSLData(cslData, 'apa', { includeDoi: false });

    expect(apaAgain).toBe(apa);
    expect(ieee).not.toBe(apa);
    expect(apaAgain).toContain('PRISMA 2020 statement');
  });
});
