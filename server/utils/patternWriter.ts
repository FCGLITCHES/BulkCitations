/**
 * Pattern Writer — Safely append new patterns to patternCatalog.json
 *
 * Used by the admin accept flow when the fix type is "dynamic-pattern".
 * Validates regex safety, checks for duplicates, and writes atomically.
 */

import type { ProposedPattern } from "@shared/schema";
import {
  readPatternCatalog,
  validatePatternDefinition,
  writePatternCatalog,
} from "../engine/v2/patternCatalog.js";

export interface PatternWriteResult {
  success: boolean;
  error?: string;
  totalPatterns?: number;
}

/**
 * Read all patterns from patternCatalog.json.
 */
export function readPatterns(): any[] {
  return readPatternCatalog();
}

/**
 * Validate a proposed pattern before writing.
 * Returns null if valid, error string if not.
 */
export function validatePattern(pattern: ProposedPattern): string | null {
  if (!pattern.id || typeof pattern.id !== "string") {
    return "Pattern must have a non-empty string id";
  }
  if (!pattern.regex || typeof pattern.regex !== "string") {
    return "Pattern must have a non-empty regex string";
  }
  if (!pattern.fields || typeof pattern.fields !== "object" || Object.keys(pattern.fields).length === 0) {
    return "Pattern must have at least one field mapping";
  }

  const validationError = validatePatternDefinition(pattern);
  if (validationError) return validationError;

  // Check for duplicate IDs
  const existing = readPatterns();
  if (existing.some((p: any) => p.id === pattern.id)) {
    return `Pattern with id "${pattern.id}" already exists`;
  }

  return null;
}

/**
 * Append a new pattern to patternCatalog.json.
 * The parser's file watcher will hot-reload it automatically.
 */
export function writePattern(pattern: ProposedPattern): PatternWriteResult {
  const error = validatePattern(pattern);
  if (error) {
    return { success: false, error };
  }

  try {
    const existing = readPatterns();

    const entry: any = {
      id: pattern.id,
      description: pattern.description || "",
      regex: pattern.regex,
      fields: pattern.fields,
      priority: pattern.priority ?? 90,
    };
    if (pattern.category) {
      entry.category = pattern.category;
    }

    existing.push(entry);

    try {
      writePatternCatalog(existing);
    } catch (err) {
      if (process.env.VERCEL) {
        return { success: false, error: "Dynamic patterns cannot be written on Vercel (read-only filesystem). Please update patternCatalog.json in the repository." };
      }
      throw err;
    }

    return { success: true, totalPatterns: existing.length };
  } catch (e) {
    return {
      success: false,
      error: `Write failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}

/**
 * Remove a pattern by ID from patternCatalog.json.
 * Used to roll back a mistakenly accepted pattern.
 */
export function removePattern(patternId: string): PatternWriteResult {
  try {
    const existing = readPatterns();
    const index = existing.findIndex((p: any) => p.id === patternId);
    if (index === -1) {
      return { success: false, error: `Pattern "${patternId}" not found` };
    }

    existing.splice(index, 1);

    try {
      writePatternCatalog(existing);
    } catch (err) {
      if (process.env.VERCEL) {
        return { success: false, error: "Dynamic patterns cannot be modified on Vercel (read-only filesystem)." };
      }
      throw err;
    }

    return { success: true, totalPatterns: existing.length };
  } catch (e) {
    return {
      success: false,
      error: `Remove failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
