import type { StoredApprovedTruth } from '../runtime/store.js';
import { stripLeadingReferenceNumbering } from '../lib/referenceNumbering.js';
import { hashInputForTruth } from '../training/truthHash.js';

export function normalizeAdminTruthRawText(rawText: string): string {
  const stripped = stripLeadingReferenceNumbering(rawText).trim();
  return stripped.length > 0 ? stripped : rawText.trim();
}

export function hashAdminTruthRawText(rawText: string): string {
  return hashInputForTruth(normalizeAdminTruthRawText(rawText));
}

export function findApprovedTruthByAdminRawText(
  rows: readonly StoredApprovedTruth[],
  rawText: string,
): StoredApprovedTruth | null {
  const normalizedHash = hashAdminTruthRawText(rawText);
  return (
    rows.find(
      (row) => row.inputHash === normalizedHash || hashAdminTruthRawText(row.rawText) === normalizedHash,
    ) ?? null
  );
}
