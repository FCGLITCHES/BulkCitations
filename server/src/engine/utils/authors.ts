import { fieldOf, type FieldSource } from '../types/field.js';
import type { CanonicalAuthor } from '../types/citation.js';

const CORPORATE_HINTS = /\b(association|society|committee|center|centre|department|ministry|organization|organisation|institute|institution|group|agency|office|university|college|world health organization|cdc|nih|survey|standards|contributors|task force|editor|fund|foundation|federation|bureau|commission|consortium|laboratory|laboratories|administration|division|directorate|library|repository|council|inc|incorporated|ltd|limited|corp|corporation|company|gmbh)\b/i;
// Keywords that, on their own, strongly imply an organization rather than a person —
// used so a single organization name that *contains a comma* (e.g. "World Health
// Organization, Department of X") is still treated as one literal/organization author.
const STRONG_ORG_HINTS = /\b(association|society|committee|department|ministry|organization|organisation|institute|institution|agency|university|college|world health organization|cdc|nih|task force|foundation|federation|bureau|commission|consortium|laboratory|laboratories|administration|directorate|council|inc|incorporated|ltd|limited|corp|corporation|company|gmbh)\b/i;
const NAME_PARTICLE_REGEX = /^(?:da|das|de|del|della|den|der|di|do|dos|du|ibn|la|le|van|von|y)$/iu;
const AUTHOR_NAME_WORD_REGEX = /^(?:\p{Lu}[\p{L}'`-]+|\p{Lu}{2,}[\p{Lu}'`-]*)$/u;

/**
 * Splits given names that arrive glued to a middle initial in degraded paste
 * input — "OliverH." -> "Oliver H.", "A.Lewis" -> "A. Lewis". Without this the
 * glued tokens fail the given-name chunk checks (a trailing capital/period is not
 * a valid name word), so a mixed inverted+standalone author list collapses to its
 * first author. Requiring the trailing period (first rule) and a following
 * lowercase letter (second rule) keeps real compound names — "McDonald",
 * "DeWitt", "U.K." — untouched.
 */
export function normalizeGluedNameInitials(value: string): string {
  return value
    // "OliverH." / "OliverH" -> "Oliver H." (full name + trailing lone-capital
    // middle initial). The capital must sit at a token boundary, so real compound
    // names ("McDonald", "DeWitt", "VanGogh") never match.
    .replace(/(\p{Lu}\p{Ll}+)(\p{Lu})(\.?)(?=$|[\s,;])/gu, '$1 $2$3')
    // "A.Lewis" -> "A. Lewis" (single initial glued to the following capitalized word)
    .replace(/(\p{Lu})\.(\p{Lu}\p{Ll})/gu, '$1. $2');
}

export function parseAuthorSegment(segment: string): CanonicalAuthor[] {
  let cleaned = normalizeGluedNameInitials(cleanAuthorSegment(segment));

  if (!cleaned) return [];

  // "Person and Organization" / "Org and Org": an explicit conjunction joining
  // parts where at least one carries an org hint. Split and parse each side so
  // "Mamoru SHOJI and LHD Experiment Group" -> [person, organization] instead of
  // being thrown out as non-author text by the >4-word heuristic below. Single
  // organizations that merely contain "and" ("Department of Health and Human
  // Services") are excluded and handled as one literal author.
  if (
    CORPORATE_HINTS.test(cleaned)
    && hasAuthorConjunction(cleaned)
    && !looksLikeSingleOrganization(cleaned)
  ) {
    const conjunctParts = cleaned
      .split(/\s+and\s+|\s+&\s+/iu)
      .map((part) => part.trim())
      .filter(Boolean);
    if (conjunctParts.length >= 2) {
      const parsed = conjunctParts.flatMap((part) => parseAuthorSegment(part));
      if (parsed.length >= 2) return parsed;
    }
  }

  if (looksLikeNonAuthorText(cleaned)) return [];
  if (CORPORATE_HINTS.test(cleaned) && !/,/.test(cleaned)) {
    return [corporateAuthor(cleaned)];
  }
  if (looksLikeSingleOrganization(cleaned)) {
    return [corporateAuthor(cleaned)];
  }

  // Comma-delimited FIELDS guard. In "Author, Title, Journal, Year" formats (numbered IEEE/
  // engineering bibliographies, e.g. "Whitley D, A genetic algorithm tutorial, Statistics and
  // computing, 1994..."), the author list ends at the first comma segment that reads as title/prose
  // rather than a name. Truncate there so the title/journal aren't swallowed as authors.
  const commaSegments = cleaned.split(',');
  if (commaSegments.length >= 2) {
    const titleCut = commaSegments.findIndex((seg, idx) => idx >= 1 && looksLikeTitleOrProse(seg.trim()));
    if (titleCut >= 1) cleaned = commaSegments.slice(0, titleCut).join(',').trim();
  }

  const normalized = cleaned
    .replace(/\s*&\s*/g, ' and ')
    .replace(/,\s+and\s+/giu, ', ')
    .replace(/\s{2,}/g, ' ');

  const commaAndStandaloneChunks = normalized
    .split(/\s*,\s*|\s+and\s+/iu)
    .map(normalizeStandaloneAuthorChunk)
    .filter(Boolean);
  if (
    commaAndStandaloneChunks.length >= 3
    && commaAndStandaloneChunks.every(
      (chunk) => looksLikeStandaloneAuthorListChunk(chunk) || looksLikeStandaloneAuthorChunk(chunk),
    )
  ) {
    return commaAndStandaloneChunks.map(parseSingleAuthor);
  }

  const mixedLeadingStandaloneMatch = normalized.match(
    /^(?<family>[^,]+),\s*(?<given>(?:\p{Lu}\.\s*){1,4})\s*,\s*(?<rest>.+)$/u,
  );
  if (
    mixedLeadingStandaloneMatch?.groups?.family
    && mixedLeadingStandaloneMatch.groups.given
    && mixedLeadingStandaloneMatch.groups.rest
  ) {
    const trailingStandalone = mixedLeadingStandaloneMatch.groups.rest
      .split(/\s*,\s*/u)
      .map(normalizeStandaloneAuthorChunk)
      .filter(Boolean);
    if (
      trailingStandalone.length > 0
      && trailingStandalone.every(
        (chunk) => looksLikeStandaloneAuthorListChunk(chunk) || looksLikeStandaloneAuthorChunk(chunk),
      )
    ) {
      return [
        personAuthor(
          mixedLeadingStandaloneMatch.groups.family.trim(),
          mixedLeadingStandaloneMatch.groups.given.replace(/\s+/gu, ' ').trim(),
        ),
        ...trailingStandalone.map(parseSingleAuthor),
      ];
    }
  }

  const semicolonParts = normalized
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  const authors: CanonicalAuthor[] = [];

  for (const part of semicolonParts) {
    if (semicolonParts.length === 1 && /,/.test(part)) {
      const commaSeparated = part
        .split(',')
        .map((candidate) => candidate.trim())
        .filter(Boolean);
      const mixedLeadList = parseLeadingFamilyGivenStandaloneList(commaSeparated);
      if (mixedLeadList.length > 0) {
        authors.push(...mixedLeadList);
        continue;
      }
    }
    const commaPaired = parseAuthorsFromCommaPairs(part);
    if (commaPaired.length > 0) {
      authors.push(...commaPaired);
      continue;
    }
    const looseCommaSeparated = parseAuthorsFromLooseCommaList(part);
    if (looseCommaSeparated.length > 0) {
      authors.push(...looseCommaSeparated);
      continue;
    }
    if (/\s+and\s+/i.test(part)) {
      authors.push(...part
        .split(/\s+and\s+/i)
        .flatMap((candidate) => parseAuthorSegment(candidate)));
      continue;
    }
    if (semicolonParts.length === 1 && /,/.test(part)) {
      const commaSeparated = part
        .split(',')
        .map((candidate) => candidate.trim())
        .filter(Boolean);
      if (commaSeparated.length >= 4) {
        if (commaSeparated.every(looksLikeStandaloneAuthorListChunk)) {
          authors.push(...commaSeparated.map(parseSingleAuthor));
          continue;
        }
      }
      if (commaSeparated.length >= 4 && commaSeparated.every(looksLikeStandaloneAuthorChunk)) {
        authors.push(...commaSeparated.map(parseSingleAuthor));
        continue;
      }
      if (commaSeparated.length >= 3 && commaSeparated.every(looksLikeStandaloneAuthorChunk)) {
        authors.push(...commaSeparated.map(parseSingleAuthor));
        continue;
      }
    }
    authors.push(parseSingleAuthor(part));
  }

  return authors.filter((author) => {
    const literal = normalizeComparableAuthorToken(author.literal ?? author.family);
    return literal !== 'amp' && literal !== 'and';
  });
}

export function parseSingleAuthor(author: string): CanonicalAuthor {
  const cleaned = normalizeGluedNameInitials(author
    .replace(/&amp;/giu, '&')
    .replace(/^[\[\(]?\d+[\]\).]?\s*/, '')
    .replace(/^(?:and|&)\s+/iu, '')
    .replace(/[.;]\s*$/, '')
    .trim());
  if (!cleaned) return corporateAuthor(author);

  if (CORPORATE_HINTS.test(cleaned)) {
    return corporateAuthor(cleaned);
  }

  if (cleaned.includes(',')) {
    const [family, given] = cleaned.split(',').map((part) => part.trim());
    return personAuthor(family ?? cleaned, given ?? null);
  }

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return personAuthor(parts[0] ?? cleaned, null);
  }

  const leadingInitialCount = countLeadingInitialLikeParts(parts);
  if (shouldTreatLeadingInitialsAsCompoundFamily(parts, leadingInitialCount)) {
    const family = parts.slice(leadingInitialCount).join(' ');
    const given = parts.slice(0, leadingInitialCount).join(' ');
    return personAuthor(family, given);
  }

  const trailingInitialStart = parts.findIndex((part, index) => (
    index > 0 && isInitialLike(part)
  ));
  if (
    trailingInitialStart > 0
    && parts.slice(trailingInitialStart).every((part) => isInitialLike(part) || NAME_PARTICLE_REGEX.test(part))
  ) {
    const family = parts.slice(0, trailingInitialStart).join(' ');
    const given = parts.slice(trailingInitialStart).join(' ');
    return personAuthor(family, given);
  }

  // Vancouver-like: "Gomes MA" or "da Silva VL" (initials at end).
  const last = parts.at(-1) ?? '';
  if (isInitialLike(last) && parts.length >= 2) {
    const family = parts.slice(0, -1).join(' ');
    const given = last;
    return personAuthor(family, given);
  }

  const compoundFamilyStart = findCompoundFamilyStart(parts);
  const family = compoundFamilyStart > 0
    ? parts.slice(compoundFamilyStart).join(' ')
    : parts.at(-1) ?? cleaned;
  const given = compoundFamilyStart > 0
    ? parts.slice(0, compoundFamilyStart).join(' ')
    : parts.slice(0, -1).join(' ');
  return personAuthor(family, given);
}

export function normalizeAuthorField(
  value: string,
  stageId: string,
  source: FieldSource,
  confidence: number,
) {
  return fieldOf(parseAuthorSegment(value), source, stageId, confidence);
}

function personAuthor(family: string, given: string | null): CanonicalAuthor {
  const compactGiven = normalizeGiven(given?.trim() || null);
  return {
    family: family.trim(),
    given: compactGiven,
    initials: compactGiven ? deriveAuthorInitials(compactGiven) : null,
    isCorporate: false,
  };
}

function corporateAuthor(literal: string): CanonicalAuthor {
  return {
    family: literal.trim(),
    given: null,
    initials: null,
    literal: literal.trim(),
    isCorporate: true,
  };
}

export function deriveAuthorInitials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}.`)
    .join(' ');
}

export function toCanonicalAuthor(value: unknown): CanonicalAuthor | null {
  if (typeof value !== 'object' || value == null) return null;

  const family = typeof (value as { family?: unknown }).family === 'string'
    ? (value as { family: string }).family.trim()
    : '';
  const given = typeof (value as { given?: unknown }).given === 'string'
    ? normalizeGiven((value as { given: string }).given.trim())
    : null;
  const literal = typeof (value as { literal?: unknown }).literal === 'string'
    ? (value as { literal: string }).literal.trim()
    : undefined;
  const isCorporate = Boolean((value as { isCorporate?: unknown }).isCorporate ?? literal);

  if (!family && !literal) return null;

  return {
    family: family || literal || 'Unknown',
    given,
    initials: given ? deriveAuthorInitials(given) : null,
    ...(literal ? { literal } : {}),
    isCorporate,
  };
}

export function cleanAuthorSegment(segment: string): string {
  return segment
    .replace(/&amp;/giu, '&')
    .replace(/^[\[\(]?\d+[\]\).]?\s*/, '')
    // Trailing "(1977, January)" / "(2020)" date — an APA/conference date that the
    // span detector sometimes leaves glued to the last author. A parenthetical
    // starting with a 4-digit year is never part of a name, so dropping it keeps
    // the author list intact (otherwise its inner comma derails the splitter).
    .replace(/\s*\((?:19|20)\d{2}[^)]*\)\s*$/u, '')
    .replace(/\bet al\.?$/i, '')
    .replace(/[.;]\s*$/, '')
    .trim();
}

export function isLikelyAuthorSegment(segment: string): boolean {
  const cleaned = cleanAuthorSegment(segment);
  return cleaned.length > 0 && !looksLikeNonAuthorText(cleaned);
}

export function isValidAuthorSpanText(authorSegment: string, authors: CanonicalAuthor[]): boolean {
  const cleaned = cleanAuthorSegment(authorSegment);
  if (!cleaned || looksLikeNonAuthorText(cleaned) || authors.length === 0) return false;

  const normalizedSegment = normalizeComparableAuthorToken(cleaned);
  const hasExplicitListDelimiters = /,|;|\s+and\s+|&/.test(cleaned);
  const matchedAuthors = authors.filter((author) => segmentContainsAuthor(cleaned, normalizedSegment, author)).length;

  if (matchedAuthors === 0) return false;

  if (authors.length === 1) {
    const [author] = authors;
    if (!author) return false;
    if (author.isCorporate) return matchedAuthors === 1;

    const words = cleaned.split(/\s+/).filter(Boolean);
    if (!cleaned.includes(',') && !/[A-Z]\./.test(cleaned) && words.length > 4) {
      return false;
    }

    const familyWordCount = author.family.trim().split(/\s+/).filter(Boolean).length;
    if (familyWordCount > 3) return false;

    return matchedAuthors === 1;
  }

  if (matchedAuthors === authors.length) return true;
  if (hasExplicitListDelimiters && matchedAuthors >= Math.min(authors.length, 2)) return true;
  return false;
}

// A single organization name may legitimately contain a comma
// (e.g. "World Health Organization, Department of Mental Health"). Treat the whole
// span as one literal/organization author when it carries a strong org keyword and
// none of the comma/semicolon chunks look like a person (initials or a short
// Family/Given pair). High-precision so real multi-author lists keep splitting.
function looksLikeSingleOrganization(value: string): boolean {
  if (!STRONG_ORG_HINTS.test(value)) return false;
  // Semicolons separate distinct authors; never collapse those into one org.
  if (/;/.test(value)) return false;

  // Split on commas only — organizations routinely contain "and"
  // ("Department of Mental Health and Substance Abuse"), so an "and" is not a
  // person boundary here.
  const chunks = value
    .split(/\s*,\s*/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (chunks.length === 0) return false;

  return chunks.every((chunk) => {
    if (STRONG_ORG_HINTS.test(chunk) || CORPORATE_HINTS.test(chunk)) return true;
    // A chunk that reads like a person (carries an initial, or is a short
    // capitalized token sequence) means this is a real author list, not an org.
    if (/\p{Lu}\./u.test(chunk)) return false;
    const words = chunk.split(/\s+/u).filter(Boolean);
    if (words.length === 0) return false;
    // Allow descriptive org sub-phrases ("Department of Mental Health and
    // Substance Abuse") which contain lowercase connective words a name would not.
    return words.some((word) => /^\p{Ll}/u.test(word)) || words.length >= 4;
  });
}

function hasAuthorConjunction(value: string): boolean {
  return /\s+and\s+/iu.test(value) || /\s+&\s+/u.test(value);
}

// "Tianqi Chen and Carlos Guestrin" — two (or more) full personal names joined by
// "and"/"&", no comma and no initials, so it trips the >4-word non-author guard
// below. Recognize it as an author list when every conjunction-joined part is a
// short run of name-shaped tokens, so it isn't discarded.
function looksLikeConjoinedAuthorList(value: string): boolean {
  if (!hasAuthorConjunction(value)) return false;
  const parts = value
    .split(/\s+and\s+|\s+&\s+/iu)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((part) => {
    const words = part.split(/\s+/u).filter(Boolean);
    return words.length >= 2
      && words.length <= 4
      && words.every((word) => AUTHOR_NAME_WORD_REGEX.test(word) || NAME_PARTICLE_REGEX.test(word) || isInitialLike(word));
  });
}

function looksLikeNonAuthorText(value: string): boolean {
  if (/https?:\/\//i.test(value)) return true;
  if (/^(a|an|the)\b/i.test(value) && !/,/.test(value)) return true;
  if (
    !/,/.test(value)
    && value.split(/\s+/).length > 4
    && !/[A-Z]\./.test(value)
    && !looksLikeLongPersonalName(value)
    && !looksLikeConjoinedAuthorList(value)
  ) return true;
  return false;
}

export function looksLikeTitleOrProse(value: string): boolean {
  const words = value.split(/\s+/u).filter(Boolean);
  if (words.length < 2) return false;
  // Personal-name segments are capitalized; a lowercase content word (>=3 chars, not a name
  // particle like "van"/"de") essentially never appears in a real name segment but is the hallmark
  // of a title/journal ("Genetic algorithms", "A genetic algorithm tutorial").
  const proseWords = words.filter(
    (word) =>
      /^\p{Ll}/u.test(word)
      && word.length >= 3
      && !NAME_PARTICLE_REGEX.test(word)
      && word.toLowerCase() !== 'and',
  ).length;
  return proseWords >= 1;
}

function parseAuthorsFromCommaPairs(value: string): CanonicalAuthor[] {
  // Handles strings like: "Gomes, M.A.S., Kovaleski, J.L., Pagani, R.N."
  // but avoids treating a single "Family, Given" as multiple authors.
  if (!/,/.test(value)) return [];
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 4) return [];
  if (parts.length % 2 !== 0) return [];
  if (parseLeadingFamilyGivenStandaloneList(parts).length > 0) return [];
  if (
    parts.some(
      (part, index) =>
        index > 1
        && index % 2 === 0
        && looksLikeStandaloneAuthorListChunk(normalizeStandaloneAuthorChunk(part)),
    )
  ) {
    return [];
  }

  for (let index = 0; index < parts.length; index += 2) {
    const family = parts[index] ?? '';
    const given = parts[index + 1] ?? '';
    if (!looksLikeFamilyChunk(family) || !looksLikeCommaPairFamilyChunk(family)) return [];
    if (!looksLikeGivenChunk(given)) return [];
    if (looksAmbiguousFullNamePair(family, given)) return [];
  }

  const authors: CanonicalAuthor[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const family = parts[index];
    const given = parts[index + 1];
    if (!family) continue;
    authors.push(personAuthor(family, given ?? null));
  }

  return authors;
}

function parseAuthorsFromLooseCommaList(value: string): CanonicalAuthor[] {
  if (!/,/.test(value)) return [];

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];

  const standaloneParts = parts.map(normalizeStandaloneAuthorChunk).filter(Boolean);
  if (parts.length >= 2 && standaloneParts.length === parts.length && standaloneParts.every(looksLikeStandaloneAuthorListChunk)) {
    return shouldPreferCompoundFamilyStandaloneList(standaloneParts)
      ? standaloneParts.map(parseInitialsFirstCompoundFamilyAuthor)
      : standaloneParts.map(parseSingleAuthor);
  }

  const mixedLeadList = parseLeadingFamilyGivenStandaloneList(parts);
  if (mixedLeadList.length > 0) {
    return mixedLeadList;
  }

  const authors: CanonicalAuthor[] = [];
  let index = 0;

  while (index < parts.length) {
    const family = normalizeStandaloneAuthorChunk(parts[index] ?? '');
    const given = normalizeStandaloneAuthorChunk(parts[index + 1] ?? '');
    const remainingStandalone = parts
      .slice(index + 2)
      .map(normalizeStandaloneAuthorChunk)
      .filter(Boolean);

    if (
      index === 0
      && index + 1 < parts.length
      && looksLikeFamilyChunk(family)
      && looksLikeGivenChunk(given)
      && remainingStandalone.length > 0
      && remainingStandalone.every(looksLikeStandaloneAuthorListChunk)
    ) {
      authors.push(personAuthor(family, given));
      authors.push(...remainingStandalone.map(parseSingleAuthor));
      return authors.length >= 2 ? authors : [];
    }

    if (
      index + 1 < parts.length
      && looksLikeFamilyChunk(family)
      && looksLikeGivenChunk(given)
    ) {
      if (looksAmbiguousFullNamePair(family, given)) {
        const standaloneFamily = normalizeStandaloneAuthorChunk(family);
        if (looksLikeStandaloneAuthorListChunk(standaloneFamily)) {
          authors.push(parseSingleAuthor(standaloneFamily));
          index += 1;
          continue;
        }
      }
      authors.push(personAuthor(family, given));
      index += 2;
      continue;
    }

    const standaloneFamily = normalizeStandaloneAuthorChunk(family);
    if (!looksLikeStandaloneAuthorListChunk(standaloneFamily)) {
      return [];
    }

    authors.push(parseSingleAuthor(standaloneFamily));
    index += 1;
  }

  return authors.length >= 2 ? authors : [];
}

function normalizeStandaloneAuthorChunk(value: string): string {
  return value
    .replace(/^(?:and|&)\s+/iu, '')
    .replace(/[;,.\s]+$/u, '')
    .trim();
}

function parseLeadingFamilyGivenStandaloneList(parts: string[]): CanonicalAuthor[] {
  if (parts.length < 3) return [];

  const family = parts[0] ?? '';
  const given = parts[1] ?? '';
  const givenParts = given.split(/\s+/u).filter(Boolean);
  const remainingStandalone = parts
    .slice(2)
    .map(normalizeStandaloneAuthorChunk)
    .filter(Boolean);
  const trailingStandaloneAuthorsLookValid =
    remainingStandalone.length > 0
    && remainingStandalone.every(
      (chunk) => looksLikeStandaloneAuthorListChunk(chunk) || looksLikeStandaloneAuthorChunk(chunk),
    );

  if (
    !family
    || !given
    || !looksLikeFamilyChunk(family)
    || !looksLikeGivenChunk(given)
  ) {
    return [];
  }

  if (remainingStandalone.length === 0) {
    return [];
  }

  if (trailingStandaloneAuthorsLookValid) {
    return [personAuthor(family, given), ...remainingStandalone.map(parseSingleAuthor)];
  }

  if (isInitialLike(givenParts.at(-1) ?? '')) {
    return [];
  }

  const mixedTrailingAuthors = parseMixedTrailingAuthorChunks(parts.slice(2));
  if (mixedTrailingAuthors.length > 0) {
    return [personAuthor(family, given), ...mixedTrailingAuthors];
  }

  if (givenParts.length < 2) {
    return [];
  }

  if (!remainingStandalone.every(looksLikeStandaloneAuthorListChunk)) {
    return [];
  }

  return [personAuthor(family, given), ...remainingStandalone.map(parseSingleAuthor)];
}

function parseMixedTrailingAuthorChunks(parts: string[]): CanonicalAuthor[] {
  const authors: CanonicalAuthor[] = [];
  let index = 0;

  while (index < parts.length) {
    const current = normalizeStandaloneAuthorChunk(parts[index] ?? '');
    const next = normalizeStandaloneAuthorChunk(parts[index + 1] ?? '');

    if (current && looksLikeStandaloneAuthorListChunk(current)) {
      authors.push(parseSingleAuthor(current));
      index += 1;
      continue;
    }

    if (
      current
      && next
      && looksLikeFamilyChunk(current)
      && looksLikeGivenChunk(next)
      && !looksAmbiguousFullNamePair(current, next)
    ) {
      authors.push(personAuthor(current, next));
      index += 2;
      continue;
    }

    return [];
  }

  return authors.length > 0 ? authors : [];
}

function looksLikeFamilyChunk(value: string): boolean {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  const last = parts.at(-1) ?? '';
  if (/^\p{Lu}{2,}$/u.test(last.replace(/[.'`-]+/gu, '')) && !/[.\s-]/u.test(last)) {
    return true;
  }
  return !isInitialLike(last);
}

function looksAmbiguousFullNamePair(family: string, given: string): boolean {
  const familyParts = family.split(/\s+/u).filter(Boolean);
  const givenParts = given.split(/\s+/u).filter(Boolean);
  if (familyParts.length < 2 || givenParts.length < 2) {
    return false;
  }

  const familyHasInitial = familyParts.some(isInitialLike);
  const givenHasInitial = givenParts.some(isInitialLike);
  return !familyHasInitial && !givenHasInitial;
}

function looksLikeCommaPairFamilyChunk(value: string): boolean {
  const parts = value.split(/\s+/u).filter(Boolean);
  if (parts.length === 0) {
    return false;
  }

  return !parts.some((part) => {
    const compact = part.replace(/[.\s-]/gu, '');
    return compact.length > 0 && compact.length <= 3 && isInitialLike(part);
  });
}

function looksLikeGivenChunk(value: string): boolean {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.length >= 2 && isInitialLike(parts[0] ?? '') && !isInitialLike(parts.at(-1) ?? '')) {
    return parts.length === 2 && AUTHOR_NAME_WORD_REGEX.test(parts[1] ?? '');
  }
  if (parts.length > 6) {
    return false;
  }
  return parts.every((part) => (
    isInitialLike(part)
    || NAME_PARTICLE_REGEX.test(part)
    || AUTHOR_NAME_WORD_REGEX.test(part)
  ));
}

function looksLikeStandaloneAuthorChunk(value: string): boolean {
  return value.split(/\s+/).filter(Boolean).length >= 2 || value.includes('.');
}

function looksLikeStandaloneAuthorListChunk(value: string): boolean {
  if (value.includes(',')) return false;

  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return false;
  if (looksLikeNonAuthorText(value)) return false;

  const last = parts.at(-1) ?? '';
  if (isInitialLike(last)) {
    return parts.slice(0, -1).every((part) => (
      AUTHOR_NAME_WORD_REGEX.test(part) || NAME_PARTICLE_REGEX.test(part)
    ));
  }

  if (parts.length >= 3 && isInitialLike(parts.at(-2) ?? '')) {
    return parts.slice(0, -1).every((part) => (
      isInitialLike(part)
      || AUTHOR_NAME_WORD_REGEX.test(part)
      || NAME_PARTICLE_REGEX.test(part)
    ))
      && AUTHOR_NAME_WORD_REGEX.test(last);
  }

  return parts.every((part) => (
    isInitialLike(part)
    || AUTHOR_NAME_WORD_REGEX.test(part)
    || NAME_PARTICLE_REGEX.test(part)
  ));
}

function isInitialLike(value: string): boolean {
  const compact = value.replace(/[.\s]/g, '');
  if (!compact.length || compact.length > 4 || !/^\p{Lu}(?:-?\p{Lu}){0,3}$/u.test(compact)) {
    return false;
  }

  const hasDelimiter = /[.\s-]/u.test(value);
  if (!hasDelimiter && compact.length === 4 && /[AEIOUY]/u.test(compact)) {
    return false;
  }

  return true;
}

function normalizeGiven(value: string | null): string | null {
  if (!value) return null;

  const compact = value.replace(/[.\s]/g, '');
  if (/^\p{Lu}{2,5}$/u.test(compact)) {
    return compact.split('').join(' ');
  }

  return value;
}

function countLeadingInitialLikeParts(parts: string[]): number {
  let count = 0;
  while (count < parts.length && isInitialLike(parts[count] ?? '')) {
    count += 1;
  }
  return count;
}

function shouldTreatLeadingInitialsAsCompoundFamily(parts: string[], leadingInitialCount: number): boolean {
  if (leadingInitialCount <= 0) {
    return false;
  }

  const trailingParts = parts.slice(leadingInitialCount);
  if (trailingParts.length < 2) {
    return false;
  }

  if (leadingInitialCount >= 2) {
    return true;
  }

  if (trailingParts.length >= 3) {
    return true;
  }

  return trailingParts.some((part) => NAME_PARTICLE_REGEX.test(part));
}

function shouldPreferCompoundFamilyStandaloneList(parts: string[]): boolean {
  const normalizedParts = parts
    .map(normalizeStandaloneAuthorChunk)
    .filter(Boolean);
  const initialLeadingChunkCount = normalizedParts.filter((part) => {
    const tokens = part.split(/\s+/u).filter(Boolean);
    return countLeadingInitialLikeParts(tokens) > 0 && tokens.length >= 3;
  }).length;

  return initialLeadingChunkCount >= 2 && initialLeadingChunkCount === normalizedParts.length;
}

function parseInitialsFirstCompoundFamilyAuthor(author: string): CanonicalAuthor {
  const cleaned = normalizeGluedNameInitials(author
    .replace(/&amp;/giu, '&')
    .replace(/^[\[\(]?\d+[\]\).]?\s*/, '')
    .replace(/^(?:and|&)\s+/iu, '')
    .replace(/[.;]\s*$/, '')
    .trim());
  if (!cleaned) return corporateAuthor(author);

  const parts = cleaned.split(/\s+/u).filter(Boolean);
  const leadingInitialCount = countLeadingInitialLikeParts(parts);
  if (!shouldTreatLeadingInitialsAsCompoundFamily(parts, leadingInitialCount)) {
    return parseSingleAuthor(cleaned);
  }

  return personAuthor(
    parts.slice(leadingInitialCount).join(' '),
    parts.slice(0, leadingInitialCount).join(' '),
  );
}

function looksLikeLongPersonalName(value: string): boolean {
  const parts = value.split(/\s+/u).filter(Boolean);
  if (parts.length < 5 || parts.length > 6) {
    return false;
  }

  return parts.every((part) => (
    isInitialLike(part)
    || NAME_PARTICLE_REGEX.test(part)
    || AUTHOR_NAME_WORD_REGEX.test(part)
  ));
}

function findCompoundFamilyStart(parts: string[]): number {
  if (parts.length < 3) {
    return -1;
  }

  for (let index = parts.length - 2; index >= 1; index -= 1) {
    if (!NAME_PARTICLE_REGEX.test(parts[index] ?? '')) {
      continue;
    }

    const trailingFamilyParts = parts.slice(index + 1);
    if (
      trailingFamilyParts.length > 0
      && trailingFamilyParts.length <= 3
      && trailingFamilyParts.every((part) => AUTHOR_NAME_WORD_REGEX.test(part))
    ) {
      return index;
    }
  }

  let index = parts.length - 2;
  while (index >= 1 && NAME_PARTICLE_REGEX.test(parts[index] ?? '')) {
    index -= 1;
  }

  const firstFamilyIndex = index + 1;
  return firstFamilyIndex >= 1 && firstFamilyIndex < parts.length - 1
    ? firstFamilyIndex
    : -1;
}

function segmentContainsAuthor(
  originalSegment: string,
  normalizedSegment: string,
  author: CanonicalAuthor,
): boolean {
  const candidateValues = [
    author.literal,
    author.family,
    [author.given, author.family].filter(Boolean).join(' '),
    [author.family, author.given].filter(Boolean).join(' '),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return candidateValues.some((value) => {
    const normalizedValue = normalizeComparableAuthorToken(value);
    if (!normalizedValue) return false;
    if (normalizedSegment === normalizedValue) {
      return author.isCorporate || normalizedValue.split(' ').length <= 3;
    }
    if (normalizedSegment.includes(normalizedValue)) return true;

    if (!author.isCorporate) {
      const family = normalizeComparableAuthorToken(author.family);
      if (family && normalizedSegment.includes(family)) return true;
      const initials = normalizeComparableAuthorToken(author.initials ?? '');
      if (initials && normalizeComparableAuthorToken(originalSegment).includes(initials)) return true;
    }

    return false;
  });
}

function normalizeComparableAuthorToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
