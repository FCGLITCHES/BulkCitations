import { createHash } from "node:crypto";
import type { ParsedReference } from "@shared/schema";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function firstAuthorFamily(parsed: ParsedReference): string {
  if (!parsed.authors?.length) return "";
  const first = parsed.authors[0];
  const comma = first.indexOf(",");
  if (comma >= 0) return normalize(first.slice(0, comma));
  const parts = first.trim().split(/\s+/);
  return parts.length > 0 ? normalize(parts[parts.length - 1]) : "";
}

function journalOrVenue(parsed: ParsedReference): string {
  const j = parsed.journal || parsed.bookTitle || parsed.conferenceTitle || "";
  return normalize(j);
}

/**
 * Canonical key for a work: same citation in different styles yields the same key.
 * Used for clustering, storage grouping, and authority cache fallback.
 */
export function computeWorkKey(parsed: ParsedReference): string {
  const title = normalize(parsed.title ?? "");
  const author = firstAuthorFamily(parsed);
  const year = (parsed.year ?? "").trim();
  const venue = journalOrVenue(parsed);
  const combined = `${title}|${author}|${year}|${venue}`;
  return createHash("sha256").update(combined).digest("hex").slice(0, 24);
}
