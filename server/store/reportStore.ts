import fs from "fs";
import path from "path";

const FILE = path.resolve(process.cwd(), "data/reports.jsonl");

export type ReportStatus = "open" | "fixed" | "rejected";

export interface CitationReport {
  id: string;
  timestamp: string;
  rawInput: string;
  detectedInputStyle: string;
  targetStyle: string;
  convertedOutput: string;
  userCategory: string;
  userNote?: string;
  status: ReportStatus;
}

function ensureDataDir(): void {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function saveReport(r: CitationReport): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(r) + "\n", "utf8");
}

export function loadReports(): CitationReport[] {
  if (!fs.existsSync(FILE)) return [];
  return fs
    .readFileSync(FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CitationReport);
}

export function updateReportStatus(id: string, status: ReportStatus): boolean {
  const reports = loadReports();
  const index = reports.findIndex((r) => r.id === id);
  if (index === -1) return false;
  reports[index] = { ...reports[index], status };
  ensureDataDir();
  fs.writeFileSync(
    FILE,
    reports.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8"
  );
  return true;
}

export function getReportById(id: string): CitationReport | null {
  const reports = loadReports();
  return reports.find((r) => r.id === id) ?? null;
}

/** Append rawInput as a new line to the curated stress-test citations file. */
export function addToStressTest(rawInput: string): void {
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
