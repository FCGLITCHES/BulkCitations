// Field-overlap guard: never let a structured value (pages / volume / issue / year) ALSO remain
// embedded inside a free-text container field, which would render the same value twice.
//
// This fires when the structured volume/issue/pages splitter fails to carve the detail tail off the
// container — most commonly a NON-NUMERIC volume placeholder ("Journal, ?, 770-778") that defeats
// numeric volume detection (phase4Extract's volumeIssuePages pattern), so the container keeps the
// whole "venue + detail" tail while pages are still recovered by the standalone fallback. The result
// rendered the page range twice: once inside the journal string, once as the pages field.
//
// Conservative by construction: a container is only truncated when (a) an owned value of length >= 2
// is embedded in it AND (b) everything from that point to the end of the container is pure
// "publication-detail" text (digits, separators, parens, "?", dashes). A real venue name therefore
// can never be cut, because the suffix after the cut would contain letters.
import type { ReferenceCarrier } from './types/carrier.js';

const CONTAINER_FIELDS = ['journal', 'conferenceTitle', 'bookTitle'] as const;
// Only digits, whitespace, separators, parens/brackets, "?" and dash variants — i.e. a pure detail
// tail (brackets included so a leftover "12 (3), [" or "[12]" still counts as detail, not a name).
const DETAIL_TAIL_RE = /^[\d\s,;:.()[\]?‐-―−-]+$/u;
// A trailing bracketed numeric locator ("Journal, [12]") — a volume/issue that the structured parse
// left wrapped in the container. Square brackets only; round parens can carry a real issue number.
const TRAILING_BRACKETED_LOCATOR_RE = /[\s,;:]*\[\s*\d[\d\s.,()–—-]*\]\s*$/u;

interface OwnedDetails {
  pages: string | null;
  volume: string | null;
  issue: string | null;
  year: number | null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dashNorm(value: string): string {
  return value.replace(/[‐-―−-]/g, '-');
}

/** Truncate a container at the earliest embedded owned detail whose suffix is pure detail text. */
function stripDetailTail(value: string, owned: OwnedDetails): string {
  const normalized = dashNorm(value);
  let cut = -1;
  for (const detail of [owned.pages, owned.volume, owned.issue]) {
    if (!detail || detail.length < 2) continue; // single-char details are too ambiguous to anchor on
    const idx = normalized.indexOf(dashNorm(detail));
    if (idx > 0 && DETAIL_TAIL_RE.test(value.slice(idx)) && (cut === -1 || idx < cut)) {
      cut = idx;
    }
  }
  if (cut === -1) return value;

  let out = value.slice(0, cut);
  // Peel the trailing detail run left before the cut: separators, empty / "(?)" parens, the owned
  // year (parenthesized or bare), "?" volume placeholders, and the owned volume/issue numbers.
  let prev: string;
  do {
    prev = out;
    out = out.replace(/[\s,;:.]+$/u, '');
    out = out.replace(/\(\s*\??\s*\)$/u, '');
    if (owned.year) {
      out = out.replace(new RegExp(`\\(\\s*${owned.year}\\s*\\)$`, 'u'), '');
      out = out.replace(new RegExp(`[\\s,;:.]*${owned.year}$`, 'u'), '');
    }
    out = out.replace(/[\s,;:.]*\?+$/u, '');
    if (owned.volume) out = out.replace(new RegExp(`[\\s,;:.(]*${escapeRegex(owned.volume)}\\)?$`, 'u'), '');
    if (owned.issue) out = out.replace(new RegExp(`[\\s,;:.(]*${escapeRegex(owned.issue)}\\)?$`, 'u'), '');
  } while (out !== prev && out.length > 0);

  return out.replace(/[\s,;:.]+$/u, '').trim();
}

/** Remove a publication-detail tail duplicated from owned structured fields out of container fields. */
export function stripDuplicatedContainerTail(carriers: ReferenceCarrier[]): ReferenceCarrier[] {
  for (const carrier of carriers) {
    const fields = carrier.fields as unknown as Record<string, { value: unknown } | undefined>;
    const owned: OwnedDetails = {
      pages: typeof fields.pages?.value === 'string' ? (fields.pages.value as string) : null,
      volume: typeof fields.volume?.value === 'string' ? (fields.volume.value as string) : null,
      issue: typeof fields.issue?.value === 'string' ? (fields.issue.value as string) : null,
      year: typeof fields.year?.value === 'number' ? (fields.year.value as number) : null,
    };
    if (!owned.pages && !owned.volume && !owned.issue) continue;
    for (const key of CONTAINER_FIELDS) {
      const field = fields[key];
      if (!field || typeof field.value !== 'string' || !field.value) continue;
      const trimmed = stripDetailTail(field.value, owned)
        .replace(TRAILING_BRACKETED_LOCATOR_RE, '')
        .replace(/[\s,;:.]+$/u, '')
        .trim();
      if (trimmed && trimmed !== field.value) field.value = trimmed;
    }
  }
  return carriers;
}
