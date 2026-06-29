import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../../src/pipeline/circuitBreaker.js';

describe('CircuitBreaker', () => {
  it('opens after repeated failures and closes again after a successful half-open probe', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 20,
    });

    const first = breaker.tryStartRequest();
    expect(first).not.toBeNull();
    breaker.recordFailure(first ?? undefined);

    const second = breaker.tryStartRequest();
    expect(second).not.toBeNull();
    breaker.recordFailure(second ?? undefined);

    expect(breaker.getState()).toBe('open');
    expect(breaker.tryStartRequest()).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(breaker.getState()).toBe('half_open');

    const probe = breaker.tryStartRequest();
    expect(probe).not.toBeNull();
    breaker.recordSuccess(probe ?? undefined);
    expect(breaker.getState()).toBe('closed');
  });
});
