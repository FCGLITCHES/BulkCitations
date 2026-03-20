import { describe, expect, it } from 'vitest';
import { runAssertions } from './strictRenderer';

describe('strict renderer edge assertions', () => {
  it('accepts APA volume and issue without a trailing comma when no locator follows', () => {
    const output = 'McCoy, L. G., Banja, J. D., Ghassemi, M., & Celi, L. A. (2020). Ensuring machine learning for healthcare works for all. BMJ Health & Care Informatics, 27(3).';
    const { warnings, assertionSummary } = runAssertions('apa', output, {
      type: 'journal-article',
      author: [
        { family: 'McCoy', given: 'L. G.' },
        { family: 'Banja', given: 'J. D.' },
      ],
      issued: { 'date-parts': [[2020]] },
      title: 'Ensuring machine learning for healthcare works for all',
      'container-title': 'BMJ Health & Care Informatics',
      volume: '27',
      issue: '3',
    });

    expect(warnings).not.toContain('warning: APA - Volume(issue) must appear as "Vol(Issue)" with punctuation appropriate to the locator that follows.');
    expect(assertionSummary?.details.find((detail) => detail.id === 'apa:volume_issue_format')?.passed).toBe(true);
  });
});
