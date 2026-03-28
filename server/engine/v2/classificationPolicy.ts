import type { CitationStyle } from '@shared/schema';
import {
  APA_THESIS_PATTERN,
  AUTHOR_COLON_VANCOUVER_PATTERN,
  CHICAGO_CHAPTER_PATTERN,
  CHICAGO_AUTHOR_DATE_JOURNAL_PATTERN,
  CHICAGO_AUTHOR_DATE_REPORT_PATTERN,
  CHICAGO_BOOK_PATTERN,
  HARVARD_BOOK_PATTERN,
  HARVARD_CONFERENCE_PATTERN,
  HARVARD_JOURNAL_PATTERN,
  HARVARD_WEBSITE_PATTERN,
  IEEE_CONFERENCE_PATTERN,
  MLA_BOOK_PATTERN,
  MLA_CHAPTER_PATTERN,
  MLA_THESIS_PATTERN,
  MLA_WEBSITE_SIGNAL_PATTERN,
  VANCOUVER_ARTICLE_NUMBER_PATTERN,
  VANCOUVER_COMPACT_JOURNAL_PATTERN,
} from './deterministicPatterns.js';
import { buildContainerHints, resolveWinnerContainer } from './containerHints.js';
import { areReferenceTypesMergeCompatible, resolveReferenceTypeFromEvidence } from './typeResolution.js';

export {
  buildContainerHints,
  resolveWinnerContainer,
  areReferenceTypesMergeCompatible,
  resolveReferenceTypeFromEvidence,
};

export function buildStyleSignalScore(normalized: string, style: CitationStyle): number {
  switch (style) {
    case 'ieee':
      return (
        (/^\[\d+\]/.test(normalized) ? 8 : 0)
        + (/\bin\s+Proc\b|\bArt\.?\s*no\.?/i.test(normalized) ? 4 : 0)
        + (IEEE_CONFERENCE_PATTERN.test(normalized) ? 8 : 0)
        + (/^(?:\[\d+\]\s*)?(?:[\p{Lu}]\.\s*){1,4}[\p{Lu}][\p{L}'’-]+/u.test(normalized) ? 3 : 0)
        - ((MLA_BOOK_PATTERN.test(normalized) || CHICAGO_BOOK_PATTERN.test(normalized)) ? 7 : 0)
        - ((/\bvol\.\s*\d+/i.test(normalized) && /,\s*(?:1[5-9]\d{2}|20\d{2}),\s*pp\./i.test(normalized)) ? 5 : 0)
      );
    case 'vancouver':
      return (
        (/\b(?:1[5-9]\d{2}|20\d{2});\d+(?:\(\d+\))?:[A-Za-z]?\d+/i.test(normalized) ? 9 : 0)
        + (VANCOUVER_ARTICLE_NUMBER_PATTERN.test(normalized) ? 8 : 0)
        + (VANCOUVER_COMPACT_JOURNAL_PATTERN.test(normalized) ? 8 : 0)
        + (AUTHOR_COLON_VANCOUVER_PATTERN.test(normalized) ? 8 : 0)
        + (/^(?:[\p{Lu}][\p{L}'’-]+\s+[\p{Lu}]{1,4},\s*){2,}/u.test(normalized) ? 4 : 0)
        - ((MLA_BOOK_PATTERN.test(normalized) || CHICAGO_BOOK_PATTERN.test(normalized)) ? 6 : 0)
      );
    case 'harvard':
      return (
        (HARVARD_JOURNAL_PATTERN.test(normalized) ? 8 : 0)
        + (HARVARD_CONFERENCE_PATTERN.test(normalized) ? 8 : 0)
        + (HARVARD_BOOK_PATTERN.test(normalized) ? 8 : 0)
        + (HARVARD_WEBSITE_PATTERN.test(normalized) ? 8 : 0)
        + (/\bviewed\b|\bAvailable at:/i.test(normalized) ? 3 : 0)
      );
    case 'mla':
      return (
        (/\bvol\.\s*\d+/i.test(normalized) && /,\s*(?:1[5-9]\d{2}|20\d{2}),\s*pp\./i.test(normalized) ? 8 : 0)
        + (MLA_CHAPTER_PATTERN.test(normalized) ? 8 : 0)
        + (MLA_THESIS_PATTERN.test(normalized) ? 7 : 0)
        + (MLA_BOOK_PATTERN.test(normalized) ? 7 : 0)
        + (MLA_WEBSITE_SIGNAL_PATTERN.test(normalized) ? 7 : 0)
        + ((/"[^"]+\."\s+.+?,\s*(?:1[5-9]\d{2}|20\d{2}),\s*(?:https?:\/\/|www\.)/i.test(normalized)) ? 5 : 0)
      );
    case 'chicago':
      return (
        (/\b\d+,\s*no\.\s*[^,]+\s*\((?:1[5-9]\d{2}|20\d{2})\):\s*[A-Za-z]?\d+/i.test(normalized) ? 8 : 0)
        + (CHICAGO_AUTHOR_DATE_JOURNAL_PATTERN.test(normalized) ? 8 : 0)
        + (CHICAGO_AUTHOR_DATE_REPORT_PATTERN.test(normalized) ? 7 : 0)
        + (CHICAGO_CHAPTER_PATTERN.test(normalized) ? 8 : 0)
        + (CHICAGO_BOOK_PATTERN.test(normalized) ? 9 : 0)
        + (/"[^"]+"\.\s+.+\.\s+Accessed\b/i.test(normalized) ? 5 : 0)
        + (/[A-Z][A-Za-z'’-]+:\s+[^,]+,\s*(?:1[5-9]\d{2}|20\d{2})\.?$/i.test(normalized) ? 4 : 0)
        - (MLA_WEBSITE_SIGNAL_PATTERN.test(normalized) ? 6 : 0)
      );
    case 'apa':
      return (
        (/^[^.]+\(\d{4}[a-z]?\)\./.test(normalized) ? 7 : 0)
        + (APA_THESIS_PATTERN.test(normalized) ? 8 : 0)
        + (/^[^.]+\(\d{4}[a-z]?\)\.\s+.+?\.\s+[^:]+:\s+[^.]+(?:\.\s*(?:https?:\/\/|www\.)\S+)?$/i.test(normalized) ? 6 : 0)
        + (/&\s+[A-Z][a-zÀ-ÿ]+,\s*[A-Z]\./.test(normalized) ? 3 : 0)
      );
    default:
      return 0;
  }
}
