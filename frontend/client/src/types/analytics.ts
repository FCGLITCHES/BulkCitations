export interface AnalyticsSummary {
  window: { days: number; from: string; to: string };
  pipeline: {
    totalJobs: number;
    jobsByStatus: Record<string, number>;
    totalCitations: number;
    citationsByStatus: Record<string, number>;
    avgRefsPerJob: number;
    avgJobDurationMs: number | null;
    queueDepth: number;
  };
  quality: {
    correctionRate: number;
    needsReviewCount: number;
    needsActionCount: number;
    highConfidenceRate: number;
  };
  providers: {
    crossref: { calls: number; cacheHitRate: number; avgResponseBytes: number };
    openalex: { calls: number; cacheHitRate: number; avgResponseBytes: number };
    openai: { calls: number; promptTokens: number; completionTokens: number };
    ml: { calls: number; avgBatchSize: number };
  };
  reports: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    duplicate: number;
    resolutionRatePercent: number;
    avgResolutionHours: number | null;
  };
  users: {
    total: number;
    newInWindow: number;
    activeInWindow: number;
    byPlan: Record<string, number>;
  };
  egress: {
    dailyBuckets: Array<{ date: string; bytes: number; citations: number }>;
    totalBytesInWindow: number;
    avgBytesPerCitation: number;
  };
  timeSeries: {
    jobs: Array<{ date: string; count: number }>;
    citations: Array<{ date: string; count: number }>;
    errors: Array<{ date: string; count: number }>;
  };
}
