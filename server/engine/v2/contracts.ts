import type {
  CanonicalAuthor,
  CanonicalCitation,
  CanonicalReferenceType,
  CitationStyle,
  InputProfile,
  StageDiagnostic,
  V2StageTiming,
  V2ConversionRequest,
  V2ConversionResponse,
  V2DuplicateEntry,
  V2StageId,
} from '@shared/schema';
import type { V2StageRuntimeConfig } from './config.js';

export type SplitContaminationFlag =
  | 'header_bleed_suspected'
  | 'doi_orphan'
  | 'multiline_truncation_suspected'
  | 'page_artifact_present'
  | 'oversized_chunk';

export interface StrippedRegion {
  rule: string;
  rawText: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
}

export interface SplitRepairAction {
  action: string;
  rawText?: string;
  sourceLineNumbers: number[];
  detail?: string;
}

export interface V2SplitArtifact {
  cleanedChunk: string;
  confidence: number;
  splitReasons: string[];
  splitMethod: 'structural' | 'llm' | 'hybrid';
  fallbackUsed: boolean;
  contaminationFlags: SplitContaminationFlag[];
  strippedRegions: StrippedRegion[];
  repairActions: SplitRepairAction[];
  chunkLength: number;
  lineCount: number;
}

export interface V2LlmBudget {
  maxCalls: number;
  totalCalls: number;
  splitCalls: number;
  extractCalls: number;
  capReached: boolean;
}

export interface V2PipelineContext {
  request: V2ConversionRequest;
  jobId: string;
  receivedAt: string;
  startedAtMs: number;
  executionMode: 'sync' | 'async';
  debugEnabled: boolean;
  rawItems: string[];
  inputProfile?: InputProfile;
  citations: CanonicalCitation[];
  duplicates: V2DuplicateEntry[];
  groups: Record<string, string[]>;
  pipelineLog: StageDiagnostic[];
  stageTimings: V2StageTiming[];
  stagesRun: string[];
  fallbacksUsed: string[];
  partialResult: boolean;
  partialReasons: string[];
  jobDebug: Record<string, Record<string, unknown>>;
  workingChunkByCitationId: Record<string, string>;
  splitArtifactsByCitationId: Record<string, V2SplitArtifact>;
  llmBudget: V2LlmBudget;
  response?: V2ConversionResponse;
  stageConfig: Record<V2StageId, V2StageRuntimeConfig>;
}

export interface ClassifierAdapter {
  readonly id: string;
  detectStyle(input: string): Promise<{ style: CitationStyle | null; confidence: number }>;
}

export interface ExtractorAdapter {
  readonly id: string;
  extract(input: string, inputStyle: string, options?: {
    inputProfile?: InputProfile;
    detectionConfidence?: number;
    batchSize?: number;
    splitArtifact?: V2SplitArtifact;
    llmBudget?: V2LlmBudget;
    debugEnabled?: boolean;
  }): Promise<{
    parsed: {
      authors?: Array<string | CanonicalAuthor>;
      title?: string;
      year?: string;
      journal?: string;
      volume?: string;
      issue?: string;
      pages?: string;
      'article-number'?: string;
      doi?: string;
      publisher?: string;
      url?: string;
      conferenceTitle?: string;
      bookTitle?: string;
      institution?: string;
      edition?: string;
      editor?: string;
    };
    referenceType: CanonicalCitation['referenceType'];
    method: 'deterministic' | 'llm' | 'hybrid';
    fallbackUsed: boolean;
    extractorPath?: 'deterministic' | 'grobid' | 'llm' | 'hybrid';
    selectedBranch?: 'deterministic_raw' | 'year_anchored_fallback_raw' | 'institutional_heuristic_raw' | 'hybrid';
    selectionReason?: string;
    canonicalAuthors?: CanonicalAuthor[];
    authorParserMode?: string;
    authorWarningFlags?: string[];
    rejectedCandidates?: string[];
    llmCapReached?: boolean;
    debug?: Record<string, unknown>;
    fieldConfidence: Partial<Record<'authors' | 'title' | 'year' | 'journal' | 'volume' | 'issue' | 'pages' | 'doi' | 'publisher' | 'url', number>>;
    warnings: string[];
  }>;
}

export interface AuthorityLookupAdapter {
  readonly id: string;
  lookup(citation: CanonicalCitation): Promise<{
    status: 'skipped' | 'fetched' | 'no_match' | 'error';
    data?: {
      title?: string;
      authors?: string[];
      journal?: string;
      year?: string;
      url?: string;
    };
  }>;
}

export interface ResolutionCandidateRecord {
  provider: 'crossref' | 'pubmed' | 'openalex';
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  doi?: string;
  url?: string;
  sourceType?: string;
  raw?: Record<string, unknown>;
}

export interface ResolutionSearchQuery {
  title: string;
  firstAuthorSurname?: string;
  groupAuthorLiteral?: string;
  year?: number | null;
  venue?: string | null;
  sourceType?: CanonicalReferenceType;
}

export interface ResolutionProviderAdapter {
  readonly id: string;
  lookupByDoi(doi: string): Promise<ResolutionCandidateRecord[]>;
  searchCrossrefByTitle(query: ResolutionSearchQuery, limit: number): Promise<ResolutionCandidateRecord[]>;
  searchPubmedByTitle(query: ResolutionSearchQuery, limit: number): Promise<ResolutionCandidateRecord[]>;
  searchOpenAlexByTitle(query: ResolutionSearchQuery, limit: number): Promise<ResolutionCandidateRecord[]>;
}

export interface EmbeddingAdapter {
  readonly id: string;
  isAvailable(): boolean;
}

export interface CacheAdapter {
  readonly id: string;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

export interface ExportAdapter {
  readonly id: string;
  generate(format: 'txt' | 'bib' | 'ris' | 'csv' | 'docx', response: V2ConversionResponse): Promise<{
    contentType: string;
    filename: string;
    body: string | Buffer;
  }>;
}

export interface V2AdapterBundle {
  classifier: ClassifierAdapter;
  extractor: ExtractorAdapter;
  authorityLookup: AuthorityLookupAdapter;
  resolutionProvider: ResolutionProviderAdapter;
  embedding: EmbeddingAdapter;
  cache: CacheAdapter;
  exportAdapter: ExportAdapter;
}

export interface V2Stage {
  readonly id: V2StageId;
  run(context: V2PipelineContext): Promise<V2PipelineContext>;
}
