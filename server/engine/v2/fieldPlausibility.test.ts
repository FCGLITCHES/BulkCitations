import { describe, expect, it } from 'vitest';
import { assessAuthors, assessPublisher, assessTitle, assessVenue } from './fieldPlausibility.js';

describe('field plausibility', () => {
  it('flags venue strings that still contain container leakage', () => {
    const assessment = assessVenue({
      bookTitle: 'In Handbook of Methods (pp. 12-34). Springer',
    }, 'chapter');

    expect(assessment.plausible).toBe(false);
    expect(assessment.reason).toBe('venue_contaminated');
    expect(assessment.penalty).toBeGreaterThan(0);
  });

  it('flags title strings that contain DOI-like identifiers', () => {
    const assessment = assessTitle({
      title: 'A testing title 10.1000/example-doi',
    });

    expect(assessment.plausible).toBe(false);
    expect(assessment.reason).toBe('title_contains_identifier');
  });

  it('keeps real titles with years and version-like decimals plausible', () => {
    expect(assessTitle({
      title: 'GPT-5.1 system card',
    }).plausible).toBe(true);

    expect(assessTitle({
      title: 'Global tuberculosis report 2023',
    }).plausible).toBe(true);
  });

  it('flags metadata notes embedded in titles', () => {
    expect(assessTitle({
      title: 'Dose response ranking for translational pharmacology (Report No. APAR-RPT-001)',
    })).toMatchObject({
      plausible: false,
      reason: 'title_contains_metadata_note',
    });
  });

  it('flags postal-style location tails as implausible titles', () => {
    expect(assessTitle({
      title: '071, Yenagoa, Bayelsa State, Nigeria',
    })).toMatchObject({
      plausible: false,
      reason: 'title_looks_like_address_tail',
    });
  });

  it('flags sentence-like author blobs but keeps single-initial inverted authors plausible', () => {
    expect(assessAuthors({
      authors: ['World Health Organization. Global tuberculosis report 2023. Geneva: World Health Organization;'],
    })).toMatchObject({
      plausible: false,
      reason: 'sentence_like_author_blob',
    });

    expect(assessAuthors({
      authors: ['Uecker, H.'],
    }).plausible).toBe(true);

    expect(assessAuthors({
      authors: ['Rossi, L.', 'Al-Harbi, S.', 'Haddad, L.'],
    }).plausible).toBe(true);

    expect(assessAuthors({
      authors: ['Usarralde de Adlerstein, Matilde Nelly'],
    }).plausible).toBe(true);

    expect(assessAuthors({
      authors: ['Usarralde de Adlerstein, M. N.'],
    }).plausible).toBe(true);
  });

  it('flags truncated and version-tailed venues plus malformed publishers', () => {
    expect(assessVenue({
      journal: 'APAR-RPT-',
    }, 'journal')).toMatchObject({
      plausible: false,
      reason: 'venue_truncated_fragment',
    });

    expect(assessVenue({
      journal: 'Drug Evidence Hub, ver',
    }, 'journal')).toMatchObject({
      plausible: false,
      reason: 'venue_contains_version_marker',
    });

    expect(assessVenue({
      journal: 'New York: UN Women; 2019',
    }, 'journal')).toMatchObject({
      plausible: false,
      reason: 'venue_contains_publisher_tail',
    });

    expect(assessPublisher({
      publisher: 'com/research/gpt-5-1',
    })).toMatchObject({
      plausible: false,
      reason: 'publisher_contains_url_fragment',
    });

    expect(assessPublisher({
      publisher: 'New York: UN Women',
    })).toMatchObject({
      plausible: false,
      reason: 'publisher_contains_place_prefix',
    });

    expect(assessPublisher({
      publisher: 'APAR-RPT-002). Amsterdam: Open Metrics Press',
    })).toMatchObject({
      plausible: false,
      reason: 'publisher_contains_metadata_tail',
    });
  });
});
