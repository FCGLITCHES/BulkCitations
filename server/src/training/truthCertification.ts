import { createHash } from 'node:crypto';
import { normalizeDoi } from '../engine/identifierUtils.js';
import type {
  StoredApprovedTruth,
  TruthBlockedReason,
  TruthRowStatus,
  TruthScope,
  TruthTask,
  TruthTaskCertification,
  TruthTrustLevel,
} from '../runtime/store.js';
import type { TruthFieldValue } from './truthFields.js';

export interface CertificationLintIssue {
  blockedReason: TruthBlockedReason;
  code: string;
  message: string;
}

function truthScopeFields(row: StoredApprovedTruth, truthScope: TruthScope): Record<string, TruthFieldValue> {
  if (truthScope === 'overlay') {
    return row.overlayTruth ?? {};
  }
  return row.coreTruth ?? row.expectedFields;
}

function stringField(fields: Record<string, TruthFieldValue>, key: string): string | null {
  const raw = fields[key];
  if (typeof raw === 'string') {
    const value = raw.trim();
    return value.length > 0 ? value : null;
  }
  if (Array.isArray(raw)) {
    const item = raw.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return typeof item === 'string' ? item.trim() : null;
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  return null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

function validateIsbn(value: string): boolean {
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(normalized)) {
    const digits = normalized.split('').map((digit) => Number(digit));
    const checksum = digits.slice(0, 12).reduce((sum, digit, index) => sum + (index % 2 === 0 ? digit : digit * 3), 0);
    const checkDigit = (10 - (checksum % 10)) % 10;
    return checkDigit === digits[12];
  }
  if (/^\d{9}[\dX]$/.test(normalized)) {
    const digits = normalized.split('').map((digit) => (digit === 'X' ? 10 : Number(digit)));
    const checksum = digits.reduce((sum, digit, index) => sum + digit * (10 - index), 0);
    return checksum % 11 === 0;
  }
  return false;
}

function validateIssn(value: string): boolean {
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^\d{7}[\dX]$/.test(normalized)) {
    return false;
  }
  const digits = normalized.split('').map((digit) => (digit === 'X' ? 10 : Number(digit)));
  const checksum = digits.slice(0, 7).reduce((sum, digit, index) => sum + digit * (8 - index), 0);
  const expected = (11 - (checksum % 11)) % 11;
  return expected === digits[7];
}

function compatibilityIssues(
  row: StoredApprovedTruth,
  fields: Record<string, TruthFieldValue>,
): CertificationLintIssue[] {
  const issues: CertificationLintIssue[] = [];
  const referenceType = row.expectedType;
  const hasJournal = Boolean(stringField(fields, 'journal') || stringField(fields, 'journal/venue'));
  const hasConferenceTitle = Boolean(stringField(fields, 'conferenceTitle'));
  const hasVolumeLike = Boolean(stringField(fields, 'volume') || stringField(fields, 'issue') || stringField(fields, 'issn'));

  if (referenceType === 'article-journal' && hasConferenceTitle && !hasJournal && hasVolumeLike) {
    issues.push({
      blockedReason: 'family_incompatible',
      code: 'ARTICLE_WITH_CONFERENCE_ONLY',
      message: 'article-journal truth cannot keep conference-only container when journal and locator evidence exist.',
    });
  }

  if (referenceType === 'conference-paper' && hasJournal && !hasConferenceTitle && !hasVolumeLike) {
    issues.push({
      blockedReason: 'family_incompatible',
      code: 'CONFERENCE_WITH_JOURNAL_ONLY',
      message: 'conference-paper truth must not rely on journal-only container without conference evidence.',
    });
  }

  return issues;
}

function inferabilityIssues(
  row: StoredApprovedTruth,
  truthScope: TruthScope,
  fields: Record<string, TruthFieldValue>,
): CertificationLintIssue[] {
  const issues: CertificationLintIssue[] = [];
  if (truthScope !== 'core') {
    return issues;
  }
  const inferability = row.inferabilityByField ?? {};
  for (const key of Object.keys(fields)) {
    if (inferability[key] === 'overlay_only') {
      issues.push({
        blockedReason: 'inferability_conflict',
        code: 'OVERLAY_ONLY_IN_CORE_SCOPE',
        message: `field "${key}" is marked overlay_only and cannot be certified in core scope.`,
      });
    }
  }
  return issues;
}

function styleScopeIssues(
  _row: StoredApprovedTruth,
  truthScope: TruthScope,
): CertificationLintIssue[] {
  if (truthScope !== 'core') {
    return [];
  }
  return [];
}

export function evaluateCertificationLint(
  row: StoredApprovedTruth,
  truthScope: TruthScope,
): CertificationLintIssue[] {
  const fields = truthScopeFields(row, truthScope);
  const issues: CertificationLintIssue[] = [];

  const doi = stringField(fields, 'doi');
  const url = stringField(fields, 'url');
  const normalizedDoi = normalizeDoi(doi ?? undefined);
  const normalizedFromUrl = normalizeDoi(url ?? undefined);
  if (doi && !normalizedDoi) {
    issues.push({
      blockedReason: 'identifier_invalid',
      code: 'DOI_INVALID',
      message: 'DOI must be syntactically valid.',
    });
  }
  if (normalizedDoi && normalizedFromUrl && normalizedDoi !== normalizedFromUrl) {
    issues.push({
      blockedReason: 'source_conflict',
      code: 'DOI_URL_MISMATCH',
      message: 'DOI and DOI URL do not agree.',
    });
  }

  const isbn = stringField(fields, 'isbn');
  if (isbn && !validateIsbn(isbn)) {
    issues.push({
      blockedReason: 'identifier_invalid',
      code: 'ISBN_INVALID',
      message: 'ISBN checksum is invalid.',
    });
  }

  const issn = stringField(fields, 'issn');
  if (issn && !validateIssn(issn)) {
    issues.push({
      blockedReason: 'identifier_invalid',
      code: 'ISSN_INVALID',
      message: 'ISSN checksum or format is invalid.',
    });
  }

  const year = stringField(fields, 'year');
  if (year && !/^\d{4}$/.test(year)) {
    issues.push({
      blockedReason: 'canonicalization_unclear',
      code: 'YEAR_FORMAT_INVALID',
      message: 'Year must be a 4-digit canonical value.',
    });
  }

  const pages = stringField(fields, 'pages');
  if (pages && !/\d/.test(pages)) {
    issues.push({
      blockedReason: 'canonicalization_unclear',
      code: 'PAGES_FORMAT_INVALID',
      message: 'Pages must include numeric page markers.',
    });
  }

  issues.push(...compatibilityIssues(row, fields));
  issues.push(...inferabilityIssues(row, truthScope, fields));
  issues.push(...styleScopeIssues(row, truthScope));
  return issues;
}

export function certificationKey(task: TruthTask, truthScope: TruthScope): string {
  return `${task}:${truthScope}`;
}

export function getTaskCertification(
  row: StoredApprovedTruth,
  task: TruthTask,
  truthScope: TruthScope,
): TruthTaskCertification | null {
  const rows = row.taskCertifications ?? [];
  return rows.find((entry) => entry.task === task && entry.truthScope === truthScope) ?? null;
}

export function setTaskCertification(
  row: StoredApprovedTruth,
  certification: TruthTaskCertification,
): TruthTaskCertification[] {
  const current = row.taskCertifications ?? [];
  const next = current.filter(
    (entry) => !(entry.task === certification.task && entry.truthScope === certification.truthScope),
  );
  next.push(certification);
  return next;
}

export function isTaskCertified(
  row: StoredApprovedTruth,
  task: TruthTask,
  truthScope: TruthScope,
): boolean {
  const certification = getTaskCertification(row, task, truthScope);
  return certification?.status === 'certified';
}

export function effectiveRowStatus(row: StoredApprovedTruth): StoredApprovedTruth['rowStatus'] {
  if (row.rowStatus) {
    return row.rowStatus;
  }
  return legacyTrustToRowStatus(row.trustLevel);
}

export function legacyTrustToRowStatus(trustLevel: TruthTrustLevel | undefined): TruthRowStatus {
  if (trustLevel === 'gold') {
    return 'reviewed';
  }
  if (trustLevel === 'reviewed') {
    return 'reviewed';
  }
  return 'draft';
}

export function withLegacyCertification(row: StoredApprovedTruth): StoredApprovedTruth {
  return {
    ...row,
    rowStatus: row.rowStatus ?? legacyTrustToRowStatus(row.trustLevel),
  };
}

export function buildDecisionHash(row: StoredApprovedTruth, truthScope: TruthScope): string {
  const payload = {
    rawText: row.rawText,
    expectedType: row.expectedType ?? null,
    expectedStyle: row.expectedStyle ?? null,
    truthScope,
    fields: truthScopeFields(row, truthScope),
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function hasSplitLeakage(
  row: StoredApprovedTruth,
  allRows: StoredApprovedTruth[],
): boolean {
  const split = row.datasetSplit ?? null;
  if (!split) {
    return false;
  }
  const trackLeakage = (
    keyValue: string | null | undefined,
    keySelector: (candidate: StoredApprovedTruth) => string | null | undefined,
  ): boolean => {
    if (!keyValue) {
      return false;
    }
    const seen = new Set<string>();
    for (const candidate of allRows) {
      if (keySelector(candidate) === keyValue && candidate.datasetSplit) {
        seen.add(candidate.datasetSplit);
      }
    }
    return seen.size > 1;
  };

  return (
    trackLeakage(row.canonicalWorkKey, (candidate) => candidate.canonicalWorkKey)
    || trackLeakage(row.workId, (candidate) => candidate.workId)
    || trackLeakage(row.familyId, (candidate) => candidate.familyId)
    || trackLeakage(row.nearDupClusterId, (candidate) => candidate.nearDupClusterId)
  );
}

export function precedenceFromLegacyTrust(trustLevel: TruthTrustLevel): number {
  switch (trustLevel) {
    case 'gold':
      return 2;
    case 'reviewed':
      return 1;
    default:
      return 0;
  }
}
