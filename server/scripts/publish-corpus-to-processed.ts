/**
 * Publish verified (or auto-clean candidate) rows as a trainable BIO gold
 * dataset under the processed/ root, where the Training tab lists it and the
 * Python trainer can load it.
 *
 *   tsx scripts/publish-corpus-to-processed.ts                       # verified -> processed gold
 *   tsx scripts/publish-corpus-to-processed.ts --input review/inbox.jsonl --auto-clean-only
 *   tsx scripts/publish-corpus-to-processed.ts --name real_corpus_gold_v1.jsonl
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { candidateToBioRow, type SpanRow } from '../src/training/bioRowConvert.js';
import { resolveBioDatasetRoot } from '../src/runtime/artifactPaths.js';

interface CliOptions {
  input: string;
  output: string;
  autoCleanOnly: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const root = resolveBioDatasetRoot();
  let input = resolve(root, 'review', 'verified.jsonl');
  let name = 'review_verified_gold.jsonl';
  let outputOverride = '';
  let autoCleanOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--input') { const v = argv[++i] ?? ''; input = isAbsolute(v) ? v : resolve(root, v); }
    else if (t === '--name') name = argv[++i] ?? name;
    else if (t === '--output') outputOverride = resolve(process.cwd(), argv[++i] ?? '');
    else if (t === '--auto-clean-only') autoCleanOnly = true;
  }
  const output = outputOverride || resolve(root, 'processed', name);
  return { input, output, autoCleanOnly };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.input)) throw new Error(`input not found: ${opts.input}`);

  const content = await readFile(opts.input, 'utf8');
  const seen = new Set<string>();
  const bioRows: string[] = [];
  let read = 0;
  let skipped = 0;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    read += 1;
    let row: SpanRow;
    try {
      row = JSON.parse(trimmed) as SpanRow;
    } catch {
      skipped += 1;
      continue;
    }
    if (opts.autoCleanOnly && row.needs_review) { skipped += 1; continue; }
    const bio = candidateToBioRow(row);
    if (!bio) { skipped += 1; continue; }
    if (seen.has(bio.input_hash)) { skipped += 1; continue; }
    seen.add(bio.input_hash);
    bioRows.push(JSON.stringify(bio));
  }

  await mkdir(dirname(opts.output), { recursive: true });
  await writeFile(opts.output, bioRows.join('\n') + (bioRows.length ? '\n' : ''), 'utf8');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    input: opts.input,
    output: opts.output,
    read,
    written: bioRows.length,
    skipped,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[publish-corpus-to-processed] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
