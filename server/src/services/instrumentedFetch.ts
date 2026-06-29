import { recordEgress, type EgressProvider } from '../runtime/egressTelemetry.js';
import { getCorrelationId } from '../runtime/requestContext.js';

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export interface InstrumentedFetchInput {
  provider: EgressProvider;
  route: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  cacheHit?: boolean;
  timeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  maxResponseBytes?: number;
  expectedContentTypes?: string[];
}

export class OutboundFetchError extends Error {
  constructor(
    readonly code:
      | 'OUTBOUND_TIMEOUT'
      | 'OUTBOUND_NETWORK'
      | 'OUTBOUND_RESPONSE_TOO_LARGE'
      | 'OUTBOUND_UNEXPECTED_CONTENT_TYPE',
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'OutboundFetchError';
  }
}

export interface OutboundFetchErrorMapping {
  statusCode: number;
  code: string;
  message: string;
}

export function mapOutboundFetchError(
  error: unknown,
  fallbackMessage: string,
): OutboundFetchErrorMapping {
  if (error instanceof OutboundFetchError) {
    if (error.code === 'OUTBOUND_TIMEOUT') {
      return {
        statusCode: 504,
        code: 'UPSTREAM_TIMEOUT',
        message: fallbackMessage,
      };
    }
    if (error.code === 'OUTBOUND_RESPONSE_TOO_LARGE') {
      return {
        statusCode: 502,
        code: 'UPSTREAM_RESPONSE_TOO_LARGE',
        message: fallbackMessage,
      };
    }
    if (error.code === 'OUTBOUND_UNEXPECTED_CONTENT_TYPE') {
      return {
        statusCode: 502,
        code: 'UPSTREAM_CONTENT_TYPE_MISMATCH',
        message: fallbackMessage,
      };
    }
    return {
      statusCode: 502,
      code: 'UPSTREAM_NETWORK_ERROR',
      message: fallbackMessage,
    };
  }

  return {
    statusCode: 502,
    code: 'UPSTREAM_REQUEST_FAILED',
    message: fallbackMessage,
  };
}

export async function instrumentedFetch(
  input: InstrumentedFetchInput,
): Promise<Response> {
  const correlationId = getCorrelationId();
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
  };

  let requestBodyBytes = 0;
  let body: string | undefined;
  if (input.body !== undefined) {
    body = JSON.stringify(input.body);
    requestBodyBytes = utf8Bytes(body);
    headers['content-type'] = headers['content-type'] ?? 'application/json';
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryAttempts = Math.max(1, input.retryAttempts ?? (input.method === 'GET' ? 2 : 1));
  const retryDelayMs = Math.max(0, input.retryDelayMs ?? 250);
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const expectedContentTypes = input.expectedContentTypes ?? [];

  let attempt = 0;
  let lastError: unknown;

  while (attempt < retryAttempts) {
    attempt += 1;
    const startedAt = Date.now();
    const { signal, cleanup } = createTimeoutSignal(input.signal, timeoutMs);

    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal,
      });

      const responseBodyBytes = await measureResponseBytes(response, maxResponseBytes);
      assertContentType(response, expectedContentTypes);

      await recordEgress({
        provider: input.provider,
        route: input.route,
        method: input.method,
        status: response.status,
        requestBodyBytes,
        responseBodyBytes,
        latencyMs: Date.now() - startedAt,
        ...(input.cacheHit !== undefined ? { cacheHit: input.cacheHit } : {}),
      });

      if (
        attempt < retryAttempts
        && RETRYABLE_STATUS_CODES.has(response.status)
        && input.method === 'GET'
      ) {
        await delay(computeRetryDelayMs(retryDelayMs, attempt));
        continue;
      }

      return response;
    } catch (error) {
      const mapped = normalizeOutboundFetchError(error, timeoutMs);
      lastError = mapped;
      await recordEgress({
        provider: input.provider,
        route: input.route,
        method: input.method,
        status: mapped.statusCode ?? 0,
        requestBodyBytes,
        responseBodyBytes: 0,
        latencyMs: Date.now() - startedAt,
        ...(input.cacheHit !== undefined ? { cacheHit: input.cacheHit } : {}),
      });
      if (attempt < retryAttempts && input.method === 'GET') {
        await delay(computeRetryDelayMs(retryDelayMs, attempt));
        continue;
      }
    } finally {
      cleanup();
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new OutboundFetchError('OUTBOUND_NETWORK', 'Outbound request failed.');
}

function createTimeoutSignal(sourceSignal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Outbound request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const onAbort = () => {
    controller.abort(sourceSignal?.reason ?? new Error('Request aborted.'));
  };

  if (sourceSignal) {
    if (sourceSignal.aborted) {
      onAbort();
    } else {
      sourceSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      if (sourceSignal) {
        sourceSignal.removeEventListener('abort', onAbort);
      }
    },
  };
}

async function measureResponseBytes(response: Response, maxBytes: number): Promise<number> {
  const clone = response.clone();
  const reader = clone.body?.getReader();
  if (!reader) {
    const bytes = utf8Bytes(await clone.text());
    if (bytes > maxBytes) {
      throw new OutboundFetchError(
        'OUTBOUND_RESPONSE_TOO_LARGE',
        `Outbound response exceeded ${maxBytes} bytes.`,
        response.status,
      );
    }
    return bytes;
  }

  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      return total;
    }
    total += value?.byteLength ?? 0;
    if (total > maxBytes) {
      await reader.cancel();
      throw new OutboundFetchError(
        'OUTBOUND_RESPONSE_TOO_LARGE',
        `Outbound response exceeded ${maxBytes} bytes.`,
        response.status,
      );
    }
  }
}

function assertContentType(response: Response, expectedContentTypes: string[]): void {
  if (expectedContentTypes.length === 0) {
    return;
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (expectedContentTypes.some((expected) => contentType.includes(expected.toLowerCase()))) {
    return;
  }
  throw new OutboundFetchError(
    'OUTBOUND_UNEXPECTED_CONTENT_TYPE',
    `Outbound response content-type "${contentType || 'unknown'}" did not match expected types.`,
    response.status,
  );
}

function normalizeOutboundFetchError(error: unknown, timeoutMs: number): OutboundFetchError {
  if (error instanceof OutboundFetchError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new OutboundFetchError(
      'OUTBOUND_TIMEOUT',
      `Outbound request timed out after ${timeoutMs}ms.`,
    );
  }
  return new OutboundFetchError(
    'OUTBOUND_NETWORK',
    error instanceof Error ? error.message : 'Outbound request failed.',
  );
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function computeRetryDelayMs(baseDelayMs: number, attempt: number): number {
  const safeBase = Math.max(0, baseDelayMs);
  const safeAttempt = Math.max(1, attempt);
  return Math.min(5_000, safeBase * (2 ** (safeAttempt - 1)));
}
