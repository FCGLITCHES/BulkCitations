import { describe, expect, it } from 'vitest';
import { computeReferenceHealth } from './referenceHealth';
import type { ConvertedReference } from './types';

function makeReference(overrides: Partial<ConvertedReference>): ConvertedReference {
  return {
    id: 'ref-1',
    originalText: 'Example input',
    convertedText: 'Example output',
    referenceType: 'journal',
    parsedData: {
      authors: ['Smith, J.'],
      title: 'Example title',
      year: '2020',
      journal: 'Example Journal',
      volume: '10',
      issue: '2',
      pages: '1-10',
    },
    inputStyle: 'auto',
    outputStyle: 'apa',
    warnings: [],
    confidence: {
      score: 95,
      breakdown: { rules: 95 },
      isSuspicious: false,
    },
    ...overrides,
  };
}

describe('reference health regression checks', () => {
  it('marks malformed author output as action needed', () => {
    const ref = makeReference({
      parsedData: {
        authors: ['Baron, M, R', 'Kenny, &, A, D'],
        title: 'The moderator-mediator variable distinction in social psychological research',
        year: '1986',
        journal: 'Journal of Personality and Social Psychology',
        volume: '51',
        issue: '6',
        pages: '1173-1182',
      },
    });

    const health = computeReferenceHealth(ref);
    expect(health.state).toBe('action_needed');
    expect(health.reasons).toContain('Author parsing looks malformed');
  });

  it('marks placeholder venue fields as worth reviewing when the source is also incomplete', () => {
    const ref = makeReference({
      originalText: 'Haynes, W. M. (2014). CRC Handbook of Chemistry and Physics. Journal, ?.',
      parsedData: {
        authors: ['Haynes, W. M.'],
        title: 'CRC Handbook of Chemistry and Physics',
        year: '2014',
        journal: 'Journal',
        volume: 'Vol',
      },
      confidence: {
        score: 82,
        breakdown: { rules: 82 },
        isSuspicious: false,
      },
    });

    const health = computeReferenceHealth(ref);
    expect(health.state).toBe('review');
    expect(health.reasons).toContain('Placeholder or suspicious venue fields present');
  });

  it('prefers backend health state and reasons when v2 provides them', () => {
    const ref = makeReference({
      healthState: 'review',
      healthReasons: ['Authority verification found mismatched fields'],
      styleDetectionFailed: true,
      confidence: {
        score: 95,
        breakdown: { rules: 95 },
        isSuspicious: false,
      },
    });

    const health = computeReferenceHealth(ref);
    expect(health.state).toBe('review');
    expect(health.reasons).toEqual(['Authority verification found mismatched fields']);
  });

  it('does not hard-fail website references just because year and authors are absent', () => {
    const ref = makeReference({
      referenceType: 'website',
      parsedData: {
        title: 'OpenAI API overview',
        url: 'https://platform.openai.com/docs/overview',
      },
    });

    const health = computeReferenceHealth(ref);
    expect(health.state).toBe('clean');
  });

  it('does not escalate generic warning strings into review when structure is otherwise sound', () => {
    const ref = makeReference({
      warnings: ['warning:title_short_or_missing'],
      confidence: {
        score: 95,
        breakdown: { rules: 95 },
        isSuspicious: false,
      },
    });

    const health = computeReferenceHealth(ref);
    expect(health.state).toBe('clean');
  });

  it('marks protected title-token corruption as action needed', () => {
    const ref = makeReference({
      originalText: 'Ronneberger, O., Fischer, P., and Brox, T. "U-Net: Convolutional Networks for Biomedical Image Segmentation."',
      parsedData: {
        authors: ['Ronneberger, O.', 'Fischer, P.', 'Brox, T.'],
        title: 'U-Convolutional Networks for Biomedical Image Segmentation',
        year: '2015',
        journal: 'Lecture Notes in Computer Science',
      },
      confidence: {
        score: 61,
        breakdown: { rules: 61 },
        isSuspicious: false,
      },
    });

    const health = computeReferenceHealth(ref);
    expect(health.state).toBe('action_needed');
    expect(health.reasons).toContain('Protected title token U-Net was corrupted');
  });

  it('keeps unknown-source placeholders in review rather than action needed', () => {
    const ref = makeReference({
      originalText: 'Unknown. (1990). Statistical power analysis for the behavioral sciences. Computers Environment and Urban Systems, 14(1), 71.',
      parsedData: {
        authors: ['Unknown'],
        title: 'Statistical power analysis for the behavioral sciences',
        year: '1990',
        journal: 'Computers Environment and Urban Systems',
        volume: '14',
        issue: '1',
        pages: '71',
      },
      confidence: {
        score: 58,
        breakdown: { rules: 58 },
        isSuspicious: false,
      },
      warnings: ['warning:missing_field'],
    });

    const health = computeReferenceHealth(ref);
    expect(health.state).toBe('review');
  });
});
