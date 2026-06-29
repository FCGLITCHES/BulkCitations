import { env } from '../config.js';
import type { CitationStyle, ReferenceType } from '../engine/types/citation.js';
import type { ExtractionBioDebug, ExtractionEntityDebug } from '../engine/types/extractionMeta.js';
import type { ExtractedFieldKey } from '../engine/utils/fields.js';
import { createMlError, ML_ERROR_CODES, MLRequestError, type MLErrorCode } from './errors.js';
import { instrumentedFetch } from '../services/instrumentedFetch.js';

export interface StyleDetectionPrediction {
  decision?: 'supported_exact' | 'family_only' | 'known_unsupported_exact' | 'unknown_or_ood' | 'not_citation_like';
  family?: string;
  exactStyle?: CitationStyle | null;
  knownUnsupportedExact?: string | null;
  supportedExact?: boolean;
  abstain?: boolean;
  confidence?: number;
  margin?: number;
  oodScore?: number;
  reasonCodes?: string[];
  inputProfile?: string;
  heuristicAgreement?: boolean | null;
  modelVersion?: string | null;
  featureVersion?: string | null;
  thresholdSetVersion?: string | null;
  primary: { style: CitationStyle; confidence: number };
  secondary: { style: CitationStyle; confidence: number } | null;
}

export interface MLRequestOptions {
  signal?: AbortSignal;
}

export interface MlPersonName {
  family: string | null;
  given: string | null;
  literal?: string | null;
  isCorporate: boolean;
}

export interface ExtractResult {
  fields: Partial<Record<ExtractedFieldKey, unknown>>;
  fieldConfidences: Partial<Record<ExtractedFieldKey, number>>;
  overallConfidence: number;
  modelVersion: string | null;
  featureVersion: string | null;
  styleUsed: string;
  uncertainFields: ExtractedFieldKey[];
  entities?: ExtractionEntityDebug[];
  bio?: ExtractionBioDebug;
}

export interface ExtractBatchError {
  index: number;
  code: MLErrorCode;
  message?: string;
}

export interface ExtractBatchResponse {
  results: Array<ExtractResult | null>;
  errors?: ExtractBatchError[];
}

export interface TypePrediction {
  type: ReferenceType;
  confidence: number;
}

export interface MLHealthResponse {
  status: 'ok' | 'degraded' | 'unavailable';
  activeModelVersion: string | null;
  featureVersion: string | null;
  styleModelVersion?: string | null;
  styleFeatureVersion?: string | null;
  styleBundleSource?: string | null;
  styleThresholdSetVersion?: string | null;
  stylePolicySource?: string | null;
  artifactsReady: boolean;
  lastSuccessfulInferenceAt: string | null;
  backend?: string;
  modelDir?: string;
  pinnedModelVersion?: string | null;
  warmupReady?: boolean;
  warmupError?: string | null;
  bundleValidationErrors?: string[];
  bundleValidationWarnings?: string[];
}

export interface MLClient {
  health(): Promise<MLHealthResponse>;
  detectStyle(texts: string[], options?: MLRequestOptions): Promise<StyleDetectionPrediction[]>;
  extract(texts: string[], styles: CitationStyle[]): Promise<ExtractBatchResponse>;
  authorNer(authorTexts: string[]): Promise<Array<{ authors: MlPersonName[]; confidence: number }>>;
  classifyType(texts: string[]): Promise<TypePrediction[]>;
}

export class HttpMLClient implements MLClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl = env.ML_SERVICE_URL, timeoutMs = env.ML_SERVICE_TIMEOUT_MS) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  health(): Promise<MLHealthResponse> {
    return this.request<MLHealthResponse>('GET', '/v1/ml/health');
  }

  detectStyle(texts: string[], options: MLRequestOptions = {}): Promise<StyleDetectionPrediction[]> {
    return this.request('POST', '/v1/ml/detect-style', { texts }, options.signal);
  }

  async extract(texts: string[], styles: CitationStyle[]): Promise<ExtractBatchResponse> {
    if (texts.length !== styles.length) {
      throw createMlError(
        'BAD_REQUEST',
        'ML extract request requires texts and styles arrays with identical lengths.',
      );
    }

    const attempts = 2;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await this.requestRaw('POST', '/v1/ml/extract', { texts, styles });
        if (response.status !== 200 && response.status !== 207) {
          throw mapHttpStatusToMlError(response.status);
        }

        let payload: ExtractBatchResponse;
        try {
          payload = (await response.json()) as ExtractBatchResponse;
        } catch {
          throw createMlError('INTERNAL_ERROR', 'ML extract response was not valid JSON.');
        }

        validateExtractPayload(payload, texts.length);
        return payload;
      } catch (error) {
        lastError = error;
        const mlError = toMlRequestError(error);
        if (attempt < attempts - 1 && shouldRetry(mlError)) {
          await delay(1_000);
          continue;
        }
        break;
      }
    }

    throw toMlRequestError(lastError);
  }

  authorNer(authorTexts: string[]): Promise<Array<{ authors: MlPersonName[]; confidence: number }>> {
    return this.request('POST', '/v1/ml/author-ner', { authorTexts });
  }

  classifyType(texts: string[]): Promise<TypePrediction[]> {
    return this.request('POST', '/v1/ml/classify-type', { texts });
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.requestRaw(method, path, body, signal);
    if (!response.ok) {
      throw mapHttpStatusToMlError(response.status);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw createMlError('INTERNAL_ERROR', `ML service response for ${path} was not valid JSON.`);
    }
  }

  private async requestRaw(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const cleanupAbortLink = linkAbortSignal(signal, controller);
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.baseUrl}${path}`;
      if (body === undefined) {
        return await instrumentedFetch({
          provider: 'ml',
          route: path,
          method,
          url,
          signal: controller.signal,
        });
      }
      return await instrumentedFetch({
        provider: 'ml',
        route: path,
        method,
        url,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw createMlError('INFERENCE_TIMEOUT', `ML service request to ${path} timed out.`);
      }
      throw createMlError(
        'MODEL_UNAVAILABLE',
        error instanceof Error ? error.message : `ML service request to ${path} failed.`,
      );
    } finally {
      clearTimeout(timeout);
      cleanupAbortLink();
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mapHttpStatusToMlError(status: number): MLRequestError {
  if (status === 400) {
    return createMlError('BAD_REQUEST', `ML extract request failed with status ${status}.`, status);
  }
  if (status === 422) {
    return createMlError('STYLE_UNSUPPORTED', `ML extract request failed with status ${status}.`, status);
  }
  if (status === 503) {
    return createMlError('MODEL_UNAVAILABLE', `ML extract request failed with status ${status}.`, status);
  }
  if (status >= 500) {
    return createMlError('INTERNAL_ERROR', `ML extract request failed with status ${status}.`, status);
  }
  return createMlError('BAD_REQUEST', `ML extract request failed with status ${status}.`, status);
}

function toMlRequestError(error: unknown): MLRequestError {
  if (error instanceof MLRequestError) {
    return error;
  }

  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const code = error.code as string;
    if (ML_ERROR_CODES.includes(code as MLErrorCode)) {
      const message = 'message' in error && typeof error.message === 'string'
        ? error.message
        : 'ML extract request failed.';
      const status = 'status' in error && typeof error.status === 'number'
        ? error.status
        : undefined;
      return createMlError(code as MLErrorCode, message, status);
    }
  }
  if (error instanceof Error) {
    return createMlError('INTERNAL_ERROR', error.message);
  }
  return createMlError('INTERNAL_ERROR', 'ML extract request failed.');
}

function shouldRetry(error: MLRequestError): boolean {
  return error.code === 'INFERENCE_TIMEOUT'
    || error.code === 'MODEL_UNAVAILABLE'
    || error.code === 'INTERNAL_ERROR';
}

function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) {
    return () => {};
  }

  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }

  const onAbort = () => {
    controller.abort(signal.reason);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  return () => {
    signal.removeEventListener('abort', onAbort);
  };
}

function validateExtractPayload(payload: ExtractBatchResponse, requestLength: number): void {
  if (!Array.isArray(payload.results) || payload.results.length !== requestLength) {
    throw createMlError(
      'INTERNAL_ERROR',
      'ML extract response length did not match the request length.',
    );
  }

  const seenErrorIndexes = new Set<number>();
  for (const error of payload.errors ?? []) {
    if (!Number.isInteger(error.index) || error.index < 0 || error.index >= requestLength) {
      throw createMlError('INTERNAL_ERROR', 'ML extract response returned an out-of-range error index.');
    }
    if (seenErrorIndexes.has(error.index)) {
      throw createMlError('INTERNAL_ERROR', 'ML extract response returned a duplicate error index.');
    }
    seenErrorIndexes.add(error.index);
    if (payload.results[error.index] !== null) {
      throw createMlError(
        'INTERNAL_ERROR',
        'ML extract response returned both a result and an error for the same index.',
      );
    }
  }
}
