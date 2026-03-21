import { fileTypeFromBuffer } from 'file-type';
import * as pdfParseModule from 'pdf-parse-new';
import type { InputProfile } from '@shared/schema';
import type { V2Stage } from '../contracts.js';
import { createStageDiagnostic, normalizeDoiValue, normalizeWhitespace } from '../utils.js';

const pdfParse: (buffer: Buffer) => Promise<{ text: string }> =
  typeof pdfParseModule === 'function' ? pdfParseModule : (pdfParseModule?.default ?? pdfParseModule);

export const INGESTION_LIMITS = {
  maxBytes: 5_000_000,
  maxCitationCount: 2_000,
  maxUrlLength: 2_048,
  maxDoiListItems: 500,
} as const;

function ingestFailure(message: string): never {
  throw new Error(message);
}

function splitBibRecords(content: string): string[] {
  const matches = content.match(/@\w+\s*{[\s\S]*?\n}/g);
  return matches?.map((record) => record.trim()).filter(Boolean) ?? [content];
}

function splitRisRecords(content: string): string[] {
  const parts = content.split(/\nER\s+-\s*\n?/i);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function normalizeDoi(raw: string): string | null {
  const doi = normalizeDoiValue(raw);
  return /^10\.\d{4,}\/\S+$/i.test(doi) ? doi : null;
}

function detectExplicitSchema(text: string): InputProfile | null {
  if (/@\w+\s*\{[^,]+,/.test(text)) {
    return {
      structure: 'structured',
      confidence: 0.99,
      inputType: 'bibtex',
      estimatedCount: (text.match(/@\w+\s*\{/g) ?? []).length,
      hasDois: /10\.\d{4,}\/\S+/i.test(text),
      hasUrls: /https?:\/\//i.test(text),
      styleHints: ['bibtex'],
      signals: ['explicit_bibtex_schema'],
    };
  }
  if (/^TY\s+-\s+\w+/m.test(text)) {
    return {
      structure: 'structured',
      confidence: 0.99,
      inputType: 'ris',
      estimatedCount: (text.match(/^TY\s+-/gm) ?? []).length,
      hasDois: /10\.\d{4,}\/\S+/i.test(text),
      hasUrls: /https?:\/\//i.test(text),
      styleHints: ['ris'],
      signals: ['explicit_ris_schema'],
    };
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((line) => Boolean(normalizeDoi(line)))) {
    return {
      structure: 'structured',
      confidence: 0.97,
      inputType: 'doi_list',
      estimatedCount: lines.length,
      hasDois: true,
      hasUrls: lines.some((line) => /^https?:\/\//i.test(line)),
      styleHints: ['doi_list'],
      signals: ['explicit_doi_list_schema'],
    };
  }

  return null;
}

function estimateCount(text: string): number {
  return Math.max(
    text.split(/\n\s*\n/).filter((part) => part.trim()).length,
    (text.match(/^\s*[\[\(]?\d+[\]\)\.]\s+\w/gm) ?? []).length,
    1,
  );
}

function classifyInputProfile(text: string): InputProfile {
  const explicit = detectExplicitSchema(text);
  if (explicit) return explicit;

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const avgLineLen = lines.reduce((sum, line) => sum + line.length, 0) / Math.max(lines.length, 1);
  const signals: string[] = [];
  let semiScore = 0;
  let unstructuredScore = 0;

  const numberedStarts = (text.match(/^\s*[\[\(]?\d+[\]\)\.]\s+\w/gm) ?? []).length;
  const authorStarts = (text.match(/^[A-Z][A-Za-z'’-]+,\s+[A-Z]/gm) ?? []).length;
  const footnoteMarkers = (text.match(/[¹²³⁴⁵⁶⁷⁸⁹]|\^\d+/g) ?? []).length;
  const doiHits = (text.match(/10\.\d{4,}\/\S+/g) ?? []).length;

  if (numberedStarts >= 2) {
    semiScore += 1;
    signals.push('numbered_lines');
  }
  if (authorStarts >= 2) {
    semiScore += 2;
    signals.push('author_line_starts');
  }
  if (doiHits >= 1) {
    semiScore += 1;
    signals.push('doi_density');
  }
  if (avgLineLen > 200) {
    unstructuredScore += 2;
    signals.push('long_prose_lines');
  }
  if (footnoteMarkers >= 2) {
    unstructuredScore += 2;
    signals.push('footnote_markers');
  }
  if (lines.length < 3 && text.length > 500) {
    unstructuredScore += 2;
    signals.push('single_block');
  }

  if (semiScore > unstructuredScore && semiScore >= 2) {
    return {
      structure: 'semi_structured',
      confidence: Math.min(0.9, semiScore / Math.max(semiScore + unstructuredScore, 1)),
      inputType: 'mixed_styles',
      estimatedCount: estimateCount(text),
      hasDois: doiHits > 0,
      hasUrls: /https?:\/\//i.test(text),
      styleHints: numberedStarts > 0 ? ['numbered_list'] : [],
      signals,
    };
  }

  if (unstructuredScore >= 2) {
    return {
      structure: 'unstructured',
      confidence: Math.min(0.85, unstructuredScore / Math.max(semiScore + unstructuredScore, 1)),
      inputType: footnoteMarkers >= 2 ? 'prose_footnotes' : 'plain_blob',
      estimatedCount: estimateCount(text),
      hasDois: doiHits > 0,
      hasUrls: /https?:\/\//i.test(text),
      styleHints: [],
      signals,
    };
  }

  return {
    structure: 'unknown',
    confidence: 0.4,
    inputType: 'unknown',
    estimatedCount: estimateCount(text),
    hasDois: doiHits > 0,
    hasUrls: /https?:\/\//i.test(text),
    styleHints: [],
    signals,
  };
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || detected.mime !== 'application/pdf') {
    ingestFailure('invalid_mime_type');
  }
  try {
    const result = await pdfParse(buffer);
    const text = (result.text ?? '').trim();
    if (text.length < 20) {
      ingestFailure('pdf_no_extractable_text');
    }
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('password') || message.includes('encrypted')) ingestFailure('pdf_encrypted');
    if (message.includes('invalid') || message.includes('truncated')) ingestFailure('pdf_truncated');
    ingestFailure('pdf_parse_error');
  }
}

function validateUrlSafety(rawUrl: string): URL {
  if (rawUrl.length > INGESTION_LIMITS.maxUrlLength) ingestFailure('url_too_long');
  const parsed = new URL(rawUrl);
  if (!/^https?:$/i.test(parsed.protocol)) ingestFailure('invalid_url_protocol');
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(parsed.hostname)) {
    ingestFailure('unsafe_url_target');
  }
  return parsed;
}

export function createIngestStage(): V2Stage {
  return {
    id: 'ingest',
    async run(context) {
      const startedAt = Date.now();
      const { sourceType, content } = context.request;
      if (Buffer.byteLength(content, 'utf8') > INGESTION_LIMITS.maxBytes) {
        ingestFailure('input_too_large');
      }
      let rawItems: string[] = [];

      switch (sourceType) {
        case 'text':
          rawItems = [content.trim()];
          break;
        case 'doi_list':
          rawItems = content
            .split(/[\r?\n,;]+/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => normalizeDoi(line))
            .filter((line): line is string => Boolean(line));
          if (rawItems.length > INGESTION_LIMITS.maxDoiListItems) ingestFailure('doi_list_too_large');
          break;
        case 'bib':
          rawItems = splitBibRecords(content);
          break;
        case 'ris':
          rawItems = splitRisRecords(content);
          break;
        case 'pdf_base64': {
          const buffer = Buffer.from(content, 'base64');
          rawItems = [await extractPdfText(buffer)];
          break;
        }
        case 'url': {
          const [{ JSDOM }, { Readability }] = await Promise.all([
            import('jsdom'),
            import('@mozilla/readability'),
          ]);
          const safeUrl = validateUrlSafety(content);
          const response = await fetch(safeUrl, { method: 'GET', signal: AbortSignal.timeout(10_000) });
          const html = await response.text();
          const dom = new JSDOM(html, { url: safeUrl.toString() });
          const article = new Readability(dom.window.document).parse();
          const extracted = normalizeWhitespace(article?.textContent ?? '');
          if (extracted.length < 50) {
            ingestFailure('url_no_content_extracted');
          }
          rawItems = [extracted];
          break;
        }
        default:
          rawItems = [content.trim()];
      }

      if (rawItems.length > INGESTION_LIMITS.maxCitationCount) {
        ingestFailure('citation_count_limit_exceeded');
      }

      const inputProfile = classifyInputProfile(rawItems.join('\n\n'));

      return {
        ...context,
        rawItems,
        inputProfile,
        jobDebug: context.debugEnabled
          ? {
            ...context.jobDebug,
            ingest: {
              sourceType,
              itemCount: rawItems.length,
              inputProfile,
            },
          }
          : context.jobDebug,
        pipelineLog: [
          ...context.pipelineLog,
          createStageDiagnostic(
            'ingest',
            'success',
            `Ingested ${rawItems.length} source item(s) from ${sourceType}.`,
            { sourceType, itemCount: rawItems.length, inputProfile },
            Date.now() - startedAt,
          ),
        ],
      };
    },
  };
}
