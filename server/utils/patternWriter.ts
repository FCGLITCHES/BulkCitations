/**
 * Pattern Writer — Safely append new patterns to patterns.json
 *
 * Used by the admin accept flow when the fix type is "dynamic-pattern".
 * Validates regex safety, checks for duplicates, and writes atomically.
 */

import fs from "fs";
import path from "path";
import type { ProposedPattern } from "@shared/schema";

const PATTERNS_PATH = path.resolve(process.cwd(), "server", "data", "patterns.json");

/** Dangerous regex constructs that risk catastrophic backtracking (ReDoS) */
const DANGEROUS_REGEX = /(.+)\+\)+|(.+)\*\)*|(.+)\+\)*|(.+)\*\)+|(\?=.*\(\?=)/;

export interface PatternWriteResult {
  success: boolean;
  error?: string;
  totalPatterns?: number;
}

/**
 * Read all patterns from patterns.json.
 */
export function readPatterns(): any[] {
  if (!fs.existsSync(PATTERNS_PATH)) return [];
  const raw = fs.readFileSync(PATTERNS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed;
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

  // Check for dangerous regex
  if (DANGEROUS_REGEX.test(pattern.regex)) {
    return "Regex contains dangerous backtracking construct — rejected for safety";
  }

  // Try to compile the regex
  try {
    new RegExp(pattern.regex, "i");
  } catch (e) {
    return `Regex compilation failed: ${e instanceof Error ? e.message : "unknown error"}`;
  }

  // Check for duplicate IDs
  const existing = readPatterns();
  if (existing.some((p: any) => p.id === pattern.id)) {
    return `Pattern with id "${pattern.id}" already exists`;
  }

  return null;
}

/**
 * Append a new pattern to patterns.json.
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

    // Write atomically: write to tmp file, then rename
    const tmpPath = PATTERNS_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
    fs.renameSync(tmpPath, PATTERNS_PATH);

    return { success: true, totalPatterns: existing.length };
  } catch (e) {
    return {
      success: false,
      error: `Write failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}

/**
 * Remove a pattern by ID from patterns.json.
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

    const tmpPath = PATTERNS_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
    fs.renameSync(tmpPath, PATTERNS_PATH);

    return { success: true, totalPatterns: existing.length };
  } catch (e) {
    return {
      success: false,
      error: `Remove failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
