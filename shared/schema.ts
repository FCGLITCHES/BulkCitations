import { z } from 'zod';

// Citation style type - lowercase for internal use
// Internal names: harvard-ctr (Cite Them Right), chicago-ad (author-date), chicago-nb (notes-biblio)
export type CitationStyle = 'apa' | 'mla' | 'harvard-ctr' | 'chicago-ad' | 'chicago-nb' | 'ieee' | 'vancouver' | 'auto';

/** UI/API may send 'harvard' or 'chicago'; normalize to internal style for CSL and strict renderer. */
export function normalizeCitationStyle(style: string): CitationStyle {
  const s = (style || '').toLowerCase().trim();
  if (s === 'harvard') return 'harvard-ctr';
  if (s === 'chicago') return 'chicago-ad';
  if (['apa', 'mla', 'harvard-ctr', 'chicago-ad', 'chicago-nb', 'ieee', 'vancouver', 'auto'].includes(s)) {
    return s as CitationStyle;
  }
  return 'apa';
}

// Reference type
export type ReferenceType = 'journal' | 'book' | 'bookChapter' | 'conference' | 'website' | 'report' | 'thesis' | 'preprint' | 'other';

// Dynamic pattern hit (debugging + future learning)
export interface PatternHit {
  id: string;
  fields: string[];
  matched: string;
  category?: string;
}

// Authority Data Type
export interface AuthorityData {
  title: string;
  authors: string[];
  journal: string;
  year?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
}

// Confidence Score Breakdown
export interface ConfidenceResult {
  score: number; // 0-100
  breakdown: {
    journal?: number; // Match score for Journal
    fields?: number;  // Match score for specific fields (year, vol, pages)
    rules: number;    // Rules assertion score
  };
  isSuspicious: boolean; // Flag if authority title/authors completely mismatch input
}

// Individual assertion result
export interface AssertionDetail {
  id: string;
  description: string;
  severity: 'error' | 'warning';
  passed: boolean;
}

// Aggregate assertion summary (for badge: "APA: 9/10 ✓")
export interface AssertionSummary {
  total: number;
  passed: number;
  failed: number;
  failedCritical: number;   // severity=error
  failedFormatting: number; // severity=warning
  details: AssertionDetail[];
}

// Character-level highlight for inline annotation of failed assertions
export interface AssertionHighlight {
  start: number;
  end: number;
  ruleId: string;
  message: string;
  severity: 'error' | 'warning';
}

// Citation Cluster
export interface Cluster {
  clusterId: string;
  members: ConvertedReference[];
  bestConfidenceScore?: number;
  bestMemberId?: string;
  warnings?: string[];
  winnerDiagnostics?: {
    chosenMemberId: string;
    chosenReasons: string[];
    memberDiagnostics: Array<{
      id: string;
      score: number;
      reasons: string[];
      referenceType?: ReferenceType;
      styleDetectionFailed?: boolean;
      hasEtAl?: boolean;
      hasAuthorityValidation?: boolean;
      hasYear?: boolean;
    }>;
  };
}

// Parsed reference data structure
export interface ParsedReference {
  authors?: string[];
  title?: string;
  year?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  'article-number'?: string;
  publisher?: string;
  placeOfPublication?: string;
  url?: string;
  accessed?: string;
  bookTitle?: string;
  conferenceTitle?: string;
  reportNumber?: string;
  institution?: string;
  edition?: string;
  editor?: string;
  /** Parse recovery/debug codes: invalid-year-recovered, merged-volume-issue, venue-unknown, etc. */
  parseWarnings?: string[];
  /** When multiple plausible years exist, for debugging */
  yearCandidates?: string[];
}

// Converted reference result
export interface ConvertedReference {
  id: string;
  originalText: string;
  convertedText: string;
  referenceType: ReferenceType;
  parsedData: ParsedReference;
  inputStyle: string;
  outputStyle: string;
  errors?: string[];
  warnings?: string[];
  confidence?: ConfidenceResult;
  authorityData?: AuthorityData; // strict metadata validation source, OPT IN
  clusterId?: string; // used if batched with similar citations
  patternHits?: PatternHit[];
  workKey?: string;
  authorityStatus?: AuthorityStatus;
  styleDetectionFailed?: boolean;
  assertionSummary?: AssertionSummary;
  assertionHighlights?: AssertionHighlight[];
  /** True when authors are initials-only (e.g. "Smith, J."); keep initials unless we have high-confidence metadata. */
  authorInitialsOnly?: boolean;
  /** True when full names were filled from DOI/metadata lookup (confidence-gated only). */
  authorsExpandedFromMetadata?: boolean;
}

// Authority lookup status (trust + analytics)
export type AuthorityStatus =
  | 'none'      // feature off
  | 'blocked'   // not Pro
  | 'skipped'   // pro but enrichWithAuthority=false or not eligible
  | 'cache_hit'
  | 'fetched'
  | 'no_match'
  | 'error';

// Conversion response
export interface ConversionResponse {
  convertedReferences: ConvertedReference[];
  clusters?: Cluster[];
  errors?: string[];
}

// Validation schemas
export const conversionRequestSchema = z.object({
  references: z.array(z.string().min(1)),
  inputStyle: z.string(),
  outputStyle: z.string(),
  enrichWithAuthority: z.boolean().optional().default(false),
  isPro: z.boolean().optional().default(false),
});

// In-memory storage types
export interface InsertReference {
  originalText: string;
  inputStyle: string;
  outputStyle: string;
  parsedData?: ParsedReference | null;
  convertedText?: string | null;
  referenceType?: string | null;
  confidenceScore?: number | null;
  workKey?: string | null;
  patternHits?: PatternHit[] | null;
  authorityStatus?: AuthorityStatus | null;
}

export interface Reference extends InsertReference {
  id: number;
  createdAt: Date;
}
