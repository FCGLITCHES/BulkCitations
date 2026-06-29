import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextState {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContextState>();

export function runWithRequestContext<T>(
  state: RequestContextState,
  fn: () => T,
): T {
  return storage.run(state, fn);
}

export function getCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null;
}

