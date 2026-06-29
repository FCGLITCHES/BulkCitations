/**
 * Ingest a BibTeX (.bib) or RIS (.ris) export — e.g. from Google Scholar,
 * Zotero, or Mendeley — into pre-labelled candidate rows for verification.
 *
 *   tsx scripts/ingest-bibliography.ts --input scholar.bib --stratum google_scholar_export \
 *        --split holdout --output <path>
 *
 * Use this for the strata that have no API (Scholar exports, hand-collected
 * messy refs). The citation string is rendered from the parsed fields; verify
 * and, if you pasted the real formatted string, replace raw_text in review.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildCandidateRow,
  renderCitation,
  scopeFieldsForVariant,
  variantForType,
  type CandidateRow,
  type NormalizedReference,
} from '../src/training/referenceCorpus.js';

interface CliOptions {
  input: string;
  stratum: string;
  split: string;
  output: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { input: '', stratum: 'google_scholar_export', split: 'holdout', output: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--input') opts.input = resolve(process.cwd(), argv[++i] ?? '');
    else if (t === '--stratum') opts.stratum = argv[++i] ?? opts.stratum;
    else if (t === '--split') opts.split = argv[++i] ?? opts.split;
    else if (t === '--output') opts.output = resolve(process.cwd(), argv[++i] ?? '');
  }
  if (!opts.input) throw new Error('--input <file.bib|file.ris> is required');
  if (!opts.output) opts.output = resolve(process.cwd(), `ingested_${opts.stratum}.jsonl`);
  return opts;
}

function parsePersons(value: string): Array<{ family: string; given?: string }> {
  // BibTeX/RIS author lists: "Family, Given and Family, Given" or one per line.
  return value
    .split(/\s+and\s+|;|\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((name): { family: string; given?: string } => {
      if (name.includes(',')) {
        const [family, given] = name.split(',', 2);
        const person: { family: string; given?: string } = { family: family!.trim() };
        const trimmed = given?.trim();
        if (trimmed) person.given = trimmed;
        return person;
      }
      const parts = name.split(/\s+/);
      const family = parts.pop() ?? name;
      const person: { family: string; given?: string } = { family };
      const given = parts.join(' ');
      if (given) person.given = given;
      return person;
    });
}

const BIB_FIELD_MAP: Record<string, keyof NormalizedReference | 'authorsRaw' | 'editorsRaw'> = {
  author: 'authorsRaw', editor: 'editorsRaw', year: 'year', title: 'title',
  journal: 'journal', booktitle: 'bookTitle', publisher: 'publisher',
  address: 'placeOfPublication', volume: 'volume', number: 'issue', pages: 'pages',
  doi: 'doi', url: 'url',
};

export function parseBibtex(content: string): NormalizedReference[] {
  const refs: NormalizedReference[] = [];
  const entryRegex = /@(\w+)\s*\{[^,]*,([\s\S]*?)\n\}/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(content)) !== null) {
    const type = match[1]!.toLowerCase();
    const body = match[2]!;
    const ref: NormalizedReference = { authors: [] };
    const fieldRegex = /(\w+)\s*=\s*[{"]([\s\S]*?)["}]\s*,?/g;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      const key = fieldMatch[1]!.toLowerCase();
      const raw = fieldMatch[2]!.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
      const mapped = BIB_FIELD_MAP[key];
      if (!mapped) continue;
      if (mapped === 'authorsRaw') ref.authors = parsePersons(raw);
      else if (mapped === 'editorsRaw') ref.editors = parsePersons(raw);
      else (ref as Record<string, unknown>)[mapped] = raw;
    }
    ref.type = type === 'inproceedings' ? 'paper-conference' : type === 'book' ? 'book' : type === 'phdthesis' ? 'thesis' : 'article-journal';
    if (ref.authors.length || ref.title) refs.push(ref);
  }
  return refs;
}

export function parseRis(content: string): NormalizedReference[] {
  const refs: NormalizedReference[] = [];
  let current: NormalizedReference | null = null;
  for (const line of content.split(/\r?\n/)) {
    const tag = line.slice(0, 2);
    const value = line.slice(6).trim();
    if (tag === 'TY') { current = { authors: [] }; continue; }
    if (!current) continue;
    if (tag === 'ER') { if (current.authors.length || current.title) refs.push(current); current = null; continue; }
    if (tag === 'AU' || tag === 'A1') current.authors.push(...parsePersons(value));
    else if (tag === 'ED') (current.editors ??= []).push(...parsePersons(value));
    else if (tag === 'PY' || tag === 'Y1') current.year = value.slice(0, 4);
    else if (tag === 'TI' || tag === 'T1') current.title = value;
    else if (tag === 'JO' || tag === 'JF' || tag === 'T2') current.journal = value;
    else if (tag === 'PB') current.publisher = value;
    else if (tag === 'CY') current.placeOfPublication = value;
    else if (tag === 'VL') current.volume = value;
    else if (tag === 'IS') current.issue = value;
    else if (tag === 'SP') current.pages = value;
    else if (tag === 'DO') current.doi = value;
    else if (tag === 'UR') current.url = value;
  }
  return refs;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const content = await readFile(opts.input, 'utf8');
  const refs = opts.input.toLowerCase().endsWith('.ris') ? parseRis(content) : parseBibtex(content);

  const rows: CandidateRow[] = refs
    .filter((ref) => ref.authors.length || ref.title)
    .map((ref, index) => {
      const variant = variantForType(ref.type, index);
      return buildCandidateRow(renderCitation(ref, variant), scopeFieldsForVariant(ref, variant), {
        stratum: opts.stratum,
        split: opts.split,
        provenance: `bibliography:${opts.input.split(/[/\\]/).pop()}#${index}`,
      });
    });

  const serialized = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  await mkdir(dirname(opts.output), { recursive: true });
  await writeFile(opts.output, serialized, 'utf8');

  const flagged = rows.filter((row) => row.needs_review).length;
  process.stdout.write(`${JSON.stringify({
    ok: true, input: opts.input, parsed: refs.length, written: rows.length,
    needsReview: flagged, output: opts.output,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[ingest-bibliography] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
