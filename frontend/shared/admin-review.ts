export type QueueSource = "pipeline_only" | "reports_only" | "both" | "none";
export type OwnerType = "institution" | "user" | "api_key" | "guest";
export type CitationPublicStatus = "ready" | "needs_review" | "needs_action";
export type CitationStorageStatus = "active" | "duplicate" | "failed";
export type OpenReportStatus = "pending" | "proposed";
export type ReviewHealthLabel = "Ready" | "Review" | "Action Needed";

export interface BatchReviewSummary {
  jobId: string;
  ownerLabel: string;
  ownerType: OwnerType;
  outputStyle: string | null;
  createdAt: string;
  latestActionableAt: string | null;
  totalCitations: number;
  flaggedCitationCount: number;
  counts: {
    ready: number;
    needsReview: number;
    needsAction: number;
  };
  openReportCounts: {
    pending: number;
    proposed: number;
    total: number;
  };
  healthLabel: ReviewHealthLabel;
  queueSource: QueueSource;
  inQueue: boolean;
  lastSyncedAt: string;
}

export interface LinkedReportSummary {
  id: string;
  citationId: string;
  status: OpenReportStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
  failureCategories: string[];
}

export interface CitationLineItem {
  citationId: string;
  jobId: string;
  index: number;
  originalText: string;
  renderedPreview: string | null;
  publicStatus: CitationPublicStatus;
  latestTimestamp: string;
  linkedReports: LinkedReportSummary[];
}

export interface ReviewQueueResponse {
  batches: BatchReviewSummary[];
  total: number;
}

export interface ReviewQueueCitationsResponse {
  jobId: string;
  citations: CitationLineItem[];
  totalFlaggedCitations: number;
  nextCursor: number | null;
}

export interface AdminReferenceArchiveItem {
  citationId: string;
  jobId: string;
  referenceIndex: number;
  ownerLabel: string;
  ownerType: OwnerType;
  outputStyle: string | null;
  detectedStyle: string | null;
  referenceType: string | null;
  publicStatus: CitationPublicStatus;
  storageStatus: CitationStorageStatus;
  healthLabel: ReviewHealthLabel;
  rawText: string;
  renderedText: string | null;
  batchCreatedAt: string;
  createdAt: string;
  updatedAt: string;
  latestActivityAt: string;
  openReportCounts: {
    pending: number;
    proposed: number;
    total: number;
  };
}

export interface AdminReferenceArchiveResponse {
  references: AdminReferenceArchiveItem[];
  total: number;
}
