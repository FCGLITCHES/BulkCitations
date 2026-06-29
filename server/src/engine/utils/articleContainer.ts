import { lookupIssnByJournalTitle } from '../data/journalIssnHints.js';

const ARTICLE_CONTAINER_KEYWORD_REGEX =
  /\b(?:journal|revista|review|annals?|letters?|transactions?|quarterly|bulletin|studies|archives?|oncology)\b/iu;
const ARTICLE_CONTAINER_NEGATIVE_REGEX =
  /\b(?:conference|symposium|workshop|congress|meeting|proceedings|proc\.?|anais|seminar|forum|abstracts publication)\b/iu;
const BOOKISH_PUBLISHER_REGEX =
  /\b(?:press|publishing|publisher|editorial|books?|editions?|springer|palgrave|cambridge|oxford|routledge|elsevier|wiley|thieme|sciendo|verlag)\b/iu;

export interface ArticleContainerSpill {
  journal: string;
  volume: string | null;
  issue: string | null;
  issnHint: string | null;
  sourceText: string;
}

export function recoverArticleContainerSpill(
  value: string | null | undefined,
): ArticleContainerSpill | null {
  const normalized = normalizeContainerValue(value);
  if (!normalized || ARTICLE_CONTAINER_NEGATIVE_REGEX.test(normalized)) {
    return null;
  }

  let journal = normalized;
  let volume: string | null = null;
  let issue: string | null = null;

  const volumeIssueMatch = normalized.match(
    /^(?<journal>.+?),\s*(?<volume>\d{1,4})(?:\((?<issue>[^)]+)\))?$/u,
  );
  const issueOnlyMatch = normalized.match(/^(?<journal>.+?),\s*\((?<issue>[^)]+)\)$/u);
  const labeledIssueMatch = normalized.match(
    /^(?<journal>.+?),\s*(?<issue>(?:No\.?|№)\s*[^,]+)$/iu,
  );

  if (volumeIssueMatch?.groups) {
    journal = normalizeContainerValue(volumeIssueMatch.groups.journal) ?? normalized;
    volume = normalizeNumericToken(volumeIssueMatch.groups.volume);
    issue = normalizeIssueToken(volumeIssueMatch.groups.issue);
  } else if (issueOnlyMatch?.groups) {
    journal = normalizeContainerValue(issueOnlyMatch.groups.journal) ?? normalized;
    issue = normalizeIssueToken(issueOnlyMatch.groups.issue);
  } else if (labeledIssueMatch?.groups) {
    journal = normalizeContainerValue(labeledIssueMatch.groups.journal) ?? normalized;
    issue = normalizeIssueToken(labeledIssueMatch.groups.issue);
  }

  if (!journal || BOOKISH_PUBLISHER_REGEX.test(journal)) {
    return null;
  }

  const issnHint = lookupIssnByJournalTitle(journal);
  if (!issnHint && looksBookSeriesLikeStudiesTitle(journal, volume, issue)) {
    return null;
  }
  if (!issnHint && !ARTICLE_CONTAINER_KEYWORD_REGEX.test(journal)) {
    return null;
  }

  return {
    journal,
    volume,
    issue,
    issnHint,
    sourceText: normalized,
  };
}

function normalizeContainerValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .normalize('NFKC')
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[,.;:\s]+/u, '')
    .replace(/["“”'‘’]+$/u, '')
    .replace(/[.,;:\s]+$/u, '')
    .trim();

  return normalized.length > 0 ? normalized : null;
}

function normalizeNumericToken(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeIssueToken(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    return null;
  }

  const explicitNumeric = normalized.match(/^(?:No\.?|№)\s*([A-Za-z]?\d[\w-]*)/iu)?.[1];
  if (explicitNumeric) {
    return explicitNumeric;
  }

  const withoutTrailingYear = normalized.replace(/\s+(?:19|20)\d{2}\s*$/u, '').trim();
  return withoutTrailingYear.length > 0 ? withoutTrailingYear : null;
}

function looksBookSeriesLikeStudiesTitle(
  value: string,
  volume: string | null,
  issue: string | null,
): boolean {
  if (volume || issue || !/^studies in\b/iu.test(value)) {
    return false;
  }

  const normalized = value.replace(/[.,;:()[\]]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  return tokens.length >= 4;
}
