import { env } from '../config.js';
import type { CitationStyle } from '../engine/types/citation.js';
import { CircuitBreaker, type CircuitState } from '../pipeline/circuitBreaker.js';
import type { ExtractBatchResponse, MLClient, MLHealthResponse } from './client.js';
import { createMlError, isTransientMlErrorCode, toMlError, type MLError } from './errors.js';

export type Phase4RequestMode = 'primary' | 'shadow';
export type Phase4RequestOutcome =
  | 'success'
  | 'partial'
  | 'failure'
  | 'timeout'
  | 'circuit_open'
  | 'queue_full'
  | 'health_blocked'
  | 'shadow_dropped';

export interface Phase4ExtractAttempt {
  mode: Phase4RequestMode;
  outcome: Phase4RequestOutcome;
  health: MLHealthResponse | null;
  attempted: boolean;
  response?: ExtractBatchResponse;
  error?: MLError;
}

export interface Phase4MetricsSnapshot {
  requestsTotal: Record<string, number>;
  latencyMs: Record<string, number[]>;
  fallbacksTotal: Record<string, number>;
  shadowDropsTotal: Record<string, number>;
  breakerState: CircuitState;
  queueDepth: number;
}

interface QueueWaiter {
  id: number;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (grant: QueueGrant) => void;
  reject: (value: QueueAdmissionFailure) => void;
}

interface QueueGrant {
  release: () => void;
}

interface QueueAdmissionFailure {
  reason: 'QUEUE_FULL';
}

const LATENCY_SAMPLE_CAP = 512;

export interface Phase4MlRuntimeOptions {
  breaker?: CircuitBreaker;
  autoPoll?: boolean;
  healthPollMs?: number;
  maxConcurrentRequests?: number;
  maxQueueDepth?: number;
  queueWaitTimeoutMs?: number;
}

export interface Phase4MlRuntimeLike {
  getCachedHealth(): MLHealthResponse | null;
  refreshHealth(): Promise<MLHealthResponse | null>;
  extract(
    mode: Phase4RequestMode,
    texts: string[],
    styles: CitationStyle[],
  ): Promise<Phase4ExtractAttempt>;
  recordFallback(reason: string): void;
  recordShadowDrop(reason: string): void;
  getMetricsSnapshot(): Phase4MetricsSnapshot;
}

export class Phase4MlRuntime implements Phase4MlRuntimeLike {
  private readonly breaker: CircuitBreaker;
  private readonly healthPollMs: number;
  private readonly maxConcurrentRequests: number;
  private readonly maxQueueDepth: number;
  private readonly queueWaitTimeoutMs: number;
  private readonly metrics = new Phase4Metrics();
  private cachedHealth: MLHealthResponse | null = null;
  private pollHandle: ReturnType<typeof setInterval> | undefined;
  private activeRequests = 0;
  private nextWaiterId = 1;
  private readonly waiters: QueueWaiter[] = [];
  private readonly capacityResolvers = new Set<() => void>();

  constructor(
    private readonly transport: Pick<MLClient, 'health' | 'extract'>,
    options: Phase4MlRuntimeOptions = {},
  ) {
    this.breaker = options.breaker ?? new CircuitBreaker({
      failureThreshold: env.ML_CB_FAILURE_THRESHOLD,
      resetTimeoutMs: env.ML_CB_COOLDOWN_MS,
    });
    this.healthPollMs = options.healthPollMs ?? env.ML_HEALTH_POLL_MS;
    this.maxConcurrentRequests = options.maxConcurrentRequests ?? env.ML_MAX_CONCURRENT_REQUESTS;
    this.maxQueueDepth = options.maxQueueDepth ?? env.ML_MAX_QUEUE_DEPTH;
    this.queueWaitTimeoutMs = options.queueWaitTimeoutMs ?? env.ML_QUEUE_WAIT_TIMEOUT_MS;
    this.metrics.setBreakerState(this.breaker.getState());
    this.metrics.setQueueDepth(0);

    if (options.autoPoll ?? process.env.NODE_ENV !== 'test') {
      void this.refreshHealth();
      this.pollHandle = setInterval(() => {
        void this.refreshHealth();
      }, this.healthPollMs);
      this.pollHandle.unref?.();
    }
  }

  stop(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = undefined;
    }
  }

  getCachedHealth(): MLHealthResponse | null {
    return this.cachedHealth ? structuredClone(this.cachedHealth) : null;
  }

  async refreshHealth(): Promise<MLHealthResponse | null> {
    try {
      const health = await this.transport.health();
      this.cachedHealth = health;
    } catch {
      this.cachedHealth = {
        status: 'unavailable',
        activeModelVersion: null,
        featureVersion: null,
        artifactsReady: false,
        lastSuccessfulInferenceAt: null,
      };
    }

    return this.getCachedHealth();
  }

  async extract(
    mode: Phase4RequestMode,
    texts: string[],
    styles: CitationStyle[],
  ): Promise<Phase4ExtractAttempt> {
    const startedAt = Date.now();
    let health = this.getCachedHealth();

    if (!health) {
      health = await this.refreshHealth();
    }

    if (!isCallableHealth(health)) {
      const outcome: Phase4RequestOutcome = 'health_blocked';
      if (mode === 'shadow') {
        this.recordShadowDrop('health_blocked');
      }
      this.metrics.recordRequest(mode, outcome, Date.now() - startedAt);
      return {
        mode,
        outcome,
        attempted: false,
        health,
        error: createMlError('MODEL_UNAVAILABLE', 'Phase 4 ML health is not callable.'),
      };
    }

    const admission = this.breaker.tryStartRequest();
    this.metrics.setBreakerState(this.breaker.getState());
    if (!admission) {
      const outcome: Phase4RequestOutcome = mode === 'shadow' ? 'shadow_dropped' : 'circuit_open';
      if (mode === 'shadow') {
        this.recordShadowDrop('circuit_open');
      }
      this.metrics.recordRequest(mode, outcome, Date.now() - startedAt);
      return {
        mode,
        outcome,
        attempted: false,
        health,
        error: createMlError('CIRCUIT_OPEN', 'Phase 4 extract circuit breaker is open.'),
      };
    }

    let grant: QueueGrant | null = null;
    try {
      grant = await this.acquire(mode);
    } catch (error) {
      this.breaker.recordIgnored(admission);
      this.metrics.setBreakerState(this.breaker.getState());
      const outcome: Phase4RequestOutcome = mode === 'shadow' ? 'shadow_dropped' : 'queue_full';
      if (mode === 'shadow') {
        this.recordShadowDrop('queue_full');
      }
      this.metrics.recordRequest(mode, outcome, Date.now() - startedAt);
      return {
        mode,
        outcome,
        attempted: false,
        health,
        error: createMlError('QUEUE_FULL', error instanceof Error ? error.message : 'Phase 4 queue is full.'),
      };
    }

    try {
      const response = await this.transport.extract(texts, styles);
      this.breaker.recordSuccess(admission);
      this.metrics.setBreakerState(this.breaker.getState());
      const outcome: Phase4RequestOutcome = response.errors?.length ? 'partial' : 'success';
      this.metrics.recordRequest(mode, outcome, Date.now() - startedAt);
      return {
        mode,
        outcome,
        attempted: true,
        health,
        response,
      };
    } catch (error) {
      const mlError = toMlError(error);
      if (isTransientMlErrorCode(mlError.code)) {
        this.breaker.recordFailure(admission);
      } else {
        this.breaker.recordIgnored(admission);
      }
      this.metrics.setBreakerState(this.breaker.getState());
      const outcome = mapErrorToOutcome(mlError);
      this.metrics.recordRequest(mode, outcome, Date.now() - startedAt);
      return {
        mode,
        outcome,
        attempted: true,
        health,
        error: mlError,
      };
    } finally {
      grant.release();
    }
  }

  recordFallback(reason: string): void {
    this.metrics.recordFallback(reason);
  }

  recordShadowDrop(reason: string): void {
    this.metrics.recordShadowDrop(reason);
  }

  getMetricsSnapshot(): Phase4MetricsSnapshot {
    return this.metrics.snapshot();
  }

  private async acquire(mode: Phase4RequestMode): Promise<QueueGrant> {
    for (;;) {
      if (this.activeRequests < this.maxConcurrentRequests && this.waiters.length === 0) {
        return this.activateGrant();
      }

      if (this.waiters.length < this.maxQueueDepth) {
        return this.enqueue(mode);
      }

      if (mode === 'shadow') {
        throw new Error('Phase 4 shadow extraction was dropped because the queue is full.');
      }

      const hasCapacity = await this.waitForCapacity(this.queueWaitTimeoutMs);
      if (!hasCapacity) {
        throw new Error('Phase 4 primary extraction exceeded the queue wait timeout.');
      }
    }
  }

  private enqueue(mode: Phase4RequestMode): Promise<QueueGrant> {
    return new Promise<QueueGrant>((resolve, reject) => {
      const waiter: QueueWaiter = {
        id: this.nextWaiterId++,
        resolve,
        reject,
      };

      if (mode === 'primary' && this.queueWaitTimeoutMs >= 0) {
        waiter.timer = setTimeout(() => {
          const index = this.waiters.findIndex((candidate) => candidate.id === waiter.id);
          if (index >= 0) {
            this.waiters.splice(index, 1);
            this.metrics.setQueueDepth(this.waiters.length);
            this.notifyCapacityChanged();
          }
          reject(new Error('Phase 4 queue is full.'));
        }, this.queueWaitTimeoutMs);
      }

      this.waiters.push(waiter);
      this.metrics.setQueueDepth(this.waiters.length);
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    while (this.activeRequests < this.maxConcurrentRequests && this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) break;
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(this.activateGrant());
      this.metrics.setQueueDepth(this.waiters.length);
      this.notifyCapacityChanged();
    }
  }

  private activateGrant(): QueueGrant {
    this.activeRequests += 1;
    let released = false;

    return {
      release: () => {
        if (released) return;
        released = true;
        this.activeRequests = Math.max(0, this.activeRequests - 1);
        this.notifyCapacityChanged();
        this.drainQueue();
      },
    };
  }

  private waitForCapacity(timeoutMs: number): Promise<boolean> {
    if (this.activeRequests < this.maxConcurrentRequests || this.waiters.length < this.maxQueueDepth) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const onCapacity = () => {
        cleanup();
        resolve(true);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.capacityResolvers.delete(onCapacity);
      };

      this.capacityResolvers.add(onCapacity);
    });
  }

  private notifyCapacityChanged(): void {
    const resolvers = [...this.capacityResolvers];
    this.capacityResolvers.clear();
    for (const resolve of resolvers) {
      resolve();
    }
  }
}

class Phase4Metrics {
  private readonly requestsTotal = new Map<string, number>();
  private readonly latencyMs = new Map<string, number[]>();
  private readonly fallbacksTotal = new Map<string, number>();
  private readonly shadowDropsTotal = new Map<string, number>();
  private breakerState: CircuitState = 'closed';
  private queueDepth = 0;

  recordRequest(mode: Phase4RequestMode, outcome: Phase4RequestOutcome, latencyMs: number): void {
    increment(this.requestsTotal, `${mode}:${outcome}`);
    const bucket = this.latencyMs.get(mode) ?? [];
    if (bucket.length >= LATENCY_SAMPLE_CAP) {
      bucket.shift();
    }
    bucket.push(latencyMs);
    this.latencyMs.set(mode, bucket);
    logMetric('ml_phase4_requests_total', { mode, outcome, value: 1 });
    logMetric('ml_phase4_latency_ms', { mode, value: latencyMs });
  }

  recordFallback(reason: string): void {
    increment(this.fallbacksTotal, reason);
    logMetric('ml_phase4_fallbacks_total', { reason, value: 1 });
  }

  recordShadowDrop(reason: string): void {
    increment(this.shadowDropsTotal, reason);
    logMetric('ml_phase4_shadow_drops_total', { reason, value: 1 });
  }

  setBreakerState(state: CircuitState): void {
    this.breakerState = state;
    logMetric('ml_phase4_breaker_state', { value: state });
  }

  setQueueDepth(depth: number): void {
    this.queueDepth = depth;
    logMetric('ml_phase4_queue_depth', { value: depth });
  }

  snapshot(): Phase4MetricsSnapshot {
    return {
      requestsTotal: Object.fromEntries(this.requestsTotal),
      latencyMs: Object.fromEntries(this.latencyMs),
      fallbacksTotal: Object.fromEntries(this.fallbacksTotal),
      shadowDropsTotal: Object.fromEntries(this.shadowDropsTotal),
      breakerState: this.breakerState,
      queueDepth: this.queueDepth,
    };
  }
}

function increment(values: Map<string, number>, key: string): void {
  values.set(key, (values.get(key) ?? 0) + 1);
}

function isCallableHealth(health: MLHealthResponse | null): health is MLHealthResponse {
  return health != null
    && health.status !== 'unavailable'
    && health.artifactsReady
    && Boolean(health.activeModelVersion);
}

function mapErrorToOutcome(error: MLError): Phase4RequestOutcome {
  if (error.code === 'INFERENCE_TIMEOUT') return 'timeout';
  if (error.code === 'CIRCUIT_OPEN') return 'circuit_open';
  if (error.code === 'QUEUE_FULL') return 'queue_full';
  return 'failure';
}

function logMetric(event: string, details: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'test') return;
  console.info(JSON.stringify({ event, ...details }));
}
