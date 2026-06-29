/**
 * Pure token <-> BIO-span helpers for the admin span-correction editor.
 *
 * The editor labels whitespace tokens with a canonical BIO core (or "O"); on
 * submit, consecutive same-label tokens collapse back into char-offset spans
 * that match the backend's entity_fields / entity_starts / entity_ends arrays.
 */

export const OUTSIDE = "O";

/** Canonical BIO cores the model predicts (mirrors the Python label space). */
export const BIO_LABELS: string[] = [
  "author", "editors", "year", "title", "journal", "conference_title",
  "book_title", "publisher", "institution", "edition", "thesis_type",
  "repository", "article_number", "accessed_date", "site_name", "database",
  "report_number", "place_of_publication", "volume", "issue", "pages", "doi", "url",
];

export interface LabelToken {
  text: string;
  start: number;
  end: number;
}

/** Locator delimiters that pack two values into one whitespace token (e.g. "98:25-25",
 *  "2004(3)", "36;4"). Split on these only when they sit between digits so a merged numeric
 *  locator becomes separately-labelable pieces, while titles / URLs / DOIs stay intact. */
const LOCATOR_DELIMITER = /[[\](),;:]/;

export function tokenize(raw: string): LabelToken[] {
  const tokens: LabelToken[] = [];
  for (const whitespaceToken of raw.matchAll(/\S+/g)) {
    const base = whitespaceToken.index ?? 0;
    const text = whitespaceToken[0];
    let piece = "";
    let pieceStart = 0;
    const flush = (endIndex: number) => {
      if (piece) tokens.push({ text: piece, start: base + pieceStart, end: base + endIndex });
      piece = "";
    };
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i]!;
      const adjacentToDigit = /[0-9]/.test(text[i - 1] ?? "") || /[0-9]/.test(text[i + 1] ?? "");
      if (LOCATOR_DELIMITER.test(char) && adjacentToDigit) {
        flush(i);
        tokens.push({ text: char, start: base + i, end: base + i + 1 }); // delimiter is its own (skippable) token
      } else {
        if (!piece) pieceStart = i;
        piece += char;
      }
    }
    flush(text.length);
  }
  return tokens;
}

/** Project char-offset spans onto per-token labels (first overlapping span wins). */
export function spansToTokenLabels(
  tokens: LabelToken[],
  fields: string[],
  starts: number[],
  ends: number[],
): string[] {
  return tokens.map((token) => {
    for (let i = 0; i < fields.length; i += 1) {
      const start = starts[i];
      const end = ends[i];
      if (start === undefined || end === undefined) continue;
      if (token.start < end && token.end > start) return fields[i] ?? OUTSIDE;
    }
    return OUTSIDE;
  });
}

/** Collapse consecutive same-label tokens into char-offset spans. */
export function tokenLabelsToSpans(
  tokens: LabelToken[],
  labels: string[],
): { fields: string[]; starts: number[]; ends: number[] } {
  const fields: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  let current: string | null = null;
  let spanStart = 0;
  let spanEnd = 0;

  const flush = () => {
    if (current && current !== OUTSIDE) {
      fields.push(current);
      starts.push(spanStart);
      ends.push(spanEnd);
    }
    current = null;
  };

  tokens.forEach((token, index) => {
    const label = labels[index] ?? OUTSIDE;
    if (label === OUTSIDE) {
      flush();
      return;
    }
    if (label !== current) {
      flush();
      current = label;
      spanStart = token.start;
    }
    spanEnd = token.end;
  });
  flush();

  return { fields, starts, ends };
}

const PALETTE = [
  "#2563eb", "#059669", "#d97706", "#db2777", "#7c3aed", "#0891b2",
  "#dc2626", "#65a30d", "#c026d3", "#ea580c", "#0d9488", "#4f46e5",
];

/** Deterministic color per label so the same field is always the same hue. */
export function labelColor(label: string): string {
  if (label === OUTSIDE) return "transparent";
  const index = BIO_LABELS.indexOf(label);
  const slot = index >= 0 ? index : Math.abs(hashString(label));
  return PALETTE[slot % PALETTE.length]!;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
