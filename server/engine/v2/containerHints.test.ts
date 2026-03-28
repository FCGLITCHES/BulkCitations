import { describe, expect, it } from 'vitest';
import { buildContainerHints, resolveWinnerContainer } from './containerHints.js';

describe('container hints', () => {
  it('preserves a real publisher name when stripping copyright tails', () => {
    const parsed = {
      title: 'Flexible endoscopy methods',
      year: '2021',
      bookTitle: 'Handbook of Methods',
      publisher: '© 2021 Georg Thieme Verlag KG. All rights reserved.',
    };

    const resolved = resolveWinnerContainer(parsed, 'book');

    expect(resolved.parsed.publisher).toBe('Georg Thieme Verlag KG');
    expect(resolved.containerHints.copyrightTailPresent).toBe(false);
  });

  it('infers conference containers from proceedings-style venues', () => {
    const hints = buildContainerHints({
      title: 'A conference paper',
      year: '2024',
      conferenceTitle: 'Proceedings of the 2024 Testing Symposium',
      pages: '1-4',
    }, 'conference');

    expect(hints.containerKindHint).toBe('conference');
    expect(hints.containerKindConfidence).toBeGreaterThanOrEqual(0.95);
  });

  it('keeps website claims as websites even when an institution is present', () => {
    const hints = buildContainerHints({
      authors: ['OpenAI'],
      title: 'GPT-5.1 system card',
      year: '2026',
      url: 'https://openai.com/research/gpt-5-1',
      institution: 'OpenAI',
    }, 'website');

    expect(hints.containerKindHint).toBe('website');
    expect(hints.containerKindConfidence).toBeGreaterThanOrEqual(0.95);
  });

  it('preserves book claims for handbook-style institutional references', () => {
    const hints = buildContainerHints({
      authors: ['Cochrane Collaboration'],
      title: 'Cochrane handbook for systematic reviews of interventions',
      year: '2022',
      edition: 'Version 6.3',
      institution: 'Cochrane Collaboration',
    }, 'book');

    expect(hints.containerKindHint).toBe('book');
    expect(hints.containerKindConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('prefers thesis over report when dissertation institution evidence is present', () => {
    const hints = buildContainerHints({
      authors: ["O'Rourke, N."],
      title: 'Dose response ranking for translational pharmacology',
      year: '2019',
      institution: 'North Coast University',
      url: 'https://stress.example.org/apat/031',
    }, 'thesis');

    expect(hints.containerKindHint).toBe('thesis');
    expect(hints.containerKindConfidence).toBeGreaterThanOrEqual(0.95);
  });
});
