import { createHash } from "node:crypto";
import { normalizeDoi } from "../identifierUtils.js";

const NBSP_REGEX = /\u00A0/g;
const SOFT_HYPHEN_REGEX = /\u00AD/g;
const ZERO_WIDTH_REGEX = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const REPLACEMENT_CHAR_REGEX = /\uFFFD/g;
const IN_WORD_REPLACEMENT_CHAR_REGEX =
  /(?<=[\p{L}\p{N}])\uFFFD(?=[\p{L}\p{N}])/gu;
const DOI_URL_REGEX = /^https?:\/\/(?:dx\.)?doi\.org\//i;

export type DuplicateHint = "doi" | "url" | "title_author_year" | "raw_text";

export interface CanonicalIdentityInput {
  rawText?: unknown;
  doi?: unknown;
  url?: unknown;
  title?: unknown;
  year?: unknown;
  firstAuthorFamily?: unknown;
  provenance?: unknown;
}

export interface GeneratedCanonicalIdentity {
  canonicalWorkKey: string | null;
  normalizedDoi: string | null;
  normalizedUrl: string | null;
  normalizedTitleHash: string | null;
  normalizedHash: string | null;
  sourceProvenance: string;
  duplicateHints: DuplicateHint[];
}

function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeForKey(value: string): string {
  return collapseSpaces(
    value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase(),
  );
}

export function sanitizeInputTextForPipeline(value: string): string {
  return value
    .replace(NBSP_REGEX, " ")
    .replace(SOFT_HYPHEN_REGEX, "")
    .replace(ZERO_WIDTH_REGEX, "")
    .replace(CONTROL_CHAR_REGEX, "")
    .replace(IN_WORD_REPLACEMENT_CHAR_REGEX, "")
    .replace(REPLACEMENT_CHAR_REGEX, " ");
}

export function normalizeProvenanceForKey(value: unknown): string {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = normalizeForKey(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

export function normalizeDoiForKey(value: unknown): string | null {
  return normalizeDoi(value);
}

export function normalizeUrlForKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/[)\],.;:]+$/g, "");
  if (!trimmed) {
    return null;
  }

  const doi = normalizeDoiForKey(trimmed);
  if (doi) {
    return `https://doi.org/${doi}`;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function buildNormalizedHash(value: string): string {
  return createHash("sha256")
    .update(normalizeForKey(sanitizeInputTextForPipeline(value)))
    .digest("hex");
}

export function buildNormalizedTitleHash(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeForKey(value);
  if (!normalized) {
    return null;
  }
  return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

export function buildCanonicalWorkKey(input: {
  doi?: unknown;
  url?: unknown;
  title?: unknown;
  year?: unknown;
  firstAuthorFamily?: unknown;
}): string | null {
  const doi = normalizeDoiForKey(input.doi) ?? normalizeDoiForKey(input.url);
  if (doi) {
    return `doi:${doi}`;
  }

  const normalizedTitle =
    typeof input.title === "string" ? normalizeForKey(input.title) : "";
  const normalizedAuthor =
    typeof input.firstAuthorFamily === "string"
      ? normalizeForKey(input.firstAuthorFamily)
      : "";
  const normalizedYear = (() => {
    if (typeof input.year === "number" && Number.isFinite(input.year)) {
      return String(Math.trunc(input.year));
    }
    if (typeof input.year === "string") {
      const match = input.year.match(/\b((?:19|20)\d{2})\b/);
      return match?.[1] ?? "";
    }
    return "";
  })();

  if (normalizedTitle) {
    const seed = `${normalizedTitle}|${normalizedYear || "na"}|${normalizedAuthor || "na"}`;
    return `work:${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
  }

  const url = normalizeUrlForKey(input.url);
  if (!url) {
    return null;
  }
  return `url:${createHash("sha256").update(url).digest("hex").slice(0, 24)}`;
}

export function buildNearDupClusterId(memberKeys: string[]): string {
  const seed = memberKeys.slice().sort().join("|");
  return `near:${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

export function generateCanonicalIdentity(
  input: CanonicalIdentityInput,
): GeneratedCanonicalIdentity {
  const normalizedDoi =
    normalizeDoiForKey(input.doi) ?? normalizeDoiForKey(input.url);
  const normalizedUrl = normalizeUrlForKey(input.url);
  const normalizedTitleHash = buildNormalizedTitleHash(input.title);
  const normalizedHash =
    typeof input.rawText === "string"
      ? buildNormalizedHash(input.rawText)
      : null;
  const canonicalWorkKey = buildCanonicalWorkKey(input);
  const duplicateHints: DuplicateHint[] = [];

  if (normalizedDoi) {
    duplicateHints.push("doi");
  }
  if (normalizedUrl) {
    duplicateHints.push("url");
  }
  if (canonicalWorkKey?.startsWith("work:")) {
    duplicateHints.push("title_author_year");
  }
  if (normalizedHash) {
    duplicateHints.push("raw_text");
  }

  return {
    canonicalWorkKey,
    normalizedDoi,
    normalizedUrl,
    normalizedTitleHash,
    normalizedHash,
    sourceProvenance: normalizeProvenanceForKey(input.provenance),
    duplicateHints,
  };
}

export function normalizeLookupText(value: string): string {
  return normalizeForKey(sanitizeInputTextForPipeline(value));
}

export function isDoiUrl(value: string): boolean {
  return DOI_URL_REGEX.test(value);
}
