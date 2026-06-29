import { createHash } from "node:crypto";

export function normalizeRawTextForTruth(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function hashInputForTruth(raw: string): string {
  return createHash("sha256").update(normalizeRawTextForTruth(raw), "utf8").digest("hex");
}
