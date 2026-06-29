import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMlError } from '../../../src/ml/errors.js';
import { Phase4MlRuntime } from '../../../src/ml/phase4Runtime.js';
import { CircuitBreaker } from '../../../src/pipeline/circuitBreaker.js';

describe('Phase4MlRuntime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens after repeated transient failures and closes after a successful half-open probe', async () => {
    vi.useFakeTimers();
    const transport = {
      health: vi.fn().mockResolvedValue(healthOk()),
      extract: vi.fn()
        .mockRejectedValueOnce(createMlError('MODEL_UNAVAILABLE', 'down'))
        .mockRejectedValueOnce(createMlError('MODEL_UNAVAILABLE', 'down again'))
        .mockResolvedValue(successResponse('Recovered title')),
    };
    const runtime = new Phase4MlRuntime(transport, {
      autoPoll: false,
      breaker: new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 60_000,
      }),
      healthPollMs: 30_000,
      maxConcurrentRequests: 1,
      maxQueueDepth: 1,
      queueWaitTimeoutMs: 10,
    });

    await runtime.refreshHealth();

    const first = await runtime.extract('primary', ['one'], ['apa7']);
    const second = await runtime.extract('primary', ['two'], ['apa7']);

    expect(first.outcome).toBe('failure');
    expect(second.outcome).toBe('failure');
    expect(runtime.getMetricsSnapshot().breakerState).toBe('open');

    const blocked = await runtime.extract('primary', ['three'], ['apa7']);
    expect(blocked.outcome).toBe('circuit_open');
    expect(blocked.error?.code).toBe('CIRCUIT_OPEN');
    expect(transport.extract).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_001);

    const recovered = await runtime.extract('primary', ['four'], ['apa7']);
    expect(recovered.outcome).toBe('success');
    expect(runtime.getMetricsSnapshot().breakerState).toBe('closed');
    expect(transport.extract).toHaveBeenCalledTimes(3);
  });

  it('does not count BAD_REQUEST toward breaker failures', async () => {
    const transport = {
      health: vi.fn().mockResolvedValue(healthOk()),
      extract: vi.fn().mockRejectedValue(createMlError('BAD_REQUEST', 'bad payload')),
    };
    const runtime = new Phase4MlRuntime(transport, {
      autoPoll: false,
      maxConcurrentRequests: 1,
      maxQueueDepth: 1,
      queueWaitTimeoutMs: 10,
    });

    await runtime.refreshHealth();
    const result = await runtime.extract('primary', ['one'], ['apa7']);

    expect(result.outcome).toBe('failure');
    expect(result.error?.code).toBe('BAD_REQUEST');
    expect(runtime.getMetricsSnapshot().breakerState).toBe('closed');
  });

  it('skips ML without breaker increments when cached health is unavailable', async () => {
    const transport = {
      health: vi.fn().mockResolvedValue({
        status: 'unavailable' as const,
        activeModelVersion: null,
        featureVersion: null,
        artifactsReady: false,
        lastSuccessfulInferenceAt: null,
      }),
      extract: vi.fn(),
    };
    const runtime = new Phase4MlRuntime(transport, {
      autoPoll: false,
      maxConcurrentRequests: 1,
      maxQueueDepth: 1,
      queueWaitTimeoutMs: 10,
    });

    await runtime.refreshHealth();
    const blocked = await runtime.extract('primary', ['one'], ['apa7']);

    expect(blocked.outcome).toBe('health_blocked');
    expect(blocked.attempted).toBe(false);
    expect(transport.extract).not.toHaveBeenCalled();
    expect(runtime.getMetricsSnapshot().breakerState).toBe('closed');
  });

  it('re-enables ML after health recovers without restart', async () => {
    const health = vi.fn()
      .mockResolvedValueOnce({
        status: 'unavailable' as const,
        activeModelVersion: null,
        featureVersion: null,
        artifactsReady: false,
        lastSuccessfulInferenceAt: null,
      })
      .mockResolvedValueOnce(healthOk());
    const transport = {
      health,
      extract: vi.fn().mockResolvedValue(successResponse('Recovered title')),
    };
    const runtime = new Phase4MlRuntime(transport, {
      autoPoll: false,
      maxConcurrentRequests: 1,
      maxQueueDepth: 1,
      queueWaitTimeoutMs: 10,
    });

    await runtime.refreshHealth();
    expect((await runtime.extract('primary', ['one'], ['apa7'])).outcome).toBe('health_blocked');

    await runtime.refreshHealth();
    const recovered = await runtime.extract('primary', ['two'], ['apa7']);

    expect(recovered.outcome).toBe('success');
    expect(transport.extract).toHaveBeenCalledTimes(1);
  });

  it('refreshes health lazily on first extract when no health has been cached yet', async () => {
    const transport = {
      health: vi.fn().mockResolvedValue(healthOk()),
      extract: vi.fn().mockResolvedValue(successResponse('Cold start title')),
    };
    const runtime = new Phase4MlRuntime(transport, {
      autoPoll: false,
      maxConcurrentRequests: 1,
      maxQueueDepth: 1,
      queueWaitTimeoutMs: 10,
    });

    const result = await runtime.extract('primary', ['one'], ['apa7']);

    expect(result.outcome).toBe('success');
    expect(transport.health).toHaveBeenCalledTimes(1);
    expect(transport.extract).toHaveBeenCalledTimes(1);
  });

  it('drops shadow requests immediately when the queue is full', async () => {
    const held = deferredReturnType();
    const transport = {
      health: vi.fn().mockResolvedValue(healthOk()),
      extract: vi.fn()
        .mockImplementationOnce(() => held.promise)
        .mockResolvedValueOnce(successResponse('Queued shadow title')),
    };
    const runtime = new Phase4MlRuntime(transport, {
      autoPoll: false,
      maxConcurrentRequests: 1,
      maxQueueDepth: 1,
      queueWaitTimeoutMs: 20,
    });

    await runtime.refreshHealth();

    const first = runtime.extract('primary', ['one'], ['apa7']);
    await Promise.resolve();
    const second = runtime.extract('shadow', ['two'], ['apa7']);
    await Promise.resolve();
    const dropped = await runtime.extract('shadow', ['three'], ['apa7']);

    expect(dropped.outcome).toBe('shadow_dropped');
    expect(dropped.error?.code).toBe('QUEUE_FULL');
    expect(runtime.getMetricsSnapshot().shadowDropsTotal.queue_full).toBe(1);

    held.resolve(successResponse('Primary title'));
    await first;
    await second;
  });

  it('returns QUEUE_FULL for primary requests that exceed the queue wait timeout', async () => {
    vi.useFakeTimers();
    const held = deferredReturnType();
    const transport = {
      health: vi.fn().mockResolvedValue(healthOk()),
      extract: vi.fn()
        .mockImplementationOnce(() => held.promise)
        .mockResolvedValueOnce(successResponse('Queued shadow title')),
    };
    const runtime = new Phase4MlRuntime(transport, {
      autoPoll: false,
      maxConcurrentRequests: 1,
      maxQueueDepth: 1,
      queueWaitTimeoutMs: 10,
    });

    await runtime.refreshHealth();

    const active = runtime.extract('primary', ['one'], ['apa7']);
    await Promise.resolve();
    const queuedShadow = runtime.extract('shadow', ['two'], ['apa7']);
    await Promise.resolve();
    const queuedPrimary = runtime.extract('primary', ['three'], ['apa7']);

    await vi.advanceTimersByTimeAsync(11);
    const result = await queuedPrimary;

    expect(result.outcome).toBe('queue_full');
    expect(result.error?.code).toBe('QUEUE_FULL');
    expect(runtime.getMetricsSnapshot().breakerState).toBe('closed');

    held.resolve(successResponse('Primary title'));
    await active;
    await queuedShadow;
  });
});

function healthOk() {
  return {
    status: 'ok' as const,
    activeModelVersion: 'mock-crf',
    featureVersion: 'mock-features',
    artifactsReady: true,
    lastSuccessfulInferenceAt: null,
  };
}

function successResponse(title: string) {
  return {
    results: [{
      fields: { title },
      fieldConfidences: { title: 0.94 },
      overallConfidence: 0.94,
      modelVersion: 'mock-crf',
      featureVersion: 'mock-features',
      styleUsed: 'apa',
      uncertainFields: [],
      entities: [],
    }],
  };
}

function deferredReturnType() {
  let resolve!: (value: ReturnType<typeof successResponse>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<ReturnType<typeof successResponse>>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
