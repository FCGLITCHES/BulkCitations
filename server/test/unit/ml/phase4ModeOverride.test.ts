import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPhase4EffectiveLabel,
  getPhase4OverrideMode,
  setPhase4OverrideMode,
  shouldUseTransientPhase4OverrideState,
} from '../../../src/ml/phase4ModeOverride.js';

describe('phase4ModeOverride', () => {
  const originalIsolatedRuntime = process.env.BULKREFERENCES_ISOLATED_RUNTIME;

  beforeEach(async () => {
    if (originalIsolatedRuntime === undefined) {
      delete process.env.BULKREFERENCES_ISOLATED_RUNTIME;
    } else {
      process.env.BULKREFERENCES_ISOLATED_RUNTIME = originalIsolatedRuntime;
    }
    await setPhase4OverrideMode(null);
  });

  it('returns env mode when no override is set', async () => {
    expect(await getPhase4OverrideMode()).toBeNull();
    expect(getPhase4EffectiveLabel('shadow', null)).toBe('shadow');
  });

  it('forces heuristic mode when override is heuristic', async () => {
    await setPhase4OverrideMode('heuristic');
    expect(await getPhase4OverrideMode()).toBe('heuristic');
    expect(getPhase4EffectiveLabel('primary', 'heuristic')).toBe('heuristic');
  });

  it('forces primary mode when override is primary', async () => {
    await setPhase4OverrideMode('primary');
    expect(await getPhase4OverrideMode()).toBe('primary');
    expect(getPhase4EffectiveLabel('heuristic', 'primary')).toBe('primary');
  });

  it('uses transient override state when benchmark runtime isolation is enabled', () => {
    process.env.BULKREFERENCES_ISOLATED_RUNTIME = 'true';
    expect(shouldUseTransientPhase4OverrideState()).toBe(true);
  });
});
