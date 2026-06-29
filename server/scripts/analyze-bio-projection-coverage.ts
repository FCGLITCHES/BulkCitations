/**
 * Quantifies how much BIO supervision the OLD `indexOf`-only projection was
 * silently dropping, versus the hardened normalized + fuzzy aligner.
 *
 * It re-runs a faithful copy of the original projection algorithm and the new
 * one over the same real source rows (default: the exported style-gold
 * supervision JSONL) and reports rows + field values recovered.
 *
 *   tsx scripts/analyze-bio-projection-coverage.ts [--input <path>] [--output <path>] [--limit N]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildBioSupervisionRowsFromStyleGoldWithDiagnostics,
  type StyleGoldBioSourceRow,
} from '../src/training/bioSupervisionExport.js';
import { hashInputForTruth } from '../src/training/truthHash.js';
import { resolveBioDatasetRoot } from '../src/runtime/artifactPaths.js';

interface CliOptions {
  inputPath: string;
  outputPath: string;
  limit: number | null;
}

function parseArgs(argv: string[]): CliOptions {
  let inputPath = resolve(resolveBioDatasetRoot(), 'processed', 'style_gold_supervision.jsonl');
  let outputPath = resolve(resolveBioDatasetRoot(), 'reports', 'projection_coverage.json');
  let limit: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--input') { inputPath = resolve(process.cwd(), argv[++index] ?? ''); continue; }
    if (token === '--output') { outputPath = resolve(process.cwd(), argv[++index] ?? ''); continue; }
    if (token === '--limit') { limit = Number(argv[++index]) || null; continue; }
  }
  return { inputPath, outputPath, limit };
}

async function readRows(path: string, limit: number | null): Promise<StyleGoldBioSourceRow[]> {
  const content = await readFile(path, 'utf8');
  const rows: StyleGoldBioSourceRow[] = [];
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = JSON.parse(line) as Partial<StyleGoldBioSourceRow>;
    if (typeof parsed.raw_text !== 'string' || !parsed.raw_text.trim()) continue;
    if (!parsed.expected_fields || typeof parsed.expected_fields !== 'object' || Array.isArray(parsed.expected_fields)) continue;
    rows.push(parsed as StyleGoldBioSourceRow);
    if (limit && rows.length >= limit) break;
  }
  return rows;
}

function dedupeByHash(rows: StyleGoldBioSourceRow[]): StyleGoldBioSourceRow[] {
  const byHash = new Map<string, StyleGoldBioSourceRow>();
  for (const row of rows) {
    byHash.set(row.input_hash || hashInputForTruth(row.raw_text), row);
  }
  return [...byHash.values()];
}

// ---------------------------------------------------------------------------
// Faithful copy of the ORIGINAL projection (indexOf only, one span per field,
// no place_of_publication, whole-row drop on all-O). DO NOT "improve" this — its
// job is to reproduce exactly what was shipping so the delta is honest.
// ---------------------------------------------------------------------------
const LEGACY_FIELD_LABELS: Record<string, string> = {
  authors: 'author', editors: 'editors', year: 'year', title: 'title', journal: 'journal',
  conferenceTitle: 'conference_title', bookTitle: 'book_title', publisher: 'publisher',
  institution: 'institution', edition: 'edition', thesisType: 'thesis_type', repository: 'repository',
  articleNumber: 'article_number', accessedDate: 'accessed_date', siteName: 'site_name',
  database: 'database', reportNumber: 'report_number', volume: 'volume', issue: 'issue',
  pages: 'pages', doi: 'doi', url: 'url',
};

function legacyCandidates(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value).trim()].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(legacyCandidates).filter(Boolean);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) return legacyCandidates(record.value);
    const literal = typeof record.literal === 'string' ? record.literal.trim() : '';
    const family = typeof record.family === 'string' ? record.family.trim() : '';
    const given = typeof record.given === 'string' ? record.given.trim() : '';
    return [literal, family && given ? `${family}, ${given}` : '', family && given ? `${given} ${family}` : '', family].filter(Boolean);
  }
  return [];
}

interface LegacyTally { emitted: number; dropped: number; spansPlaced: number; perFieldSpans: Record<string, number>; }

function legacyProject(rows: StyleGoldBioSourceRow[]): LegacyTally {
  const tally: LegacyTally = { emitted: 0, dropped: 0, spansPlaced: 0, perFieldSpans: {} };
  for (const row of rows) {
    const rawLower = row.raw_text.toLowerCase();
    let placed = 0;
    for (const [field, value] of Object.entries(row.expected_fields)) {
      const label = LEGACY_FIELD_LABELS[field];
      if (!label) continue;
      for (const candidate of legacyCandidates(value)) {
        if (!candidate) continue;
        const start = rawLower.indexOf(candidate.toLowerCase());
        if (start >= 0) {
          placed += 1;
          tally.perFieldSpans[field] = (tally.perFieldSpans[field] ?? 0) + 1;
          break;
        }
      }
    }
    tally.spansPlaced += placed;
    if (placed > 0) tally.emitted += 1; else tally.dropped += 1;
  }
  return tally;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const allRows = await readRows(options.inputPath, options.limit);
  const rows = dedupeByHash(allRows);

  const legacy = legacyProject(rows);
  const { rows: hardenedRows, report } = buildBioSupervisionRowsFromStyleGoldWithDiagnostics(rows);

  const recoveredFieldValues = report.methodCounts.normalized + report.methodCounts.fuzzy;
  const rowsRecovered = legacy.dropped - report.failedRows;

  const summary = {
    inputPath: options.inputPath,
    sourceRows: allRows.length,
    uniqueRows: rows.length,
    legacy: {
      emittedRows: legacy.emitted,
      droppedRows: legacy.dropped,
      fieldSpansPlaced: legacy.spansPlaced,
    },
    hardened: {
      emittedRows: hardenedRows.length,
      failedRows: report.failedRows,
      partialRows: report.partialRows,
      totalFieldValues: report.totalFieldValues,
      matchedFieldValues: report.matchedFieldValues,
      unmatchedFieldValues: report.unmatchedFieldValues,
      coveragePct: report.totalFieldValues > 0
        ? Number(((report.matchedFieldValues / report.totalFieldValues) * 100).toFixed(2))
        : 0,
      byMethod: report.methodCounts,
    },
    recovery: {
      rowsRecoveredFromAllOdrop: rowsRecovered,
      fieldValuesRecoveredByNormalizationOrFuzzy: recoveredFieldValues,
      extraFieldSpansVsLegacy: report.matchedFieldValues - legacy.spansPlaced,
      stillUnmatchedByField: report.unmatchedByField,
    },
  };

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const lines = [
    '',
    '=== BIO projection coverage ===========================================',
    `source rows:                 ${summary.sourceRows}  (unique: ${summary.uniqueRows})`,
    '',
    '  OLD (indexOf only)',
    `    rows emitted:            ${legacy.emitted}`,
    `    rows DROPPED (all-O):    ${legacy.dropped}`,
    `    field spans placed:      ${legacy.spansPlaced}`,
    '',
    '  HARDENED (normalized + fuzzy, per-author)',
    `    rows emitted:            ${hardenedRows.length}`,
    `    rows failed (flagged):   ${report.failedRows}`,
    `    field-value coverage:    ${summary.hardened.matchedFieldValues}/${summary.hardened.totalFieldValues}  (${summary.hardened.coveragePct}%)`,
    `    by method:               exact=${report.methodCounts.exact}  normalized=${report.methodCounts.normalized}  fuzzy=${report.methodCounts.fuzzy}  unmatched=${report.methodCounts.unmatched}`,
    '',
    '  RECOVERY (what the old projection was losing)',
    `    rows rescued from drop:  ${rowsRecovered}`,
    `    values rescued (norm+fuzzy): ${recoveredFieldValues}`,
    `    extra spans vs legacy:   ${summary.recovery.extraFieldSpansVsLegacy}`,
    `    still unmatched (top):   ${topUnmatched(report.unmatchedByField)}`,
    '=======================================================================',
    `report written: ${options.outputPath}`,
    '',
  ];
  process.stdout.write(lines.join('\n'));
}

function topUnmatched(byField: Record<string, number>): string {
  const entries = Object.entries(byField).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (entries.length === 0) return '(none)';
  return entries.map(([field, count]) => `${field}=${count}`).join('  ');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
