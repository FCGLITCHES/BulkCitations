export const ML_ERROR_CODES = [
  'INFERENCE_TIMEOUT',
  'MODEL_UNAVAILABLE',
  'INTERNAL_ERROR',
  'STYLE_UNSUPPORTED',
  'BAD_REQUEST',
  'CIRCUIT_OPEN',
  'QUEUE_FULL',
] as const;

export type MLErrorCode = (typeof ML_ERROR_CODES)[number];

export interface MLError {
  code: MLErrorCode;
  message: string;
  status?: number;
}

export class MLRequestError extends Error implements MLError {
  readonly code: MLErrorCode;
  readonly status?: number;

  constructor(code: MLErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'MLRequestError';
    this.code = code;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export function createMlError(
  code: MLErrorCode,
  message: string,
  status?: number,
): MLRequestError {
  return new MLRequestError(code, message, status);
}

export function toMlError(error: unknown): MLError {
  if (error instanceof MLRequestError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.status !== undefined ? { status: error.status } : {}),
    };
  }

  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: error.message,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'Unknown ML error.',
  };
}

export function isTransientMlErrorCode(code: MLErrorCode): boolean {
  return code === 'INFERENCE_TIMEOUT' || code === 'MODEL_UNAVAILABLE' || code === 'INTERNAL_ERROR';
}
