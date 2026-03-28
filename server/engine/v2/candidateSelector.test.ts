import { describe, expect, it } from 'vitest';
import type { CanonicalReferenceType, ParsedReference } from '@shared/schema';
import { assessCandidatePlausibility } from './fieldPlausibility.js';
import { buildContainerHints } from './containerHints.js';
import {
  buildNormalizedKeyFields,
  selectExtractionCandidate,
  type CandidateAttempt,
  type SelectableExtractionCandidate,
} from './candidateSelector.js';

function makeCandidate(
  adapterId: string,
  adapterPriority: number,
  claimedType: CanonicalReferenceType,
  parsed: ParsedReference,
  overrides?: Partial<SelectableExtractionCandidate>,
): CandidateAttempt {
  const candidate: SelectableExtractionCandidate = {
    id: `${adapterId}:${adapterPriority}`,
    adapterId,
    claimedType,
    parsed,
    normalizedKeyFields: buildNormalizedKeyFields(parsed),
    containerHints: buildContainerHints(parsed, claimedType),
    plausibility: assessCandidatePlausibility(parsed, claimedType),
    branch: 'deterministic_raw',
    warnings: [],
    ...overrides,
  };

  return {
    adapterId,
    adapterPriority,
    branch: candidate.branch,
    candidate,
  };
}

describe('candidate selector', () => {
  it('vetoes candidates missing required fields for their claimed type', () => {
    const missingYear = makeCandidate('parser:auto:apa', 1, 'journal', {
      authors: ['Doe, J.'],
      title: 'Candidate without a year',
      journal: 'Journal of Testing',
    });
    const complete = makeCandidate('heuristic:apa_journal', 2, 'journal', {
      authors: ['Doe, J.'],
      title: 'Candidate with a year',
      year: '2024',
      journal: 'Journal of Testing',
    });

    const selection = selectExtractionCandidate([missingYear, complete], 'multi_candidate');

    expect(selection.winner?.adapterId).toBe('heuristic:apa_journal');
    expect(selection.selectionMode).toBe('single_survivor');
    expect(selection.adapterRegistry.find((entry) => entry.adapterId === 'parser:auto:apa')?.vetoReasons).toContain('year');
  });

  it('uses cross-candidate consensus as a tie-breaker after coverage and contamination', () => {
    const consensusA = makeCandidate('heuristic:a', 1, 'journal', {
      authors: ['Doe, J.'],
      title: 'Consensus title',
      year: '2024',
      journal: 'Journal of Testing',
      doi: '10.1000/consensus-a',
    });
    const consensusB = makeCandidate('heuristic:b', 2, 'journal', {
      authors: ['Doe, J.'],
      title: 'Consensus title',
      year: '2024',
      journal: 'Journal of Testing',
      doi: '10.1000/consensus-a',
    });
    const unique = makeCandidate('heuristic:c', 3, 'journal', {
      authors: ['Doe, J.'],
      title: 'Different title',
      year: '2024',
      journal: 'Journal of Testing',
      doi: '10.1000/unique-c',
    });

    const selection = selectExtractionCandidate([unique, consensusA, consensusB], 'multi_candidate');

    expect(selection.winner?.adapterId).toBe('heuristic:a');
    expect(selection.winnerBreakdown?.consensusScore).toBeGreaterThan(0);
    expect(selection.winnerBreakdown?.consensusScore).toBeGreaterThan(
      selection.adapterRegistry.find((entry) => entry.adapterId === 'heuristic:c')?.consensusScore ?? 0,
    );
  });

  it('uses the diversity guard when surviving candidates are effectively unanimous', () => {
    const primary = makeCandidate('heuristic:first', 1, 'journal', {
      authors: ['Doe, J.'],
      title: 'Nearly identical title',
      year: '2024',
      journal: 'Journal of Testing',
      doi: '10.1000/example',
    });
    const secondary = makeCandidate('heuristic:second', 2, 'journal', {
      authors: ['Doe, J.'],
      title: 'Nearly identical title.',
      year: '2024',
      journal: 'Journal of Testing',
      doi: '10.1000/example',
    });

    const selection = selectExtractionCandidate([primary, secondary], 'multi_candidate');

    expect(selection.selectionMode).toBe('unanimous_diversity_guard');
    expect(selection.winner?.adapterId).toBe('heuristic:first');
  });

  it('records adapter registry entries for produced, vetoed, and selected candidates', () => {
    const selected = makeCandidate('heuristic:selected', 1, 'conference', {
      authors: ['Doe, J.'],
      title: 'Conference paper',
      year: '2024',
      conferenceTitle: 'Proceedings of the Testing Conference',
      pages: '10-12',
    });
    const vetoed = makeCandidate('heuristic:vetoed', 2, 'conference', {
      title: 'Conference paper without authors',
      year: '2024',
      conferenceTitle: 'Proceedings of the Testing Conference',
      pages: '10-12',
    });

    const selection = selectExtractionCandidate([selected, vetoed], 'multi_candidate');
    const selectedEntry = selection.adapterRegistry.find((entry) => entry.adapterId === 'heuristic:selected');
    const vetoedEntry = selection.adapterRegistry.find((entry) => entry.adapterId === 'heuristic:vetoed');

    expect(selectedEntry?.selected).toBe(true);
    expect(vetoedEntry?.vetoed).toBe(true);
    expect(vetoedEntry?.vetoReasons).toContain('authors');
  });

  it('vetoes journal claims that have no credible serial container evidence', () => {
    const journalLikeReport = makeCandidate('legacy:year_anchored_fallback', 1, 'journal', {
      authors: ['Clinical Design Observatory'],
      title: 'Dose response ranking for translational pharmacology',
      year: '2021',
      journal: 'APAR-RPT-',
      publisher: 'Blue Harbor Research',
      url: 'https://stress.example.org/apar/021',
    });
    const report = makeCandidate('legacy:institutional_heuristic', 2, 'report', {
      authors: ['Clinical Design Observatory'],
      title: 'Dose response ranking for translational pharmacology',
      year: '2021',
      institution: 'Clinical Design Observatory',
      publisher: 'Blue Harbor Research',
      url: 'https://stress.example.org/apar/021',
    }, {
      branch: 'institutional_heuristic_raw',
    });

    const selection = selectExtractionCandidate([journalLikeReport, report], 'multi_candidate');

    expect(selection.winner?.adapterId).toBe('legacy:institutional_heuristic');
    expect(selection.adapterRegistry.find((entry) => entry.adapterId === 'legacy:year_anchored_fallback')?.vetoReasons).toContain('venue');
  });

  it('vetoes url-backed journal claims whose venue is only an institutional website label', () => {
    const websiteMisreadAsJournal = makeCandidate('parser:auto:mla', 1, 'journal', {
      authors: ['National Dosing Review Office'],
      title: 'Dose response ranking for translational pharmacology',
      year: '2013',
      journal: 'Drug Evidence Hub, ver',
      url: 'https://stress.example.org/iew/181',
    });
    const website = makeCandidate('legacy:institutional_heuristic', 2, 'website', {
      authors: ['National Dosing Review Office'],
      title: 'Dose response ranking for translational pharmacology',
      year: '2013',
      institution: 'Drug Evidence Hub',
      edition: 'ver. 2.0',
      url: 'https://stress.example.org/iew/181',
    }, {
      branch: 'institutional_heuristic_raw',
    });

    const selection = selectExtractionCandidate([websiteMisreadAsJournal, website], 'multi_candidate');

    expect(selection.winner?.adapterId).toBe('legacy:institutional_heuristic');
    expect(selection.adapterRegistry.find((entry) => entry.adapterId === 'parser:auto:mla')?.vetoReasons).toContain('venue');
  });

  it('vetoes book claims whose publisher is really a place-prefixed metadata tail', () => {
    const malformedBook = makeCandidate('parser:auto:harvard', 1, 'book', {
      authors: ['Global Trial Methods Unit'],
      title: 'Trial design routing for preclinical analytics: case SDE-APAR-002 (Report No',
      year: '2023',
      publisher: 'APAR-RPT-002). Amsterdam: Open Metrics Press',
      url: 'https://stress.example.org/apar/022',
    });
    const report = makeCandidate('legacy:institutional_heuristic', 2, 'report', {
      authors: ['Global Trial Methods Unit'],
      title: 'Trial design routing for preclinical analytics: case SDE-APAR-002',
      year: '2023',
      institution: 'Global Trial Methods Unit',
      publisher: 'Open Metrics Press',
      edition: 'Report No. APAR-RPT-002',
      url: 'https://stress.example.org/apar/022',
    }, {
      branch: 'institutional_heuristic_raw',
    });

    const selection = selectExtractionCandidate([malformedBook, report], 'multi_candidate');

    expect(selection.winner?.adapterId).toBe('legacy:institutional_heuristic');
    expect(selection.adapterRegistry.find((entry) => entry.adapterId === 'parser:auto:harvard')?.vetoReasons).toContain('publisher');
  });

  it('vetoes journal claims whose venue is really a publisher-year tail', () => {
    const malformedJournal = makeCandidate('parser:selected_style:vancouver', 1, 'journal', {
      authors: ['UN Women'],
      title: "Progress of the world's women 2019-2020: families in a changing world",
      year: '2019',
      journal: 'New York: UN Women; 2019',
    });
    const report = makeCandidate('legacy:institutional_heuristic', 2, 'report', {
      authors: ['UN Women'],
      title: "Progress of the world's women 2019-2020: families in a changing world",
      year: '2019',
      institution: 'UN Women',
      publisher: 'UN Women',
    }, {
      branch: 'institutional_heuristic_raw',
    });

    const selection = selectExtractionCandidate([malformedJournal, report], 'multi_candidate');

    expect(selection.winner?.adapterId).toBe('legacy:institutional_heuristic');
    expect(selection.adapterRegistry.find((entry) => entry.adapterId === 'parser:selected_style:vancouver')?.vetoReasons).toContain('venue');
  });
});
