import fs from 'fs';
import path from 'path';

export interface DynamicPatternDefinition {
  id: string;
  regex: string;
  fields: Record<string, number>;
  description?: string;
  category?: string;
  priority?: number;
  styles?: string[];
}

export const PATTERN_CATALOG_PATH = path.resolve(
  process.cwd(),
  'server',
  'engine',
  'v2',
  'patternCatalog.json',
);

/** Dangerous regex constructs that risk catastrophic backtracking (ReDoS). */
export const DANGEROUS_PATTERN_REGEX = /(\.\+\)\+|\.\*\)\*|\.\+\)\*|\.\*\)\+|\(\?=.*\(\?=)/;

export function readPatternCatalog(): DynamicPatternDefinition[] {
  if (!fs.existsSync(PATTERN_CATALOG_PATH)) return [];
  const raw = fs.readFileSync(PATTERN_CATALOG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

export function watchPatternCatalog(onChange: () => void): void {
  if (!fs.existsSync(PATTERN_CATALOG_PATH)) return;
  fs.watch(PATTERN_CATALOG_PATH, (eventType) => {
    if (eventType === 'change') onChange();
  });
}

export function writePatternCatalog(patterns: DynamicPatternDefinition[]): void {
  fs.writeFileSync(PATTERN_CATALOG_PATH, `${JSON.stringify(patterns, null, 2)}\n`, 'utf8');
}

export function validatePatternDefinition(pattern: DynamicPatternDefinition): string | null {
  if (!pattern.id || typeof pattern.id !== 'string') return 'Pattern must have a non-empty string id';
  if (!pattern.regex || typeof pattern.regex !== 'string') return 'Pattern must have a non-empty regex string';
  if (!pattern.fields || typeof pattern.fields !== 'object' || Object.keys(pattern.fields).length === 0) {
    return 'Pattern must have at least one field mapping';
  }

  if (DANGEROUS_PATTERN_REGEX.test(pattern.regex)) {
    return 'Regex contains dangerous backtracking construct — rejected for safety';
  }

  try {
    new RegExp(pattern.regex, 'i');
  } catch (error) {
    return `Regex compilation failed: ${error instanceof Error ? error.message : 'unknown error'}`;
  }

  return null;
}
