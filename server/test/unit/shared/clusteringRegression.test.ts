import { describe, expect, it } from 'vitest';
import {
  calculateCitationSimilarity,
  clusterCitations,
  type ConvertedReference,
  type ParsedReference,
} from '../../../../frontend/shared/clustering.js';

function makeReference(id: string, parsedData: ParsedReference): ConvertedReference {
  return {
    id,
    originalText: parsedData.title ?? `original-${id}`,
    convertedText: parsedData.title ?? `converted-${id}`,
    referenceType: 'journal',
    parsedData,
    inputStyle: 'auto',
    outputStyle: 'apa',
  };
}

describe('clustering regression', () => {
  it('treats Vancouver initials and comma-formatted authors as equivalent family names', () => {
    const vancouver: ParsedReference = {
      authors: ['Smith JA', 'Doe AB'],
      title: 'Applications of machine learning in drug discovery',
      journal: 'Drug Discovery Today',
      year: '2021',
    };
    const commaFormatted: ParsedReference = {
      authors: ['Smith, J. A.', 'Doe, A. B.'],
      title: 'Applications of machine learning in drug discovery',
      journal: 'Drug Discovery Today',
      year: '2021',
    };

    expect(calculateCitationSimilarity(vancouver, commaFormatted)).toBeGreaterThanOrEqual(95);
  });

  it('clusters equivalent Vancouver and comma-formatted references together', () => {
    const references: ConvertedReference[] = [
      makeReference('r1', {
        authors: ['Smith JA', 'Doe AB'],
        title: 'Applications of machine learning in drug discovery',
        journal: 'Drug Discovery Today',
        year: '2021',
        volume: '26',
        pages: '80-93',
      }),
      makeReference('r2', {
        authors: ['Smith, J. A.', 'Doe, A. B.'],
        title: 'Applications of machine learning in drug discovery',
        journal: 'Drug Discovery Today',
        year: '2021',
        volume: '26',
        pages: '80-93',
      }),
    ];

    const clusters = clusterCitations(references, 85);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members).toHaveLength(2);
    expect(references[0]?.clusterId).toBeUndefined();
    expect(references[1]?.clusterId).toBeUndefined();
    expect(clusters[0]?.members[0]?.clusterId).toBeDefined();
    expect(clusters[0]?.members[1]?.clusterId).toBeDefined();
  });
});
