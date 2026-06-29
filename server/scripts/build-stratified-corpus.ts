/**
 * Automated stratified corpus builder.
 *
 * Reads the eval strata.json targets and fetches REAL references for every
 * stratum from its mapped source, auto-labels them, and appends to the BIO
 * review inbox. One command builds the whole expected gold-set shape; you then
 * verify the flagged rows in the Review tab.
 *
 *   tsx scripts/build-stratified-corpus.ts --mailto you@example.com [--split holdout]
 *        [--fraction 0.25] [--only books,theses] [--dry-run]
 *
 * Free, no API key. Strata with no usable API (webpages) are reported as manual.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildStratumRows } from '../src/training/corpusSources.js';
import { hashInputForTruth } from '../src/training/truthHash.js';
import { resolveBioDatasetRoot } from '../src/runtime/artifactPaths.js';
import type { CandidateRow } from '../src/training/referenceCorpus.js';

interface CliOptions {
  mailto: string;
  split: string;
  fraction: number;
  only: string[] | null;
  output: string;
  strataPath: string;
  applyDegrade: boolean;
  realFormat: boolean;
  dryRun: boolean;
}

interface StratumSpec { key: string; target: number; why?: string }

function parseArgs(argv: string[]): CliOptions {
  const root = resolveBioDatasetRoot();
  const opts: CliOptions = {
    mailto: '',
    split: 'holdout',
    fraction: 1,
    only: null,
    output: resolve(root, 'review', 'inbox.jsonl'),
    strataPath: resolve(root, 'eval', 'strata.json'),
    applyDegrade: true,
    realFormat: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--mailto') opts.mailto = argv[++i] ?? '';
    else if (t === '--split') opts.split = argv[++i] ?? opts.split;
    else if (t === '--fraction') opts.fraction = Number(argv[++i]) || 1;
    else if (t === '--only') opts.only = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (t === '--output') opts.output = resolve(process.cwd(), argv[++i] ?? '');
    else if (t === '--strata') opts.strataPath = resolve(process.cwd(), argv[++i] ?? '');
    else if (t === '--no-degrade') opts.applyDegrade = false;
    else if (t === '--real-format') opts.realFormat = true;
    else if (t === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

function todayAccessed(): string {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function existingHashes(path: string): Promise<Set<string>> {
  const hashes = new Set<string>();
  if (!existsSync(path)) return hashes;
  const content = await readFile(path, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as { raw_text?: string };
      if (row.raw_text) hashes.add(hashInputForTruth(row.raw_text));
    } catch { /* skip */ }
  }
  return hashes;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.strataPath)) throw new Error(`strata.json not found at ${opts.strataPath}`);
  const strata = JSON.parse(await readFile(opts.strataPath, 'utf8')) as { strata: StratumSpec[] };

  let specs = strata.strata;
  if (opts.only) specs = specs.filter((s) => opts.only!.includes(s.key));

  const seen = await existingHashes(opts.output);
  const summary: Array<Record<string, unknown>> = [];
  const collected: CandidateRow[] = [];

  for (const spec of specs) {
    const target = Math.max(1, Math.ceil(spec.target * opts.fraction));
    let result;
    try {
      result = await buildStratumRows(spec.key, target, {
        mailto: opts.mailto,
        split: opts.split,
        applyDegrade: opts.applyDegrade,
        realFormat: opts.realFormat,
        accessedDate: todayAccessed(),
      });
    } catch (error) {
      summary.push({ stratum: spec.key, source: 'error', target, written: 0, status: (error as Error).message.slice(0, 60) });
      continue;
    }

    // Dedupe against the inbox and within this run.
    const fresh = result.rows.filter((row) => {
      const hash = hashInputForTruth(row.raw_text);
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
    collected.push(...fresh);

    const needsReview = fresh.filter((r) => r.needs_review).length;
    summary.push({
      stratum: spec.key,
      source: result.source,
      target,
      fetched: result.fetched,
      written: fresh.length,
      autoClean: fresh.length - needsReview,
      needsReview,
      status: result.source === 'manual' ? `MANUAL — ${result.note}` : fresh.length >= target ? 'ok' : 'under-target',
    });
  }

  if (!opts.dryRun && collected.length) {
    await mkdir(dirname(opts.output), { recursive: true });
    const serialized = collected.map((row) => JSON.stringify(row)).join('\n') + '\n';
    await appendFile(opts.output, serialized, 'utf8');
  }

  // Report.
  const totalWritten = collected.length;
  const totalTarget = specs.reduce((sum, s) => sum + Math.max(1, Math.ceil(s.target * opts.fraction)), 0);
  process.stdout.write('\n=== Stratified corpus build ===========================================\n');
  process.stdout.write(`split=${opts.split}  fraction=${opts.fraction}  degrade=${opts.applyDegrade}  realFormat=${opts.realFormat}  ${opts.dryRun ? '[DRY-RUN]' : ''}\n\n`);
  process.stdout.write('  stratum                source        tgt  written  clean  review  status\n');
  for (const row of summary) {
    process.stdout.write(
      `  ${String(row.stratum).padEnd(22)} ${String(row.source).padEnd(12)} ${String(row.target).padStart(3)}  ${String(row.written ?? 0).padStart(7)}  ${String(row.autoClean ?? '-').padStart(5)}  ${String(row.needsReview ?? '-').padStart(6)}  ${row.status}\n`,
    );
  }
  process.stdout.write(`\n  total written: ${totalWritten} / target ${totalTarget}\n`);
  process.stdout.write(`  output: ${opts.output}${opts.dryRun ? ' (not written — dry run)' : ''}\n`);
  process.stdout.write('=======================================================================\n');
}

main().catch((error) => {
  console.error(`[build-stratified-corpus] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
