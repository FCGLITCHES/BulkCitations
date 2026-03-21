/**
 * Auto-queue — Detects potentially failed citations from pipeline output
 * and silently queues them as `source: "auto"` failure reports.
 *
 * Triggers:
 * 1. confidence.score < 60
 * 2. styleDetectionFailed === true
 * 3. Any error-level assertion failure
 * 4. referenceType inconsistency within a cluster
 * 5. Suspicious parser artifacts (journal/conference leakage, "et al." as first author)
 */

import { randomUUID } from "crypto";
import type {
  ConvertedReference,
  Cluster,
  CitationReport,
  FailureCategory,
  FixType,
} from "@shared/schema";
import {
  saveReport,
  computeFingerprint,
} from "./reportStore.js";

// ── Types ──

interface AutoQueueInput {
  references: ConvertedReference[];
  clusters?: Cluster[];
}

interface AutoQueueTrigger {
  reason: string;
  category: FailureCategory;
  suggestedFixType: FixType;
}

function hasConferenceKeywords(value?: string | null): boolean {
  return Boolean(value && /\bconference\b|\bproceedings?\b|\bworkshop\b|\bsymposium\b|\bmeeting\b/i.test(value));
}

function getFieldValue(ref: ConvertedReference, field: string): string {
  const value = (ref.parsedData as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value.trim() : "";
}

function getStrongTypeFields(ref: ConvertedReference, type: string): string[] {
  const journal = getFieldValue(ref, "journal");
  const conferenceTitle = getFieldValue(ref, "conferenceTitle");
  const bookTitle = getFieldValue(ref, "bookTitle");
  const publisher = getFieldValue(ref, "publisher");
  const institution = getFieldValue(ref, "institution");
  const volume = getFieldValue(ref, "volume");
  const issue = getFieldValue(ref, "issue");
  const pages = getFieldValue(ref, "pages");
  const doi = getFieldValue(ref, "doi");
  const url = getFieldValue(ref, "url");

  switch (type) {
    case "journal":
      return [
        ...(journal && !hasConferenceKeywords(journal) ? ["journal"] : []),
        ...(volume ? ["volume"] : []),
        ...(issue ? ["issue"] : []),
        ...(pages ? ["pages"] : []),
        ...(doi ? ["doi"] : []),
      ];
    case "conference":
      return [
        ...(conferenceTitle ? ["conferenceTitle"] : []),
        ...(bookTitle && hasConferenceKeywords(bookTitle) ? ["bookTitle"] : []),
        ...(journal && hasConferenceKeywords(journal) ? ["journal"] : []),
        ...(pages ? ["pages"] : []),
      ];
    case "book":
      return [
        ...(bookTitle && !hasConferenceKeywords(bookTitle) ? ["bookTitle"] : []),
        ...(publisher ? ["publisher"] : []),
      ];
    case "bookChapter":
      return [
        ...(bookTitle ? ["bookTitle"] : []),
        ...(publisher ? ["publisher"] : []),
        ...(pages ? ["pages"] : []),
      ];
    case "report":
      return [
        ...(publisher ? ["publisher"] : []),
        ...(institution ? ["institution"] : []),
        ...(url ? ["url"] : []),
      ];
    case "website":
      return [
        ...(url ? ["url"] : []),
      ];
    default:
      return [];
  }
}

function formatFieldList(fields: string[]): string {
  return fields.join(", ");
}

// ── Trigger detection ──

function detectTriggers(ref: ConvertedReference, clusters?: Cluster[]): AutoQueueTrigger[] {
  const triggers: AutoQueueTrigger[] = [];

  // 1. Low confidence
  if (ref.confidence && ref.confidence.score < 60) {
    triggers.push({
      reason: `confidence=${ref.confidence.score} (< 60 threshold); check authors, title, year, journal, conferenceTitle, volume, issue, and pages`,
      category: "other",
      suggestedFixType: "parser-logic",
    });
  }

  // 2. Style detection failed
  if (ref.styleDetectionFailed) {
    triggers.push({
      reason: "style detection failed — fallback to APA; check authors, title, year, journal, conferenceTitle, and punctuation cues in the input",
      category: "style-detection",
      suggestedFixType: "scoring-tweak",
    });
  }

  // 3. Error-level assertion failures
  if (ref.assertionSummary && ref.assertionSummary.failedCritical > 0) {
    const errorRules = ref.assertionSummary.details
      .filter((d) => d.severity === "error" && !d.passed)
      .map((d) => d.id);
    if (errorRules.length > 0) {
      triggers.push({
        reason: `error-level assertions failed: ${errorRules.join(", ")}; check the flagged fields in the rendered output`,
        category: inferCategoryFromAssertions(errorRules),
        suggestedFixType: inferFixTypeFromAssertions(errorRules),
      });
    }
  }

  // 4. Type inconsistency within the reference's cluster
  if (clusters && ref.clusterId) {
    const cluster = clusters.find((c) => c.clusterId === ref.clusterId);
    if (cluster && cluster.members.length > 1) {
      const types = new Set(cluster.members.map((m) => m.referenceType));
      if (types.size > 1) {
        const currentTypeFields = getStrongTypeFields(ref, ref.referenceType);
        if (currentTypeFields.length === 0) {
          const reviewFields = Array.from(new Set([
            ...getStrongTypeFields(ref, "journal"),
            ...getStrongTypeFields(ref, "conference"),
            "journal",
            "conferenceTitle",
            "bookTitle",
            "volume",
            "issue",
            "pages",
          ]));

          triggers.push({
            reason: `cluster ${ref.clusterId} mixes ${[...types].join(", ")} and this ${ref.referenceType} parse has no clear anchor field; check ${formatFieldList(reviewFields)}`,
            category: "reference-type",
            suggestedFixType: "parser-logic",
          });
        }
      }
    }
  }

  // 5. Suspicious parser artifacts
  // 5a. "et al." as first or only author
  if (ref.parsedData?.authors) {
    const authors = ref.parsedData.authors;
    if (
      authors.length <= 2 &&
      authors.some((a) => /^et\s+al\.?$/i.test(a.trim()))
    ) {
      triggers.push({
        reason: '"et al." found as primary author entry; check authors',
        category: "author",
        suggestedFixType: "parser-logic",
      });
    }
  }

  // 5b. Journal/conference leakage — journal field contains "conference" or vice versa
  if (ref.parsedData?.journal && /\bconference\b|\bproceedings?\b|\bworkshop\b/i.test(ref.parsedData.journal)) {
    if (ref.referenceType === "journal") {
      triggers.push({
        reason: `journal field contains conference keywords but typed as journal; check journal and conferenceTitle ("${ref.parsedData.journal.slice(0, 60)}")`,
        category: "reference-type",
        suggestedFixType: "parser-logic",
      });
    }
  }

  // 5c. Title looks like it leaked into author or vice versa (heuristic: author > 80 chars)
  if (ref.parsedData?.authors) {
    const longAuthors = ref.parsedData.authors.filter((a) => a.length > 80);
    if (longAuthors.length > 0) {
      triggers.push({
        reason: `suspiciously long author string (${longAuthors[0].length} chars) — possible field leakage; check authors, title, and journal`,
        category: "author",
        suggestedFixType: "parser-logic",
      });
    }
  }

  return triggers;
}

/**
 * Infer the failure category from failed assertion rule IDs.
 */
function inferCategoryFromAssertions(ruleIds: string[]): FailureCategory {
  for (const id of ruleIds) {
    if (id.includes("author")) return "author";
    if (id.includes("title") || id.includes("quotes")) return "title";
    if (id.includes("year")) return "year";
    if (id.includes("vol") || id.includes("no_label") || id.includes("pp") || id.includes("pages")) return "locator";
    if (id.includes("available") || id.includes("internet")) return "venue";
  }
  return "other";
}

/**
 * Infer the fix type from failed assertion rule IDs.
 */
function inferFixTypeFromAssertions(ruleIds: string[]): FixType {
  for (const id of ruleIds) {
    // Renderer-level fixes (formatting, quotes, labels)
    if (id.includes("quotes") || id.includes("pp") || id.includes("vol") || id.includes("no_label") || id.includes("available")) {
      return "renderer-fix";
    }
    // Scoring tweaks
    if (id.includes("style") || id.includes("detection")) {
      return "scoring-tweak";
    }
  }
  return "parser-logic";
}

// ── Main auto-queue function ──

/**
 * Scan pipeline output and auto-queue failures.
 * Call fire-and-forget after processReferences() completes.
 * Does NOT block the API response.
 */
export function autoQueueFailures(input: AutoQueueInput): void {
  const { references, clusters } = input;

  for (const ref of references) {
    const triggers = detectTriggers(ref, clusters);
    if (triggers.length === 0) continue;

    // Pick the most specific category and fix type
    const primaryTrigger = triggers[0];
    const allReasons = triggers.map((t) => t.reason);

    const fingerprint = computeFingerprint(ref.originalText);

    const report: CitationReport = {
      id: randomUUID(),
      source: "auto",
      originalText: ref.originalText,
      detectedStyle: ref.inputStyle || "",
      outputStyle: ref.outputStyle || "",
      parsedData: ref.parsedData,
      referenceType: ref.referenceType,
      convertedText: ref.convertedText,
      confidence: ref.confidence?.score,
      failureCategory: primaryTrigger.category,
      fixType: primaryTrigger.suggestedFixType,
      status: "pending",
      createdAt: new Date().toISOString(),
      fingerprint,
      reportCount: 1,
      autoQueueReasons: allReasons,
    };

    try {
      // saveReport handles dedup via fingerprint
      void saveReport(report);
    } catch (err) {
      console.warn("[autoQueue] Failed to save auto-queued report:", err instanceof Error ? err.message : String(err));
    }
  }
}
