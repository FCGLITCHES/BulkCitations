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
});
