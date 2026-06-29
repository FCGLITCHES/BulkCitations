import type { ErrorCode } from './codes.js';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    Error.captureStackTrace?.(this, AppError);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
