import { describe, expect, it } from 'vitest';
import {
  calibrateRecoveredFieldConfidence,
  getEffectiveMandatoryThreshold,
  isFieldStructurallyValidated,
} from '../../../src/engine/confidenceCalibration.js';

describe('confidenceCalibration', () => {
  it('uses reduced validated thresholds for structurally valid identifiers', () => {
    expect(getEffectiveMandatoryThreshold('year', true)).toBe(0.7);
    expect(getEffectiveMandatoryThreshold('doi', true)).toBe(0.8);
    expect(getEffectiveMandatoryThreshold('title', true)).toBe(0.8);
  });

  it('keeps full thresholds when structural validation fails', () => {
    expect(getEffectiveMandatoryThreshold('year', false)).toBe(0.9);
    expect(getEffectiveMandatoryThreshold('doi', false)).toBe(0.95);
  });

  it('raises structurally valid recovered fields to the mandatory floor', () => {
    expect(isFieldStructurallyValidated('year', 2020)).toBe(true);
    expect(calibrateRecoveredFieldConfidence('year', 2020, 0.74)).toBe(0.9);
    expect(calibrateRecoveredFieldConfidence('doi', '10.1000/example', 0.6)).toBe(0.95);
  });

  it('keeps legacy cap when structural validation fails', () => {
    expect(calibrateRecoveredFieldConfidence('year', 3026, 0.9)).toBe(0.82);
  });
});
