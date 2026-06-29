import { isPlaceholderLikeValue } from '../healthRules.js';
import type { ExtractedFields } from '../types/citation.js';
import { hasFieldValue, rewriteField } from './fields.js';

// String fields where a bare placeholder ("?", "Journal", "vol", "unknown", …)
// means the value is *absent*, not real content. Clearing them keeps the
// renderer, scorer, and health checks consistent — the citation is flagged as
// missing the field instead of printing "*Journal*" or "vol. ?". Placeholders can
// be introduced both at extraction (cleared in phase 7) and by later locator/venue
// splitting, so the render phase clears them again as the authoritative final gate.
export const PLACEHOLDER_CLEARABLE_FIELDS = [
  'title',
  'journal',
  'volume',
  'issue',
  'pages',
  'bookTitle',
  'conferenceTitle',
  'siteName',
  'publisher',
  'institution',
  'repository',
  'edition',
] as const satisfies ReadonlyArray<keyof ExtractedFields>;

// Container fields (vs. title/locator fields). For these, a value that is only a
// placeholder name plus locator debris ("Journal, vol. ?, pp. 785-794,") is junk —
// the structured parsers failed on a "?" volume and dumped the locator tail into
// the container. We don't apply this to title/pages/volume/issue.
const CONTAINER_FIELDS = new Set<string>([
  'journal',
  'conferenceTitle',
  'bookTitle',
  'siteName',
  'repository',
]);

/**
 * True when a field is nothing but placeholder tokens — either a single
 * placeholder ("Journal", "?") or a comma/semicolon list of them ("Journal, ?",
 * which is what a venue split leaves behind when both the container and the
 * locator were unknown). A field with any real fragment ("Journal, vol. ?, pp.
 * 12-20" — real pages) is left alone for extraction-level repair.
 */
function isEntirelyPlaceholder(value: string): boolean {
  if (isPlaceholderLikeValue(value)) return true;
  const fragments = value.split(/[,;]/u).map((part) => part.trim()).filter(Boolean);
  return fragments.length >= 2 && fragments.every((fragment) => isPlaceholderLikeValue(fragment));
}

/**
 * True when a CONTAINER value is only a placeholder name plus locator debris:
 * after stripping vol./no./pp. fragments and punctuation, nothing but placeholder
 * tokens remain ("Journal, vol. ?, pp. 785-794," -> "Journal"). A real container
 * ("Lecture notes in computer science", "Genome biology") keeps a real word and is
 * left untouched.
 */
/**
 * True when a container value (journal / conference / book title) is not real
 * content — a placeholder ("Journal", "?"), a placeholder list ("Journal, ?"), or
 * a placeholder name plus locator debris ("Journal, vol. ?, pp. 12-20,"). Used by
 * the type classifier so a bogus container doesn't drive an article/conference
 * classification, and not just by the render-time field clearing.
 */
export function isPlaceholderContainerValue(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return false;
  return isEntirelyPlaceholder(value) || isContainerLocatorJunk(value);
}

function isContainerLocatorJunk(value: string): boolean {
  const stripped = value
    .replace(/\bvols?\.?\s*\d*\??/giu, ' ')
    .replace(/\bnos?\.?\s*\d*\??/giu, ' ')
    .replace(/\bpp?\.?\s*[A-Za-z]?\d[\w\-–]*/giu, ' ')
    .replace(/[\s,;.()"'“”]+/gu, ' ')
    .trim();
  if (!stripped) return true;
  return stripped.split(/\s+/u).every((word) => isPlaceholderLikeValue(word));
}

/**
 * Clears every string field in {@link PLACEHOLDER_CLEARABLE_FIELDS} whose value is
 * entirely placeholder tokens. Mutates `fields` in place; invokes `onClear` for
 * each cleared field (e.g. to record a normalization audit entry). Returns true if
 * anything changed.
 */
export function clearPlaceholderFields(
  fields: ExtractedFields,
  stageId: string,
  onClear?: (field: (typeof PLACEHOLDER_CLEARABLE_FIELDS)[number], before: string) => void,
): boolean {
  let changed = false;

  for (const field of PLACEHOLDER_CLEARABLE_FIELDS) {
    const existing = fields[field];
    if (!hasFieldValue(existing) || typeof existing.value !== 'string') continue;
    const isJunk = isEntirelyPlaceholder(existing.value)
      || (CONTAINER_FIELDS.has(field) && isContainerLocatorJunk(existing.value));
    if (!isJunk) continue;

    onClear?.(field, existing.value);
    fields[field] = rewriteField(
      existing,
      field,
      null,
      'normalization',
      stageId,
      0,
      { uncertain: true },
    );
    changed = true;
  }

  return changed;
}
