import { describe, expect, it } from 'vitest';
import { resolveCitationStyleResolution } from './styleResolution.js';

describe('resolveCitationStyleResolution', () => {
  it('prefers the explicit requested style over unknown detection', () => {
    const resolution = resolveCitationStyleResolution({
      requestedStyle: 'apa7',
      detectedStyle: 'unknown',
      detectionConfidence: 0.41,
      detectedIsUnknown: true,
    });

    expect(resolution.effectiveStyle).toBe('apa7');
    expect(resolution.effectiveStyleSource).toBe('requested');
    expect(resolution.effectiveStyleKnown).toBe(true);
    expect(resolution.inputStyleUncertain).toBe(true);
    expect(resolution.rawDetectionConfidence).toBeCloseTo(0.41);
    expect(resolution.effectiveDetectionConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('falls back to apa7 when neither request nor detection can resolve the render style', () => {
    const resolution = resolveCitationStyleResolution({
      requestedStyle: 'auto',
      detectedStyle: 'unknown',
      detectionConfidence: 0.4,
      detectedIsUnknown: true,
    });

    expect(resolution.effectiveStyle).toBe('apa7');
    expect(resolution.effectiveStyleKnown).toBe(true);
    expect(resolution.effectiveStyleSource).toBe('default');
    expect(resolution.effectiveDetectionConfidence).toBeGreaterThanOrEqual(0.9);
  });
});
