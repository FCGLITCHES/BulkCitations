// Decomposition harness: runs the pipeline once, scores each ref under 4 progressively
// fairer scorer variants so we can separate "broken metric" from "real extraction gap".
//   v0 strict     = current scorer (ASCII-only normalize)  [reproduces baseline]
//   v1 unicode    = v0 but normalize keeps all Unicode letters/numbers
//   v2 +authors   = v1 but authors compared family+initial-aware (credits initials vs full name)
//   v3 +fuzztext  = v2 but title/journal/publisher credit >=0.88 char-similarity (credits OCR noise)
// Read-only; deletable.
import { readFileSync, writeFileSync } from "node:fs";

process.env.BULKREFERENCES_ISOLATED_RUNTIME = "true";

const { createPipelineDependencies } = await import("../src/pipeline/dependencies.js");
const { createPipelineContext, runConvertPipeline } = await import("../src/pipeline/orchestrator.js");

const rows = readFileSync(
  "../datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl",
  "utf8",
).trim().split("\n").map((line) => JSON.parse(line));

const deps = createPipelineDependencies();
const FIELDS = ["authors", "title", "journal", "year", "doi", "volume", "issue", "pages", "publisher"];
const VARIANTS = ["v0_strict", "v1_unicode", "v2_authors", "v3_fuzztext"] as const;
type Variant = (typeof VARIANTS)[number];

// ---- normalizers ----
function flattenAuthors(v: unknown): string {
  if (!Array.isArray(v)) return String(v ?? "");
  return v
    .map((x) =>
      x && typeof x === "object"
        ? (x as Record<string, string>).literal ??
          [(x as Record<string, string>).family, (x as Record<string, string>).given].filter(Boolean).join(" ")
        : x,
    )
    .join(" ");
}
function nrmAscii(value: unknown): string {
  return flattenAuthors(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}
function nrmUni(value: unknown): string {
  // Unicode-aware AND diacritic-insensitive: keeps Cyrillic/CJK/etc, and folds accents so
  // the `non_ascii` noise transform (e->é, a->à) doesn't fail a faithfully-extracted field.
  return flattenAuthors(value)
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// ---- author-aware comparison ----
type Name = { family: string; given: string };
function parseGoldName(s: string): Name {
  // gold authors are "Family, Given" or "Family Given" or a literal/corporate string
  const comma = s.indexOf(",");
  if (comma >= 0) return { family: s.slice(0, comma).trim(), given: s.slice(comma + 1).trim() };
  const parts = s.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0] ?? "", given: "" };
  return { family: parts[parts.length - 1] ?? "", given: parts.slice(0, -1).join(" ") };
}
function gotName(x: unknown): Name {
  if (x && typeof x === "object") {
    const o = x as Record<string, string>;
    if (o.literal) return parseGoldName(o.literal);
    return { family: o.family ?? "", given: o.given ?? o.initials ?? "" };
  }
  return parseGoldName(String(x ?? ""));
}
function uni(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function firstInitial(given: string): string {
  const m = given.normalize("NFKC").trim().match(/\p{L}/u);
  return m ? m[0].toLowerCase() : "";
}
function authorsMatchAware(got: unknown, exp: unknown): boolean {
  const expArr = Array.isArray(exp) ? exp : [exp];
  const gotArr = Array.isArray(got) ? got : got == null ? [] : [got];
  if (gotArr.length === 0) return false;
  // Each expected author must find a got author with same family + matching first initial.
  let matched = 0;
  for (const e of expArr) {
    const en = parseGoldName(String(e));
    const efam = uni(en.family);
    const einit = firstInitial(en.given);
    const hit = gotArr.some((g) => {
      const gn = gotName(g);
      const gfam = uni(gn.family);
      if (!gfam || !efam) return false;
      const famOk = gfam === efam || (gfam.length > 3 && (gfam.includes(efam) || efam.includes(gfam)));
      if (!famOk) return false;
      const ginit = firstInitial(gn.given);
      // credit if either has no given (just family) or initials agree
      return !einit || !ginit || ginit === einit;
    });
    if (hit) matched += 1;
  }
  // credit field if we matched at least the count of expected (order-insensitive), allowing the
  // common truncation where got has same-or-more authors
  return matched >= expArr.length;
}

// ---- fuzzy text similarity (Levenshtein ratio on unicode-normalized) ----
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
function simRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - lev(a, b) / maxLen;
}

function getField(fields: Record<string, unknown>, name: string): unknown {
  const f = fields?.[name];
  if (f == null) return null;
  if (typeof f === "object" && !Array.isArray(f) && "value" in (f as object)) {
    return (f as Record<string, unknown>).value;
  }
  return f;
}

// strict/unicode substring matcher (shared shape with original scorer)
function substrMatch(g: string, e: string): boolean | null {
  if (!e) return null;
  if (!g) return false;
  return g === e || (e.length > 4 && (g.includes(e) || e.includes(g)));
}

function scoreField(variant: Variant, field: string, got: unknown, exp: unknown): boolean | null {
  if (variant === "v0_strict") return substrMatch(nrmAscii(got), nrmAscii(exp));
  // v1+: unicode-aware
  if (field === "authors" && (variant === "v2_authors" || variant === "v3_fuzztext")) {
    const e = nrmUni(exp);
    if (!e) return null;
    return authorsMatchAware(got, exp);
  }
  const g = nrmUni(got), e = nrmUni(exp);
  const base = substrMatch(g, e);
  if (base === true || base === null) return base;
  if (variant === "v3_fuzztext" && (field === "title" || field === "journal" || field === "publisher")) {
    if (!g) return false;
    return simRatio(g, e) >= 0.88;
  }
  return base;
}

// ---- run ----
type Cell = { hit: number; tot: number };
const acc: Record<string, Record<Variant, Cell>> = {}; // key = `${mode}` and `${mode}|${field}`
const full: Record<string, Record<Variant, { full: number; total: number }>> = {};
let nonLatinAuthors = 0, nonLatinTitles = 0, totalRefs = 0;

function cell(map: Record<string, Record<Variant, Cell>>, key: string): Record<Variant, Cell> {
  return (map[key] ??= Object.fromEntries(VARIANTS.map((v) => [v, { hit: 0, tot: 0 }])) as Record<Variant, Cell>);
}

for (const row of rows) {
  const ctx = createPipelineContext({ outputStyle: "apa7" });
  let res: Awaited<ReturnType<typeof runConvertPipeline>>;
  try {
    res = await runConvertPipeline({ sourceType: "text", content: row.input, outputStyle: "apa7" } as never, ctx, deps);
  } catch {
    continue;
  }
  totalRefs += 1;
  const ref = res.response.references[0] as { fields?: Record<string, unknown> } | undefined;
  const fields = ref?.fields ?? {};
  const mode = row.input_profile as string;
  if (row.expected_fields.authors && nrmAscii(row.expected_fields.authors) === "" && nrmUni(row.expected_fields.authors) !== "")
    nonLatinAuthors += 1;
  if (row.expected_fields.title && nrmAscii(row.expected_fields.title) === "" && nrmUni(row.expected_fields.title) !== "")
    nonLatinTitles += 1;

  const fullByVar: Record<Variant, boolean> = { v0_strict: true, v1_unicode: true, v2_authors: true, v3_fuzztext: true };
  const scoredByVar: Record<Variant, number> = { v0_strict: 0, v1_unicode: 0, v2_authors: 0, v3_fuzztext: 0 };
  for (const f of FIELDS) {
    const exp = row.expected_fields[f];
    if (exp == null || exp === "") continue;
    const got = getField(fields, f);
    for (const v of VARIANTS) {
      const r = scoreField(v, f, got, exp);
      if (r === null) continue; // not scored under this variant
      cell(acc, mode)[v].tot += 1;
      cell(acc, `${mode}|${f}`)[v].tot += 1;
      scoredByVar[v] += 1;
      if (r) {
        cell(acc, mode)[v].hit += 1;
        cell(acc, `${mode}|${f}`)[v].hit += 1;
      } else {
        fullByVar[v] = false;
      }
    }
  }
  const fm = (full[mode] ??= Object.fromEntries(VARIANTS.map((v) => [v, { full: 0, total: 0 }])) as Record<Variant, { full: number; total: number }>);
  for (const v of VARIANTS) {
    fm[v].total += 1;
    if (scoredByVar[v] > 0 && fullByVar[v]) fm[v].full += 1;
  }
}

const out: string[] = [];
const modes = Object.keys(full);
function pct(c: Cell): string {
  return c.tot === 0 ? "  —  " : `${((c.hit / c.tot) * 100).toFixed(1)}%`;
}
out.push("=== field-recovery by mode across scorer variants ===");
out.push("mode".padEnd(20) + VARIANTS.map((v) => v.padStart(13)).join(""));
for (const mode of modes) {
  out.push(mode.padEnd(20) + VARIANTS.map((v) => pct(acc[mode][v]).padStart(13)).join(""));
}
// ALL
const allCells = Object.fromEntries(VARIANTS.map((v) => [v, { hit: 0, tot: 0 }])) as Record<Variant, Cell>;
for (const mode of modes) for (const v of VARIANTS) { allCells[v].hit += acc[mode][v].hit; allCells[v].tot += acc[mode][v].tot; }
out.push("ALL".padEnd(20) + VARIANTS.map((v) => pct(allCells[v]).padStart(13)).join(""));

out.push("\n=== full-recover by mode across scorer variants ===");
out.push("mode".padEnd(20) + VARIANTS.map((v) => v.padStart(13)).join(""));
for (const mode of modes) {
  out.push(mode.padEnd(20) + VARIANTS.map((v) => `${((full[mode][v].full / full[mode][v].total) * 100).toFixed(1)}%`.padStart(13)).join(""));
}

out.push("\n=== authors field recovery by mode across variants ===");
out.push("mode".padEnd(20) + VARIANTS.map((v) => v.padStart(13)).join(""));
for (const mode of modes) {
  const k = `${mode}|authors`;
  out.push(mode.padEnd(20) + VARIANTS.map((v) => pct(acc[k]?.[v] ?? { hit: 0, tot: 0 }).padStart(13)).join(""));
}
out.push("\n=== title field recovery by mode across variants ===");
out.push("mode".padEnd(20) + VARIANTS.map((v) => v.padStart(13)).join(""));
for (const mode of modes) {
  const k = `${mode}|title`;
  out.push(mode.padEnd(20) + VARIANTS.map((v) => pct(acc[k]?.[v] ?? { hit: 0, tot: 0 }).padStart(13)).join(""));
}

out.push(`\nnon-Latin expected authors (strict→empty, unicode→nonempty): ${nonLatinAuthors}/${totalRefs}`);
out.push(`non-Latin expected titles: ${nonLatinTitles}/${totalRefs}`);

const report = out.join("\n");
process.stdout.write(report + "\n");
writeFileSync("../tmp/eval-decompose.txt", report, "utf8");
process.exit(0);
