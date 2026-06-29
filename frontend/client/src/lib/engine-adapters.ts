import type { EngineOutputStyle, EngineReferenceType } from "./engine-types";

/**
 * Adapters between engine v3 canonical enums and legacy/shared UI enums.
 * These should be the only place we translate enum vocabularies.
 */

export function mapEngineReferenceTypeToShared(referenceType: EngineReferenceType) {
  switch (referenceType) {
    case "article-journal":
      return "journal";
    case "book":
      return "book";
    case "book-chapter":
      return "bookChapter";
    case "conference-paper":
      return "conference";
    case "webpage":
      return "website";
    case "report":
      return "report";
    case "thesis":
      return "thesis";
    case "preprint":
      return "preprint";
    case "dataset":
      return "other";
    case "unknown":
      return "other";
  }
}

export function mapEngineStyleToShared(style: EngineOutputStyle) {
  if (style === "auto") return "auto";
  if (style === "unknown") return "unknown";
  if (style.startsWith("apa")) return "apa";
  if (style.startsWith("mla")) return "mla";
  if (style.startsWith("ieee")) return "ieee";
  if (style.startsWith("vancouver")) return "vancouver";
  if (style.startsWith("chicago")) return "chicago";
  if (style.startsWith("harvard")) return "harvard";
  return "apa";
}
