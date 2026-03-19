import fs from "fs";
import path from "path";
import crypto from "crypto";

const TRUTH_FILE = path.join(process.cwd(), "data", "truthStore.v1.jsonl");

// Ensure data directory exists
if (!fs.existsSync(path.dirname(TRUTH_FILE))) {
  fs.mkdirSync(path.dirname(TRUTH_FILE), { recursive: true });
}

export interface TruthEntry {
  fingerprint: string; // SHA-256 of normalized text
  originalText: string;
  outputStyle: string;
  validatedOutput: string;
  validatedBy: string;
  validatedAt: string;
}

/** Compute a fingerprint for normalized text */
export function computeFingerprint(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

let truthCache: Map<string, TruthEntry> = new Map();

/** Load truth entries from disk */
export function loadTruths() {
  if (!fs.existsSync(TRUTH_FILE)) return;
  
  const content = fs.readFileSync(TRUTH_FILE, "utf-8");
  const entries: TruthEntry[] = content
    .split("\n")
    .filter(Boolean)
    .map(line => {
        try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);

  // Use the map to keep only the latest per fingerprint+style
  for (const entry of entries) {
    const key = `${entry.fingerprint}:${entry.outputStyle}`;
    truthCache.set(key, entry);
  }
}

/** Save a new truth entry */
export function saveTruth(entry: Omit<TruthEntry, "validatedAt">) {
  const fullEntry: TruthEntry = {
    ...entry,
    validatedAt: new Date().toISOString()
  };

  const key = `${entry.fingerprint}:${entry.outputStyle}`;
  truthCache.set(key, fullEntry);
  
  // Append to JSONL
  fs.appendFileSync(TRUTH_FILE, JSON.stringify(fullEntry) + "\n");
}

/** Get a truth entry if it exists */
export function getTruth(originalText: string, outputStyle: string): TruthEntry | undefined {
  const fingerprint = computeFingerprint(originalText);
  const key = `${fingerprint}:${outputStyle}`;
  return truthCache.get(key);
}

// Initial load
loadTruths();
