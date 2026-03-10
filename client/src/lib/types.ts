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

export interface ConfidenceResult {
  score: number;
  breakdown: {
    journal?: number;
    fields?: number;
    rules: number;
  };
  isSuspicious: boolean;
}

export interface AssertionDetail {
  id: string;
  description: string;
  severity: 'error' | 'warning';
  passed: boolean;
}

export interface AssertionSummary {
  total: number;
  passed: number;
  failed: number;
  failedCritical: number;
  failedFormatting: number;
  details: AssertionDetail[];
}

export interface AssertionHighlight {
  start: number;
  end: number;
  ruleId: string;
  message: string;
  severity: 'error' | 'warning';
}

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

export type ReferenceType =
  | "journal"
  | "book"
  | "bookChapter"
  | "conference"
  | "website"
  | "report"
  | "thesis"
  | "other";

export type AuthorityStatus =
  | "none"
  | "blocked"
  | "skipped"
  | "cache_hit"
  | "fetched"
  | "no_match"
  | "error";

export type HealthState = "clean" | "review" | "action_needed";

export interface ConvertedReference {
  id: string;
  originalText: string;
  convertedText: string;
  referenceType: ReferenceType;
  parsedData: any;
  inputStyle: string;
  outputStyle: string;
  errors?: string[];
  warnings?: string[];
  confidence?: ConfidenceResult;
  authorityData?: AuthorityData;
  clusterId?: string;
  authorityStatus?: AuthorityStatus;
  workKey?: string;
  patternHits?: { id: string; fields: string[]; matched: string; category?: string }[];
  styleDetectionFailed?: boolean;
  assertionSummary?: AssertionSummary;
  assertionHighlights?: AssertionHighlight[];
  authorInitialsOnly?: boolean;
  authorsExpandedFromMetadata?: boolean;
  healthState?: HealthState;
  healthReasons?: string[];
}

export interface ConversionResponse {
  convertedReferences: ConvertedReference[];
  clusters?: Cluster[];
  errors?: string[];
}

export interface ConversionRequest {
  references: string[];
  inputStyle: string;
  outputStyle: string;
  isPro?: boolean;
  enrichWithAuthority?: boolean;
}

export const CITATION_STYLES = [
  { value: 'apa', label: 'APA (7th Edition)' },
  { value: 'mla', label: 'MLA (9th Edition)' },
  { value: 'harvard', label: 'Harvard' },
  { value: 'chicago', label: 'Chicago (17th Edition)' },
  { value: 'ieee', label: 'IEEE' },
  { value: 'vancouver', label: 'Vancouver' },
] as const;

export const INPUT_STYLES = [
  { value: 'auto', label: 'Auto-detect' },
  ...CITATION_STYLES,
] as const;
