import { describe, expect, it } from 'vitest';
import { buildReferenceSignatureIssues } from './contaminationDetector.js';

describe('contaminationDetector', () => {
  it('flags embedded references and multiple raw clusters', () => {
    const issues = buildReferenceSignatureIssues({
      raw: 'Smith, J. (2020). First title. https://doi.org/10.1000/abc. Doe, R. (2021). Second title. https://doi.org/10.1000/def',
      title: 'First title. Doe, R. (2021) Second title',
      venue: 'Journal of Testing',
      venueField: 'journal',
    });

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'embedded_reference_start_in_title',
      'multiple_doi_clusters',
      'multiple_year_anchor_clusters',
    ]));
  });
});
