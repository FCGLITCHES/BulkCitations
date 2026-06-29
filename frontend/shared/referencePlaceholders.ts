function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export const PLACEHOLDER_VALUES = new Set([
  '',
  '?',
  'unknown',
  'n/a',
  'n.d.',
  's.n.',
  '[s.n.]',
  'journal',
  'vol',
  'vol.',
  'issue',
]);

export function normalizePlaceholderValue(value: string | null | undefined): string {
  return normalizeWhitespace(String(value ?? '').toLowerCase());
}

export function isPlaceholderFieldValue(value: string | null | undefined): boolean {
  return PLACEHOLDER_VALUES.has(normalizePlaceholderValue(value));
}
