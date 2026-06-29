export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
}

export interface CircuitAdmission {
  state: Exclude<CircuitState, 'open'>;
  isProbe: boolean;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private failures = 0;
  private state: CircuitState = 'closed';
  private openedAt = 0;
  private probeInFlight = false;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
  }

  getState(now = Date.now()): CircuitState {
    if (this.state === 'open' && now - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'half_open';
    }
    return this.state;
  }

  tryStartRequest(now = Date.now()): CircuitAdmission | null {
    const state = this.getState(now);
    if (state === 'open') {
      return null;
    }

    if (state === 'half_open') {
      if (this.probeInFlight) {
        return null;
      }
      this.probeInFlight = true;
      return {
        state,
        isProbe: true,
      };
    }

    return {
      state: 'closed',
      isProbe: false,
    };
  }

  recordSuccess(admission?: CircuitAdmission): void {
    this.failures = 0;
    this.state = 'closed';
    this.openedAt = 0;
    if (admission?.isProbe) {
      this.probeInFlight = false;
    }
  }

  recordFailure(admission?: CircuitAdmission, now = Date.now()): void {
    this.failures += 1;
    if (admission?.isProbe || this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = now;
      if (admission?.isProbe) {
        this.probeInFlight = false;
      }
      return;
    }

    if (this.state === 'half_open') {
      this.state = 'open';
      this.openedAt = now;
      this.probeInFlight = false;
    }
  }

  recordIgnored(admission?: CircuitAdmission): void {
    if (!admission?.isProbe) return;
    this.probeInFlight = false;
    this.failures = 0;
    this.state = 'closed';
    this.openedAt = 0;
  }
}
