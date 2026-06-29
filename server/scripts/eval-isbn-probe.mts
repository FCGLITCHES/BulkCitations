// ISBN-only diagnostic probe. Runs the engine over gold rows whose expected_fields
// has an isbn, compares extracted vs gold, and categorizes misses. Read-only; deletable.
import { readFileSync } from "node:fs";

process.env.BULKREFERENCES_ISOLATED_RUNTIME = "true";

const { normalizeIsbn } = await import("../src/engine/identifierUtils.js");
const { createPipelineDependencies } = await import("../src/pipeline/dependencies.js");
const { createPipelineContext, runConvertPipeline } = await import("../src/pipeline/orchestrator.js");

const rows = readFileSync(
  "../datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl",
  "utf8",
).trim().split("\n").map((line) => JSON.parse(line));

const deps = createPipelineDependencies();

function getField(fields: Record<string, unknown>, name: string): unknown {
  const f = fields?.[name];
  if (f == null) return null;
  if (typeof f === "object" && !Array.isArray(f) && "value" in (f as object)) {
    return (f as Record<string, unknown>).value;
  }
  return f;
}

// ISBN-10 <-> ISBN-13 conversion for form-mismatch detection
function isbn10to13(v: string): string | null {
  const n = normalizeIsbn(v);
  if (!n || n.length !== 10) return null;
  const core = "978" + n.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return core + String(check);
}

type Miss = { id: string; input: string; gold: string; got: string | null; cat: string };
const misses: Miss[] = [];
let total = 0, hit = 0, tp = 0, fp = 0, fn = 0;

for (const row of rows) {
  const goldRaw = row.expected_fields?.isbn;
  if (goldRaw == null || goldRaw === "") continue;
  const gold = normalizeIsbn(goldRaw) ?? String(goldRaw);
  total += 1;

  const ctx = createPipelineContext({ outputStyle: "apa7" });
  let res: Awaited<ReturnType<typeof runConvertPipeline>>;
  try {
    res = await runConvertPipeline({ sourceType: "text", content: row.input, outputStyle: "apa7" } as never, ctx, deps);
  } catch {
    misses.push({ id: row.id, input: row.input, gold, got: null, cat: "engine-threw" });
    fn += 1;
    continue;
  }
  const fields = (res.response.references[0] as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
  const gotRaw = getField(fields, "isbn");
  const got = typeof gotRaw === "string" ? gotRaw : null;
  const gotNorm = got ? normalizeIsbn(got) : null;

  if (gotNorm === gold) { hit += 1; tp += 1; continue; }

  // categorize
  let cat: string;
  if (!got) {
    // input contains the isbn somewhere?
    const compact = String(row.input).replace(/[^0-9Xx]/g, "");
    if (compact.includes(gold) || (isbn10to13(gold) && false)) cat = "missed-but-present-in-input";
    else if (/10\.\d{4,9}\/97[89]/.test(String(row.input))) cat = "missed-doi-embedded-isbn";
    else cat = "missed-not-in-input";
    fn += 1;
  } else if (gotNorm && gotNorm.length !== gold.length) {
    cat = `form-mismatch (got len ${gotNorm.length} vs gold ${gold.length})`;
    fp += 1; fn += 1;
  } else if (gotNorm && isbn10to13(gotNorm) === gold) {
    cat = "isbn10-vs-isbn13";
    fp += 1; fn += 1;
  } else {
    // Is gold = got decremented by 1 in the body (Springer print<->electronic pairing)?
    const body = BigInt(gotNorm!.slice(0, 12));
    const decBody = (body - 1n).toString().padStart(12, "0");
    let s = 0;
    for (let i = 0; i < 12; i++) s += Number(decBody[i]) * (i % 2 === 0 ? 1 : 3);
    const dec13 = decBody + String((10 - (s % 10)) % 10);
    if (dec13 === gold) cat = "wrong-value:got=electronic,gold=print(-1)";
    else cat = "wrong-value:unrelated-isbn";
    fp += 1; fn += 1;
  }
  misses.push({ id: `${row.id}|${row.input_profile}`, input: String(row.input).slice(0, 0), gold, got: gotNorm ?? got, cat });
}

const prec = tp + fp === 0 ? 0 : tp / (tp + fp);
const rec = tp + fn === 0 ? 0 : tp / (tp + fn);
const f1 = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);

process.stdout.write(`\n=== ISBN probe over ${total} gold rows with isbn ===\n`);
process.stdout.write(`exact hits: ${hit}/${total} (${((hit / total) * 100).toFixed(1)}%)\n`);
process.stdout.write(`precision=${prec.toFixed(3)} recall=${rec.toFixed(3)} f1=${f1.toFixed(3)}\n`);
process.stdout.write(`tp=${tp} fp=${fp} fn=${fn}\n\n`);

const byCat: Record<string, number> = {};
for (const m of misses) byCat[m.cat] = (byCat[m.cat] ?? 0) + 1;
process.stdout.write("=== miss categories ===\n");
for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`${String(n).padStart(4)}  ${c}\n`);
}
process.stdout.write("\n=== all misses ===\n");
for (const m of misses) {
  process.stdout.write(`[${m.cat}] gold=${m.gold} got=${m.got ?? "(none)"} id=${m.id}\n`);
}
process.exit(0);
