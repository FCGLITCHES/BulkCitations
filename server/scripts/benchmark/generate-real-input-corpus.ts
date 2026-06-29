// Generate the real-input gold corpus: ~1000 references stratified across
// reference type x citation style x input mode, where the references are REAL
// (Crossref/OpenLibrary records) and the *input* is degraded with realistic paste
// artifacts (PDF copy, OCR, numbered lists). Each row keeps its expected_fields, so
// the file is both a real-input benchmark and an ML eval/gold set.
//
// Output is JSONL (newlines inside degraded inputs are JSON-escaped), which the
// one-ref-per-line benchmark corpus format cannot represent.
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildBenchmarkCorpus } from "../../src/benchmark/corpus.js";
import { resolveBenchmarkPaths } from "../../src/benchmark/paths.js";
import type { BenchmarkManifestRow } from "../../src/benchmark/types.js";

process.env.BULKREFERENCES_ISOLATED_RUNTIME ??= "true";

const NAME = "real-input-gold-v1";
const TARGET = 1000;
const OUT_DIR = path.resolve(process.cwd(), "../datasets/engine-v2/gold/real-input");

function classifyInputProfile(row: BenchmarkManifestRow): string {
  if (row.input_source_kind === "pdf_copy") return "pasted_pdf_copy";
  if (row.input_source_kind === "numbered_block") return "multiline_numbered";
  if (row.input_source_kind === "raw_pasted" && row.variant_kind === "noisy") return "ocr_like";
  return row.variant_kind === "noisy" ? "structured_noisy" : "structured_clean";
}

/** Round-robin across (type x source-kind) buckets so the sample is balanced + deterministic. */
function stratifiedSample(rows: BenchmarkManifestRow[], target: number): BenchmarkManifestRow[] {
  const buckets = new Map<string, BenchmarkManifestRow[]>();
  for (const row of rows) {
    const key = `${row.reference_type}|${row.input_source_kind}|${row.variant_kind}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  const ordered = [...buckets.values()].map((b) =>
    [...b].sort((a, z) => a.variant_id.localeCompare(z.variant_id)),
  );
  const picked: BenchmarkManifestRow[] = [];
  for (let i = 0; picked.length < target; i += 1) {
    let advanced = false;
    for (const bucket of ordered) {
      const row = bucket[i];
      if (row) {
        picked.push(row);
        advanced = true;
        if (picked.length >= target) break;
      }
    }
    if (!advanced) break;
  }
  return picked;
}

async function main(): Promise<void> {
  // buildBenchmarkCorpus writes to the pilot mode paths; back them up and restore after.
  const pilot = resolveBenchmarkPaths("pilot");
  const backups: Array<[string, string]> = [
    [pilot.manifestPath, `${pilot.manifestPath}.realbak`],
    [pilot.formattedStringsPath, `${pilot.formattedStringsPath}.realbak`],
    [pilot.noiseLogPath, `${pilot.noiseLogPath}.realbak`],
  ];
  for (const [src, dst] of backups) {
    await copyFile(src, dst).catch(() => {});
  }

  const built = await buildBenchmarkCorpus("pilot", { realInputModes: true });

  // restore the pilot corpus immediately — we only want the in-memory manifest.
  for (const [src, dst] of backups) {
    await copyFile(dst, src).catch(() => {});
  }

  const sample = stratifiedSample(built.manifest, TARGET);

  const jsonl = sample
    .map((row) =>
      JSON.stringify({
        id: row.variant_id,
        input: row.formatted_string,
        expected_fields: row.expected_fields,
        reference_type: row.reference_type,
        citation_style: row.citation_style,
        input_source_kind: row.input_source_kind,
        input_profile: classifyInputProfile(row),
        source: row.source,
        source_url: row.source_url,
      }),
    )
    .join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  const jsonlPath = path.join(OUT_DIR, `${NAME}.jsonl`);
  await writeFile(jsonlPath, `${jsonl}\n`, "utf8");

  // Stats for the README + console.
  const byProfile: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byStyle: Record<string, number> = {};
  for (const row of sample) {
    const p = classifyInputProfile(row);
    byProfile[p] = (byProfile[p] ?? 0) + 1;
    byType[row.reference_type] = (byType[row.reference_type] ?? 0) + 1;
    byStyle[row.citation_style] = (byStyle[row.citation_style] ?? 0) + 1;
  }

  const readme = `# ${NAME}

Real-input gold corpus for BulkReferences — **${sample.length} references**.

## What this is (and what "real" means)

- **References are real.** Each record is a genuine Crossref / OpenLibrary entry (real
  DOIs, titles, authors, ISBNs from actual published works), rendered into a citation
  string via CSL — the same way citation tools format references.
- **The input is degraded realistically.** On top of the real reference, each row applies
  one input mode that mirrors how references actually arrive in the product:
  PDF copy-paste (column wraps + cross-line hyphenation), OCR character confusions, or
  numbered-list paste. Transforms are deterministic and **field-preserving**: the
  \`expected_fields\` gold is unchanged, so this measures recall under real degradation.
- The only simulated part is the degradation itself (you cannot get gold-labelled scans
  at scale); the bibliographic data is not fabricated.

## Dual purpose

Each row carries \`expected_fields\`, so this file is simultaneously a **real-input
benchmark** and an **ML eval/gold set**. Format is JSONL (one row per line); degraded
inputs may contain newlines, JSON-escaped.

## Row schema

\`id\`, \`input\` (degraded reference), \`expected_fields\` (gold), \`reference_type\`,
\`citation_style\`, \`input_source_kind\`, \`input_profile\`, \`source\`, \`source_url\`.

## Stratification

By input profile: ${JSON.stringify(byProfile)}
By reference type: ${JSON.stringify(byType)}
By citation style: ${JSON.stringify(byStyle)}

## Provenance

Generated by \`server/scripts/benchmark/generate-real-input-corpus.ts\` from the
grobid-pmc real seed records, with input-mode transforms from
\`server/src/benchmark/realInputModes.ts\`. Deterministic — re-running reproduces the set.
`;
  await writeFile(path.join(OUT_DIR, "README.md"), readme, "utf8");

  process.stdout.write(
    `${JSON.stringify(
      { name: NAME, rows: sample.length, jsonlPath, byProfile, byType, byStyle },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
