import { apiRequest } from "@/lib/queryClient";
import { ENGINE_API_PREFIX } from "./engine-api-base";
import type {
  EngineConvertResponse,
  EngineDuplicateGroup,
  EngineExportFormat,
  EngineExtractedFields,
  EngineInputMode,
  EngineInspectResponse,
  EngineJobCreatedResponse,
  EngineJobStatusResponse,
  EngineProcessedCitation,
  EngineResultModel,
  EngineInspectSourceType,
  EngineParseProfile,
  EngineSourceType,
} from "./engine-types";

interface InspectPayload {
  sourceType: EngineInspectSourceType;
  content: string;
}

interface ConvertPayload {
  sourceType: EngineSourceType;
  content: string;
  outputStyle: string;
  options?: {
    parseProfile?: EngineParseProfile;
    enrich?: boolean;
    dedup?: boolean;
    groupDuplicates?: boolean;
    debug?: boolean;
  };
}

interface ReportPayload {
  jobId: string;
  citationId: string;
  failureCategory: string;
  userNote?: string;
}

export interface EngineProEnrichFieldProposal {
  field: keyof EngineExtractedFields;
  currentValue: unknown;
  proposedValue: unknown;
  provider: "crossref" | "openalex" | "semantic_scholar";
  confidence: number;
  changeKind: "fill" | "overwrite";
}

export interface EngineProEnrichCitationProposal {
  citationId: string;
  referenceType: EngineProcessedCitation["referenceType"];
  detectedStyle: EngineProcessedCitation["detectedStyle"];
  fields: EngineProEnrichFieldProposal[];
}

export interface EngineProEnrichResponse {
  jobId: string;
  proposalCount: number;
  proposals: EngineProEnrichCitationProposal[];
}

export interface EngineProEnrichPreviewResponse {
  jobId: string;
  citationId: string;
  renderedText: string;
  warningCodes: string[];
  selectedFieldCount: number;
}

export interface EngineProEnrichApplyOverlay {
  citationId: string;
  fields: Record<string, unknown>;
  reviewedBy?: string;
  optInTraining?: boolean;
}

export interface EngineProEnrichApplyResponse {
  jobId: string;
  appliedOverlays: number;
  appliedFieldCount: number;
  queuedForReview: boolean;
  updatedCitations: EngineProcessedCitation[];
}

type ConvertStartResult =
  | { kind: "completed"; result: EngineResultModel }
  | { kind: "queued"; job: EngineJobCreatedResponse };

const ENGINE_JOB_ACCESS_STORAGE_PREFIX = "engine-job-access:";

export async function inspectEngineInput(payload: InspectPayload): Promise<EngineInspectResponse> {
  const response = await apiRequest("POST", `${ENGINE_API_PREFIX}/inspect`, payload);
  return response.json() as Promise<EngineInspectResponse>;
}

export async function startEngineConvert(payload: ConvertPayload): Promise<ConvertStartResult> {
  const response = await apiRequest("POST", `${ENGINE_API_PREFIX}/convert`, payload);

  if (response.status === 202) {
    const job = await response.json() as EngineJobCreatedResponse;
    persistEngineJobAccessToken(job.jobId, job.jobAccessToken);
    return {
      kind: "queued",
      job,
    };
  }

  const result = normalizeConvertResponse(await response.json() as EngineConvertResponse);
  persistEngineJobAccessToken(result.jobId, result.jobAccessToken);
  return {
    kind: "completed",
    result,
  };
}

export async function getEngineJob(jobId: string): Promise<EngineJobStatusResponse> {
  const response = await apiRequest(
    "GET",
    `${ENGINE_API_PREFIX}/jobs/${encodeURIComponent(jobId)}`,
    undefined,
    { headers: buildEngineJobAccessHeaders(jobId) },
  );
  const job = await response.json() as EngineJobStatusResponse;
  persistEngineJobAccessToken(job.jobId, job.jobAccessToken);
  return job;
}

/** Hard cap for client-side job polling (aligned with Vite dev proxy limits in vite.config.ts). */
export const ENGINE_JOB_WAIT_MAX_MS = 1_800_000;

/**
 * Scales wait time with reference count so large batches are not aborted at a fixed short window.
 * Example: 200 refs → ~25.5 minutes (capped at {@link ENGINE_JOB_WAIT_MAX_MS}).
 */
export function computeEngineJobWaitTimeoutMs(referenceCount: number): number {
  const n = Math.max(1, Math.floor(referenceCount));
  return Math.min(ENGINE_JOB_WAIT_MAX_MS, 90_000 + n * 7_000);
}

export async function waitForEngineJob(
  jobId: string,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    onUpdate?: (job: EngineJobStatusResponse) => void;
  } = {},
): Promise<EngineResultModel> {
  const startedAt = Date.now();
  const intervalMs = options.intervalMs ?? 800;
  /** Default when callers omit `timeoutMs`: large enough for typical batches without per-ref scaling. */
  const timeoutMs = options.timeoutMs ?? 900_000;

  for (;;) {
    const job = await getEngineJob(jobId);
    options.onUpdate?.(job);

    if (job.status === "completed" || job.status === "partial") {
      return normalizeJobResponse(job);
    }

    if (job.status === "failed") {
      throw new Error(job.error?.message ?? `Conversion job ${jobId} failed.`);
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("The conversion job took too long to finish. Please retry the batch.");
    }

    await delay(intervalMs);
  }
}

export async function downloadEngineExport(jobId: string, format: EngineExportFormat): Promise<void> {
  const response = await apiRequest(
    "GET",
    `${ENGINE_API_PREFIX}/export/${encodeURIComponent(jobId)}/${format}`,
    undefined,
    { headers: buildEngineJobAccessHeaders(jobId) },
  );
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = await response.json() as {
      delivery?: string;
      downloadUrl?: string;
      fileName?: string;
    };

    if (payload.delivery === "signed_url" && payload.downloadUrl) {
      const link = document.createElement("a");
      link.href = payload.downloadUrl;
      link.download = payload.fileName ?? `${jobId}.${format}`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${jobId}.${format}`;
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(link);
}

export async function submitCitationReport(payload: ReportPayload) {
  const response = await apiRequest(
    "POST",
    `${ENGINE_API_PREFIX}/reports`,
    payload,
    { headers: buildEngineJobAccessHeaders(payload.jobId) },
  );
  return response.json();
}

export async function requestEngineProEnrich(
  jobId: string,
  referenceIds: string[],
): Promise<EngineProEnrichResponse> {
  const response = await apiRequest(
    "POST",
    `${ENGINE_API_PREFIX}/jobs/${encodeURIComponent(jobId)}/pro-enrich`,
    { referenceIds },
    { headers: buildEngineJobAccessHeaders(jobId) },
  );
  return response.json() as Promise<EngineProEnrichResponse>;
}

export async function requestEngineProEnrichPreview(
  jobId: string,
  payload: {
    citationId: string;
    fields: Record<string, unknown>;
  },
): Promise<EngineProEnrichPreviewResponse> {
  const response = await apiRequest(
    "POST",
    `${ENGINE_API_PREFIX}/jobs/${encodeURIComponent(jobId)}/pro-enrich/preview`,
    payload,
    { headers: buildEngineJobAccessHeaders(jobId) },
  );
  return response.json() as Promise<EngineProEnrichPreviewResponse>;
}

export async function requestEngineProEnrichApply(
  jobId: string,
  payload: {
    overlays: EngineProEnrichApplyOverlay[];
  },
): Promise<EngineProEnrichApplyResponse> {
  const response = await apiRequest(
    "POST",
    `${ENGINE_API_PREFIX}/jobs/${encodeURIComponent(jobId)}/pro-enrich/apply`,
    payload,
    { headers: buildEngineJobAccessHeaders(jobId) },
  );
  return response.json() as Promise<EngineProEnrichApplyResponse>;
}

export function resolveSourceTypeFromMode(
  inputMode: EngineInputMode,
  content: string,
  detectedFormat?: string,
): EngineSourceType {
  if (inputMode === "text" || inputMode === "doi_list") {
    return inputMode;
  }

  if (detectedFormat === "doi_list" || looksLikeDoiList(content)) {
    return "doi_list";
  }

  return "text";
}

function normalizeConvertResponse(response: EngineConvertResponse): EngineResultModel {
  return {
    jobId: response.jobId,
    jobAccessToken: response.jobAccessToken,
    status: response.status,
    summary: response.summary,
    references: response.references,
    duplicateGroups: response.duplicateGroups,
    exports: response.exports,
    countAudit: response.countAudit,
    warnings: response.warnings,
    diagnostics: response.diagnostics,
    processingPath: response.processingPath,
    providerUsage: response.providerUsage,
  };
}

function normalizeJobResponse(job: EngineJobStatusResponse): EngineResultModel {
  if (!job.summary || !job.countAudit || !job.references || !job.exports) {
    throw new Error(`Conversion job ${job.jobId} completed without a usable result payload.`);
  }

  return {
    jobId: job.jobId,
    jobAccessToken: job.jobAccessToken,
    status: job.status === "partial" ? "partial" : "success",
    summary: job.summary,
    references: job.references,
    duplicateGroups: buildDuplicateGroups(job.references),
    exports: job.exports,
    countAudit: job.countAudit,
    warnings: job.warnings ?? [],
    diagnostics: job.diagnostics,
  };
}

function buildDuplicateGroups(references: EngineProcessedCitation[]): EngineDuplicateGroup[] {
  const referencesById = new Map(references.map((reference) => [reference.id, reference]));
  const groups = new Map<string, Set<string>>();

  for (const reference of references) {
    if (!reference.duplicateOf) continue;
    const current = groups.get(reference.duplicateOf) ?? new Set<string>([reference.duplicateOf]);
    current.add(reference.id);
    groups.set(reference.duplicateOf, current);
  }

  for (const reference of references) {
    if (!reference.isDuplicateCandidate || reference.duplicateOf || !groups.has(reference.id)) continue;
    groups.get(reference.id)?.add(reference.id);
  }

  return [...groups.entries()]
    .map<EngineDuplicateGroup | null>(([groupId, members]) => {
      const memberIds = [...members].filter((memberId) => referencesById.has(memberId));
      if (memberIds.length < 2) {
        return null;
      }

      return {
        groupId,
        primaryId: groupId,
        memberIds,
        method: "minhash_lsh" as const,
        jaccardScore: 0.95,
      };
    })
    .filter((group): group is EngineDuplicateGroup => Boolean(group));
}

function looksLikeDoiList(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^doi:\s*/i, ""))
    .filter(Boolean);

  return lines.length > 0 && lines.every((line) => /^10\.\d{4,9}\/\S+$/i.test(line));
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildEngineJobAccessHeaders(jobId: string): Record<string, string> {
  const token = readEngineJobAccessToken(jobId);
  return token ? { "x-job-access-token": token } : {};
}

function persistEngineJobAccessToken(jobId: string, token: string | null | undefined): void {
  if (typeof window === "undefined" || typeof token !== "string" || token.trim().length === 0) {
    return;
  }
  window.localStorage.setItem(`${ENGINE_JOB_ACCESS_STORAGE_PREFIX}${jobId}`, token);
}

function readEngineJobAccessToken(jobId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(`${ENGINE_JOB_ACCESS_STORAGE_PREFIX}${jobId}`);
}
