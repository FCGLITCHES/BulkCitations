import type { ParsedReference } from "@shared/schema";

/**
 * Detect if the reference has authors that are initials-only (e.g. "Smith, J." or "J. Smith").
 * Used to flag for review and to gate metadata-based author expansion.
 *
 * Policy: we do NOT auto-expand initials to full names. Authority/metadata lookups (e.g. DOI,
 * PMID, Semantic Scholar) must only fill full names when confidence is high; otherwise keep
 * initials and surface "Author initials only — review suggested" for manual correction.
 */
export function hasAuthorInitialsOnly(parsed: ParsedReference): boolean {
  const authors = parsed.authors;
  if (!authors || authors.length === 0) return false;

  for (const raw of authors) {
    const a = raw.trim();
    if (!a || /^et\s+al\.?$/i.test(a)) continue;

    // "Surname, I." or "Surname, I. I." or "Surname, I.I." — given part is only initials
    const surnameFirst = a.match(/^([^,]+),\s*(.+)$/);
    if (surnameFirst) {
      const given = surnameFirst[2].trim();
      if (given.length <= 12 && /^[A-Z](?:\s*\.?\s*[A-Z\-])*\.?\s*$/i.test(given.replace(/\s+/g, " "))) {
        return true;
      }
      continue;
    }

    // "I. Surname" or "I. I. Surname" — leading part is only initials then surname
    const initialsThenSurname = a.match(/^([A-Z](?:\s*\.?\s*[A-Z\-])*\.?)\s+([A-Z][a-z\u00c0-\u00ff]+(?:\s+[a-z\u00c0-\u00ff]+)*)$/);
    if (initialsThenSurname) {
      const initials = initialsThenSurname[1].trim();
      if (initials.length <= 10) return true;
    }
  }

  return false;
}
