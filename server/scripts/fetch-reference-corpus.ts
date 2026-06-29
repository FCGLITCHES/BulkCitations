/**
 * Fetch REAL references for a SINGLE stratum and emit pre-labelled candidate
 * rows for human verification. (For the whole stratified set in one command,
 * use build-stratified-corpus.ts.)
 *
 *   tsx scripts/fetch-reference-corpus.ts --stratum doi_heavy --count 40 \
 *        --split holdout --mailto you@example.com --output <path> [--append] [--no-degrade]
 *
 * Free, no API key. Be polite: always pass --mailto (Crossref polite pool).
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildStratumRows } from '../src/training/corpusSources.js';

interface CliOptions {
  stratum: string;
  count: number;
  split: string;
  output: string;
  mailto: string;
  applyDegrade: boolean;
  realFormat: boolean;
  append: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    stratum: 'doi_heavy', count: 25, split: 'train', output: '', mailto: '', applyDegrade: false, realFormat: false, append: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--stratum') opts.stratum = argv[++i] ?? opts.stratum;
    else if (t === '--count') opts.count = Number(argv[++i]) || opts.count;
    else if (t === '--split') opts.split = argv[++i] ?? opts.split;
    else if (t === '--output') opts.output = resolve(process.cwd(), argv[++i] ?? '');
    else if (t === '--mailto') opts.mailto = argv[++i] ?? '';
    else if (t === '--degrade') opts.applyDegrade = true;
    else if (t === '--real-format') opts.realFormat = true;
    else if (t === '--append') opts.append = true;
  }
  if (!opts.output) opts.output = resolve(process.cwd(), `corpus_${opts.stratum}_${opts.split}.jsonl`);
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  process.stdout.write(`Fetching ${opts.count} '${opts.stratum}' refs...\n`);
  const result = await buildStratumRows(opts.stratum, opts.count, {
    mailto: opts.mailto,
    split: opts.split,
    applyDegrade: opts.applyDegrade,
    realFormat: opts.realFormat,
    accessedDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  });

  const serialized = result.rows.map((row) => JSON.stringify(row)).join('\n') + (result.rows.length ? '\n' : '');
  await mkdir(dirname(opts.output), { recursive: true });
  if (opts.append) await appendFile(opts.output, serialized, 'utf8');
  else await writeFile(opts.output, serialized, 'utf8');

  const flagged = result.rows.filter((row) => row.needs_review).length;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stratum: opts.stratum,
    source: result.source,
    fetched: result.fetched,
    written: result.rows.length,
    needsReview: flagged,
    autoClean: result.rows.length - flagged,
    note: result.note,
    output: opts.output,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[fetch-reference-corpus] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
