import { readFile } from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import * as pdfParseModule from 'pdf-parse-new';
import { normaliseEncoding } from './engine/stages/normaliseEncoding.js';

const pdfParse: (buffer: Buffer) => Promise<{ text: string }> =
  typeof pdfParseModule === 'function' ? pdfParseModule : (pdfParseModule?.default ?? pdfParseModule);

export const PDF_MAX_BYTES = 10 * 1024 * 1024;

export const PDF_ERROR_MESSAGES = {
  pdf_encrypted: 'This PDF is password-protected. Remove the password and retry.',
  pdf_corrupt: 'The file appears to be damaged.',
  pdf_no_text: 'No text could be extracted. This PDF may be scanned.',
  pdf_too_large: 'File exceeds the 10 MB limit.',
  source_unavailable: 'The uploaded PDF is no longer available. Please upload it again.',
  job_expired: 'This PDF conversion job expired. Please retry the upload.',
} as const;

export type PdfErrorCode = keyof typeof PDF_ERROR_MESSAGES;

export class PdfProcessingError extends Error {
  code: PdfErrorCode;

  constructor(code: PdfErrorCode, message = PDF_ERROR_MESSAGES[code]) {
    super(message);
    this.name = 'PdfProcessingError';
    this.code = code;
  }
}

export function isPdfProcessingError(error: unknown): error is PdfProcessingError {
  return error instanceof PdfProcessingError;
}

export function getPdfErrorMessage(code: PdfErrorCode): string {
  return PDF_ERROR_MESSAGES[code];
}

export function getPdfErrorStatusCode(code: PdfErrorCode): number {
  switch (code) {
    case 'pdf_too_large':
      return 413;
    case 'source_unavailable':
    case 'job_expired':
      return 404;
    default:
      return 422;
  }
}

function mapPdfParseFailure(error: unknown): PdfProcessingError {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('password') || message.includes('encrypted')) {
    return new PdfProcessingError('pdf_encrypted');
  }
  if (
    message.includes('invalid')
    || message.includes('truncated')
    || message.includes('corrupt')
    || message.includes('xref')
    || message.includes('unexpected end')
    || message.includes('malformed')
  ) {
    return new PdfProcessingError('pdf_corrupt');
  }
  return new PdfProcessingError('pdf_corrupt');
}

export function assertPdfByteSize(byteSize: number): void {
  if (byteSize > PDF_MAX_BYTES) {
    throw new PdfProcessingError('pdf_too_large');
  }
}

export function normalizeExtractedPdfText(text: string): string {
  return normaliseEncoding(text).replace(/\0/g, '').trim();
}

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<{ text: string; byteSize: number }> {
  assertPdfByteSize(buffer.byteLength);

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || detected.mime !== 'application/pdf') {
    throw new PdfProcessingError('pdf_corrupt');
  }

  try {
    const result = await pdfParse(buffer);
    const text = normalizeExtractedPdfText(result.text ?? '');
    if (text.length < 20) {
      throw new PdfProcessingError('pdf_no_text');
    }
    return {
      text,
      byteSize: buffer.byteLength,
    };
  } catch (error) {
    if (isPdfProcessingError(error)) throw error;
    throw mapPdfParseFailure(error);
  }
}

export async function readPdfBufferFromFile(filePath: string): Promise<Buffer> {
  try {
    return await readFile(filePath);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : '';
    if (code === 'ENOENT') {
      throw new PdfProcessingError('source_unavailable');
    }
    throw error;
  }
}

export async function extractPdfTextFromFile(filePath: string): Promise<{ text: string; byteSize: number }> {
  const buffer = await readPdfBufferFromFile(filePath);
  return extractPdfTextFromBuffer(buffer);
}
