import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type {
  CitationReport,
  ReportStatus,
  FailureCategory,
  FailureSource,
} from "@shared/schema";

// Re-export shared types so consumers don't need two imports
export type { CitationReport, ReportStatus, FailureCategory, FailureSource };

// ── Paths ──

const DATA_DIR = process.env.VERCEL
  ? "/tmp"
  : path.resolve(process.cwd(), "data");

const V2_FILE = path.join(DATA_DIR, "reports.v2.jsonl");
const V1_FILE = path.join(DATA_DIR, "reports.jsonl");
const V1_BAK_PREFIX = path.join(DATA_DIR, "reports.v1.bak");

// ── Old V1 schema (for migration) ──

interface V1Report {
  id: string;
  timestamp: string;
  rawInput: string;
  detectedInputStyle: string;
  targetStyle: string;
  convertedOutput: string;
  userCategory: string;
  userNote?: string;
  status: "open" | "fixed" | "rejected";
}

// ── Category mapping from old free-text to new enum ──

const CATEGORY_MAP: Record<string, FailureCategory> = {
  "Year missing or incorrect": "year",
  "Author name incorrect": "author",
  "Title missing or incorrect": "title",
  "Journal / venue incorrect": "venue",
  "Pages missing or incorrect": "locator",
  "Wrong citation style detected": "style-detection",
  "Other...": "other",
};

const STATUS_MAP: Record<string, ReportStatus> = {
  open: "pending",
  fixed: "accepted",
  rejected: "rejected",
};

// ── Helpers ──

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Compute a SHA-256 fingerprint of normalised text for dedup grouping.
 * Strips whitespace, lowercases, removes punctuation.
 */
export function computeFingerprint(text: string): string {
  const normalised = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 32);
}

/**
 * One-way hash an IP address for rate-limit tracking.
 * We never store the raw IP.
 */
export function hashIP(ip: string): string {
  return createHash("sha256").update(`cite-report:${ip}`).digest("hex").slice(0, 16);
}

// ── Migration ──

let migrationDone = false;

/**
 * Migrate V1 reports.jsonl → V2 format.
 * - Reads old rows, maps fields to new schema
 * - Writes to reports.v2.jsonl
 * - Renames original to reports.v1.bak.<timestamp>
 * - Idempotent: only runs once per process, skips if V2 already exists
 */
function migrateV1toV2(): void {
  if (migrationDone) return;
  migrationDone = true;

  // If V2 already exists, no migration needed
  if (fs.existsSync(V2_FILE)) return;
  // If V1 doesn't exist, nothing to migrate
  if (!fs.existsSync(V1_FILE)) return;

  console.log("[reportStore] Migrating V1 reports → V2...");

  const raw = fs.readFileSync(V1_FILE, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const v2Reports: CitationReport[] = [];

  for (const line of lines) {
    try {
      const v1 = JSON.parse(line) as V1Report;
      const v2: CitationReport = {
        id: v1.id,
        source: "user",
        originalText: v1.rawInput,
        detectedStyle: v1.detectedInputStyle || "",
        outputStyle: v1.targetStyle || "",
        convertedText: v1.convertedOutput,
        failureCategory: CATEGORY_MAP[v1.userCategory] ?? "other",
        userNote: v1.userNote,
        status: STATUS_MAP[v1.status] ?? "pending",
        createdAt: v1.timestamp,
        reportCount: 1,
        fingerprint: computeFingerprint(v1.rawInput),
      };
      v2Reports.push(v2);
    } catch (e) {
      console.warn("[reportStore] Skipping malformed V1 line:", e);
    }
  }

  ensureDataDir();

  // Write V2 file
  const v2Content = v2Reports.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(V2_FILE, v2Content, "utf8");

  // Backup V1 with timestamp
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const bakPath = `${V1_BAK_PREFIX}.${ts}`;
  fs.renameSync(V1_FILE, bakPath);

  console.log(`[reportStore] Migrated ${v2Reports.length} reports. V1 backup: ${bakPath}`);
}

// ── CRUD ──

export function saveReport(r: CitationReport): CitationReport {
  migrateV1toV2();
  ensureDataDir();

  // Dedup: if an existing pending/proposed report has the same fingerprint, increment count
  if (r.fingerprint) {
    const existing = loadReports();
    const dupe = existing.find(
      (e) =>
        e.fingerprint === r.fingerprint &&
        (e.status === "pending" || e.status === "proposed")
    );
    if (dupe) {
      dupe.reportCount = (dupe.reportCount ?? 1) + 1;
      // Merge user note if different
      if (r.userNote && r.userNote !== dupe.userNote) {
        dupe.userNote = dupe.userNote
          ? `${dupe.userNote} | ${r.userNote}`
          : r.userNote;
      }
      writeAll(existing);
      return dupe;
    }
  }

  fs.appendFileSync(V2_FILE, JSON.stringify(r) + "\n", "utf8");
  return r;
}

export function loadReports(): CitationReport[] {
  migrateV1toV2();
  if (!fs.existsSync(V2_FILE)) return [];
  return fs
    .readFileSync(V2_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const parsed = JSON.parse(l) as CitationReport;
      // Ensure reportCount defaults to 1 for legacy rows
      if (!parsed.reportCount) parsed.reportCount = 1;
      return parsed;
    });
}

export function getReportById(id: string): CitationReport | null {
  const reports = loadReports();
  return reports.find((r) => r.id === id) ?? null;
}

export function updateReport(id: string, updates: Partial<CitationReport>): CitationReport | null {
  const reports = loadReports();
  const index = reports.findIndex((r) => r.id === id);
  if (index === -1) return null;

  reports[index] = { ...reports[index], ...updates };
  writeAll(reports);
  return reports[index];
}

/** Convenience: update just the status field */
export function updateReportStatus(id: string, status: ReportStatus): boolean {
  const updates: Partial<CitationReport> = { status };
  if (status === "accepted" || status === "rejected") {
    updates.resolvedAt = new Date().toISOString();
  }
  return updateReport(id, updates) !== null;
}

/** Get reports grouped by fingerprint, sorted by aggregate reportCount desc */
export function getGroupedReports(
  statusFilter?: ReportStatus
): Array<{ fingerprint: string; reports: CitationReport[]; totalCount: number; category: string }> {
  const reports = loadReports();
  const filtered = statusFilter ? reports.filter((r) => r.status === statusFilter) : reports;

  const groups = new Map<string, CitationReport[]>();
  for (const r of filtered) {
    const key = r.fingerprint || r.id; // fallback to id if no fingerprint
    const existing = groups.get(key) || [];
    existing.push(r);
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([fingerprint, members]) => ({
      fingerprint,
      reports: members,
      totalCount: members.reduce((sum, r) => sum + (r.reportCount ?? 1), 0),
      category: members[0].failureCategory,
    }))
    .sort((a, b) => b.totalCount - a.totalCount);
}

// ── Rate limiting (in-memory, resets on cold start — acceptable for MVP) ──

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export function checkRateLimit(ipHash: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ipHash);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ipHash, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

// ── Stress test integration ──

export function addToStressTest(rawInput: string): void {
  if (process.env.VERCEL) return;
  const curatedPath = path.resolve(process.cwd(), "scripts/data/real_citations_curated.json");
  let curated: string[] = [];
  if (fs.existsSync(curatedPath)) {
    curated = JSON.parse(fs.readFileSync(curatedPath, "utf8")) as string[];
  }
  if (!curated.includes(rawInput)) {
    curated.push(rawInput);
    const dir = path.dirname(curatedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(curatedPath, JSON.stringify(curated, null, 2), "utf8");
  }
}

// ── Internal ──

function writeAll(reports: CitationReport[]): void {
  ensureDataDir();
  fs.writeFileSync(
    V2_FILE,
    reports.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8"
  );
}
