import { afterEach, describe, expect, it } from 'vitest';
import {
  recordEgress,
  shouldPersistEgressTelemetry,
} from '../../../src/runtime/egressTelemetry.js';

const originalIsolatedRuntime = process.env.BULKREFERENCES_ISOLATED_RUNTIME;

function restoreIsolatedRuntimeEnv(): void {
  if (originalIsolatedRuntime === undefined) {
    delete process.env.BULKREFERENCES_ISOLATED_RUNTIME;
    return;
  }

  process.env.BULKREFERENCES_ISOLATED_RUNTIME = originalIsolatedRuntime;
}

describe('egressTelemetry', () => {
  afterEach(() => {
    restoreIsolatedRuntimeEnv();
  });

  it('keeps persisted egress telemetry enabled by default', () => {
    delete process.env.BULKREFERENCES_ISOLATED_RUNTIME;
    expect(shouldPersistEgressTelemetry()).toBe(true);
  });

  it('disables persisted egress telemetry when isolated runtime mode is enabled', async () => {
    process.env.BULKREFERENCES_ISOLATED_RUNTIME = 'true';

    expect(shouldPersistEgressTelemetry()).toBe(false);
    await expect(recordEgress({
      provider: 'ml',
      route: '/v1/ml/health',
      method: 'GET',
      status: 200,
      requestBodyBytes: 0,
      responseBodyBytes: 128,
      latencyMs: 12,
    })).resolves.toBeUndefined();
  });
});
