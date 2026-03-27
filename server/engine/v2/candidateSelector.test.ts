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
});
