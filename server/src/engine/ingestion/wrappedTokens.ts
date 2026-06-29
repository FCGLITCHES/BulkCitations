import { normalizeSignalLine } from './normalize.js';

const HEADING_REGEX = /^(?:references?|bibliography|works cited)$/i;
const PAGE_COUNTER_REGEX = /^\s*(?:Page\s+)?\d+\s+(?:of|\/)\s+\d+\s*$/;
const TRAILING_PAGE_COUNTER_REGEX = /\b\d+\s+(?:of|\/)\s+\d+\s*$/i;
const FUSED_PAGE_COUNTER_HEADING_REGEX = /\b\d+\s+(?:of|\/)\s+\d+\s*references?$/i;
const NUMBERED_LEAD_REGEX = /^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+/u;
const DOI_LINE_END_REGEX = /(10\.\d{4,9}\/[^\s]*)\s*$/i;
const URL_LINE_END_REGEX = /(https?:\/\/[^\s]+)\s*$/i;
const DOI_CONTINUATION_TOKEN_REGEX = /^[A-Za-z0-9._;():/%+-]+$/;
const URL_CONTINUATION_TOKEN_REGEX = /^[^\s]+$/;
const DELIMITER_TERMINATED_TOKEN_REGEX = /[./#?=&%-]$/;

export function joinWrappedDoiLines(text: string): string {
  return joinWrappedLines(text, 'doi');
}

export function joinWrappedUrlLines(text: string): string {
  return joinWrappedLines(text, 'url');
}

function joinWrappedLines(text: string, kind: 'doi' | 'url'): string {
  let current = text;
  let next = joinWrappedLinesOnce(current, kind);

  while (next !== current) {
    current = next;
    next = joinWrappedLinesOnce(current, kind);
  }

  return current;
}

function joinWrappedLinesOnce(text: string, kind: 'doi' | 'url'): string {
  const lines = text.split('\n');
  const rebuilt: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index] ?? '';
    const next = lines[index + 1];

    if (next && canJoinWrappedLine(current, next, kind)) {
      rebuilt.push(`${current.trimEnd()}${normalizeSignalLine(next).trim()}`);
      index += 1;
      continue;
    }

    rebuilt.push(current);
  }

  return rebuilt.join('\n');
}

function canJoinWrappedLine(currentLine: string, nextLine: string, kind: 'doi' | 'url'): boolean {
  const current = normalizeSignalLine(currentLine).trimEnd();
  const next = normalizeSignalLine(nextLine).trim();

  if (!current || !next) return false;
  if (shouldPreserveTokenBoundary(next)) return false;
  if (/\s/.test(next)) return false;

  if (kind === 'doi') {
    const doiMatch = current.match(DOI_LINE_END_REGEX);
    if (!doiMatch || !DOI_CONTINUATION_TOKEN_REGEX.test(next)) return false;

    return !/^\d+$/.test(next) || DELIMITER_TERMINATED_TOKEN_REGEX.test(doiMatch[1] ?? '');
  }

  const urlMatch = current.match(URL_LINE_END_REGEX);
  if (!urlMatch || !URL_CONTINUATION_TOKEN_REGEX.test(next)) return false;

  return !/^\d+$/.test(next) || DELIMITER_TERMINATED_TOKEN_REGEX.test(urlMatch[1] ?? '');
}

function shouldPreserveTokenBoundary(line: string): boolean {
  return (
    NUMBERED_LEAD_REGEX.test(line)
    || HEADING_REGEX.test(line)
    || PAGE_COUNTER_REGEX.test(line)
    || TRAILING_PAGE_COUNTER_REGEX.test(line)
    || FUSED_PAGE_COUNTER_HEADING_REGEX.test(line)
  );
}
