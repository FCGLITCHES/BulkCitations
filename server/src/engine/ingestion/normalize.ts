import type { NormalizationMeta } from '../types/ingestion.js';
import { sanitizeInputTextForPipeline } from './canonical.js';

export const PHASE1_TAB_EXPANSION_WIDTH = 4;

const NBSP_REGEX = /\u00A0/g;
const ZERO_WIDTH_REGEX = /[\u200B\uFEFF]/g;
const LEADING_BOM_REGEX = /^\uFEFF/;
const LINE_ENDING_REGEX = /\r\n?/g;
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const REPLACEMENT_CHAR_REGEX = /\uFFFD/g;

export interface NormalizedIngestionText {
  originalText: string;
  normalizedText: string;
  physicalLines: string[];
  logicalLines: string[];
  normalizationMeta: NormalizationMeta;
}

export function normalizeIngestionText(input: string): NormalizedIngestionText {
  const originalText = input;
  const nfcText = originalText.normalize('NFC');
  const nfkcText = nfcText.normalize('NFKC');
  const withoutBom = nfcText.replace(LEADING_BOM_REGEX, '');
  const normalizedLineEndings = withoutBom.replace(LINE_ENDING_REGEX, '\n');
  const sanitized = sanitizeInputTextForPipeline(normalizedLineEndings);
  const expandedTabs = sanitized.replace(/\t/g, ' '.repeat(PHASE1_TAB_EXPANSION_WIDTH));

  const normalizedText = expandedTabs;
  const physicalLines = normalizedText.split('\n');
  const logicalLines = physicalLines.filter((line) => !isLogicalEmptyLine(line)).map(normalizeSignalLine);

  return {
    originalText,
    normalizedText,
    physicalLines,
    logicalLines,
    normalizationMeta: {
      hadBom: LEADING_BOM_REGEX.test(originalText),
      hadLineEndingNormalization: LINE_ENDING_REGEX.test(originalText),
      hadTabs: /\t/.test(originalText),
      hadNbsp: NBSP_REGEX.test(originalText),
      hadZeroWidth: ZERO_WIDTH_REGEX.test(originalText),
      hadUnicodeNormalizationChange: originalText !== nfcText,
      hadCompatibilityNormalization: nfcText !== nfkcText,
      hadControlChars: CONTROL_CHAR_REGEX.test(originalText),
      hadReplacementChars: REPLACEMENT_CHAR_REGEX.test(originalText),
    },
  };
}

export function normalizeSignalLine(line: string): string {
  return line.replace(NBSP_REGEX, ' ').replace(ZERO_WIDTH_REGEX, '');
}

export function isLogicalEmptyLine(line: string): boolean {
  return normalizeSignalLine(line).trim().length === 0;
}

export function leadingWhitespaceWidth(line: string): number {
  const match = line.match(/^\s*/);
  return match?.[0].length ?? 0;
}

export function containsYearDoiOrUrl(line: string): boolean {
  return (
    /\(\d{4}[a-z]?\)|\b(?:19|20)\d{2}[a-z]?\b/.test(line)
    || /\b10\.\d{4,9}\/\S+\b/i.test(line)
    || /https?:\/\/\S+|www\.\S+/i.test(line)
  );
}

export function splitLogicalBlocks(physicalLines: string[]): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of physicalLines) {
    if (isLogicalEmptyLine(line)) {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
      continue;
    }

    current.push(normalizeSignalLine(line));
  }

  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }

  return blocks;
}
