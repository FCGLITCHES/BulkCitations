export type {
  AssertionDetail,
  AssertionHighlight,
  AssertionSummary,
  AuthorityData,
  AuthorityStatus,
  Cluster,
  ConversionResponse,
  ConvertedReference,
  DuplicateGroup,
  HealthState,
  ReferenceAdminReviewPayload,
  ReferenceAnalyticsPayload,
  ReferenceDebugEnvelope,
  ReferenceExportPayload,
  ReferenceReviewPayload,
  ReferenceType,
  ReportEngineSnapshot,
  TruthProvenance,
} from "@shared/schema";

export interface ConversionRequest {
  references?: string[];
  content?: string;
  inputStyle: string;
  outputStyle: string;
  isPro?: boolean;
  enrichWithAuthority?: boolean;
  engineVersion?: "v1" | "v2" | "v3";
  visitorId?: string;
}

export const CITATION_STYLES = [
  { value: "apa", label: "APA (7th Edition)" },
  { value: "mla", label: "MLA (9th Edition)" },
  { value: "harvard", label: "Harvard" },
  { value: "chicago", label: "Chicago (17th Edition)" },
  { value: "ieee", label: "IEEE" },
  { value: "vancouver", label: "Vancouver" },
] as const;

export const INPUT_STYLES = [
  { value: "auto", label: "Auto-detect" },
  ...CITATION_STYLES,
] as const;
