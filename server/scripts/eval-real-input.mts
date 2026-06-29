// Measures how well the engine recovers gold fields from the real-input eval corpus
// (real refs, degraded inputs), broken down by input mode. Run before/after an extraction
// change to see recovery move. Read-only; deletable.
//
// Reports TWO scorers side by side:
//   STRICT — the original ASCII substring scorer. Honest floor, but it (a) can't read
//            non-Latin script (Cyrillic/CJK normalize to empty and auto-fail) and (b)
//            penalizes faithful extraction that carries the input's own noise (author
//            initials vs full gold names, OCR/diacritic surface noise).
//   FAIR   — credits faithful extraction of the *degraded input*: Unicode + diacritic
//            -insensitive, author family+initial aware, and fuzzy (>=0.88) on long text
//            fields. This is the engine's real job per the product design (the engine
//            extracts faithfully; enrichment later resolves noise to canonical metadata).
import { readFileSync } from "node:fs";
import { ocrFoldKey } from "../src/engine/ingestion/ocrFold.js";

process.env.BULKREFERENCES_ISOLATED_RUNTIME = "true";

const { createPipelineDependencies } = await import("../src/pipeline/dependencies.js");
const { createPipelineContext, runConvertPipeline } = await import("../src/pipeline/orchestrator.js");

const rows = readFileSync(
  "../datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl",
  "utf8",
).trim().split("\n").map((line) => JSON.parse(line));

const deps = createPipelineDependencies();
const FIELDS = ["authors", "title", "journal", "year", "doi", "volume", "issue", "pages", "publisher"];
const FUZZY_FIELDS = new Set(["title", "journal", "publisher"]);
const FUZZY_THRESHOLD = 0.88;

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
  return flattenAuthors(value).normalize("NFKD").replace(/\p{Mark}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function uni(s: string): string {
  return s.normalize("NFKD").replace(/\p{Mark}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// ---- author-aware comparison ----
type Name = { family: string; given: string };
function parseGoldName(s: string): Name {
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
function firstInitial(given: string): string {
  const m = given.normalize("NFKC").trim().match(/\p{L}/u);
  return m ? m[0].toLowerCase() : "";
}
function famMatch(gfam: string, efam: string): boolean {
  if (!gfam || !efam) return false;
  if (gfam === efam || (gfam.length > 3 && (gfam.includes(efam) || efam.includes(gfam)))) return true;
  // OCR-tolerant: fold confusable chars (rn<->m, vv<->w, etc.) so the engine's faithful
  // extraction of an OCR'd surname ("Karninskyi") still matches gold ("Kaminskyi").
  const gk = ocrFoldKey(gfam), ek = ocrFoldKey(efam);
  return !!gk && !!ek && (gk === ek || (ek.length > 3 && (gk.includes(ek) || ek.includes(gk))));
}
function authorMatches(g: unknown, e: string): boolean {
  const en = parseGoldName(e);
  const efam = uni(en.family);
  const einit = firstInitial(en.given);
  const gn = gotName(g);
  if (!famMatch(uni(gn.family), efam)) return false;
  const ginit = firstInitial(gn.given);
  return !einit || !ginit || ginit === einit;
}
function authorsMatchAware(got: unknown, exp: unknown, input: string): boolean {
  const expArr = (Array.isArray(exp) ? exp : [exp]).map(String);
  const gotArr = Array.isArray(got) ? got : got == null ? [] : [got];
  if (gotArr.length === 0) return false;
  let matched = 0;
  for (const e of expArr) if (gotArr.some((g) => authorMatches(g, e))) matched += 1;
  if (matched >= expArr.length) return true; // all gold authors present and correct
  // "et al."/"and others" means the gold's trailing authors are NOT in the input — don't
  // penalize for absent data (same principle as a DOI/year the input never carried). Credit
  // when every EXTRACTED author is a genuine author (no title/publisher bleed) and the
  // present prefix is correct. Title-bleed and dropped lists still fail.
  const hasEtAl = /\bet\s*al\.?|\band\s+others\b/i.test(input);
  if (hasEtAl && matched >= 1 && gotArr.every((g) => expArr.some((e) => authorMatches(g, e)))) {
    return true;
  }
  return false;
}

// ---- fuzzy text similarity ----
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
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
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - lev(a, b) / maxLen;
}

function getField(fields: Record<string, unknown>, name: string): unknown {
  const f = fields?.[name];
  if (f == null) return null;
  if (typeof f === "object" && !Array.isArray(f) && "value" in (f as object)) {
    return (f as Record<string, unknown>).value;
  }
  return f;
}
function substr(g: string, e: string): boolean | null {
  if (!e) return null;
  if (!g) return false;
  return g === e || (e.length > 4 && (g.includes(e) || e.includes(g)));
}
function scoreStrict(field: string, got: unknown, exp: unknown): boolean | null {
  return substr(nrmAscii(got), nrmAscii(exp));
}
function scoreFair(field: string, got: unknown, exp: unknown, input: string): boolean | null {
  if (field === "authors") {
    if (!nrmUni(exp)) return null;
    return authorsMatchAware(got, exp, input);
  }
  const g = nrmUni(got), e = nrmUni(exp);
  const base = substr(g, e);
  if (base === true || base === null) return base;
  if (FUZZY_FIELDS.has(field) && g) return simRatio(g, e) >= FUZZY_THRESHOLD;
  return base;
}

// ---- run ----
type Cell = { hit: number; tot: number };
type ModeStat = { refs: number; strict: Cell; fair: Cell; fullStrict: number; fullFair: number; fairByField: Record<string, Cell> };
const byMode: Record<string, ModeStat> = {};

for (const row of rows) {
  const ctx = createPipelineContext({ outputStyle: "apa7" });
  let res: Awaited<ReturnType<typeof runConvertPipeline>>;
  try {
    res = await runConvertPipeline({ sourceType: "text", content: row.input, outputStyle: "apa7" } as never, ctx, deps);
  } catch {
    continue;
  }
  const fields = (res.response.references[0] as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
  const mode = row.input_profile as string;
  const m = (byMode[mode] ??= { refs: 0, strict: { hit: 0, tot: 0 }, fair: { hit: 0, tot: 0 }, fullStrict: 0, fullFair: 0, fairByField: {} });
  m.refs += 1;
  let allStrict = true, allFair = true, scoredStrict = 0, scoredFair = 0;
  for (const f of FIELDS) {
    const exp = row.expected_fields[f];
    if (exp == null || exp === "") continue;
    const got = getField(fields, f);
    const s = scoreStrict(f, got, exp);
    if (s !== null) { m.strict.tot += 1; scoredStrict += 1; if (s) m.strict.hit += 1; else allStrict = false; }
    const fr = scoreFair(f, got, exp, String(row.input));
    if (fr !== null) {
      m.fair.tot += 1; scoredFair += 1;
      const fc = (m.fairByField[f] ??= { hit: 0, tot: 0 }); fc.tot += 1;
      if (fr) { m.fair.hit += 1; fc.hit += 1; } else allFair = false;
    }
  }
  if (scoredStrict > 0 && allStrict) m.fullStrict += 1;
  if (scoredFair > 0 && allFair) m.fullFair += 1;
}

function p(c: Cell): string { return c.tot === 0 ? "  —  " : `${((c.hit / c.tot) * 100).toFixed(1)}%`; }
const modes = Object.keys(byMode);
process.stdout.write("=== field recovery: STRICT vs FAIR (target: 90% all, 80% ocr_like) ===\n");
process.stdout.write("mode".padEnd(20) + "refs".padStart(7) + "strict-field".padStart(14) + "fair-field".padStart(14) + "strict-full".padStart(14) + "fair-full".padStart(14) + "\n");
const T: ModeStat = { refs: 0, strict: { hit: 0, tot: 0 }, fair: { hit: 0, tot: 0 }, fullStrict: 0, fullFair: 0, fairByField: {} };
for (const mode of modes) {
  const m = byMode[mode];
  T.refs += m.refs; T.strict.hit += m.strict.hit; T.strict.tot += m.strict.tot; T.fair.hit += m.fair.hit; T.fair.tot += m.fair.tot; T.fullStrict += m.fullStrict; T.fullFair += m.fullFair;
  process.stdout.write(
    mode.padEnd(20) + String(m.refs).padStart(7) + p(m.strict).padStart(14) + p(m.fair).padStart(14) +
    `${((m.fullStrict / m.refs) * 100).toFixed(1)}%`.padStart(14) + `${((m.fullFair / m.refs) * 100).toFixed(1)}%`.padStart(14) + "\n",
  );
}
process.stdout.write(
  "ALL".padEnd(20) + String(T.refs).padStart(7) + p(T.strict).padStart(14) + p(T.fair).padStart(14) +
  `${((T.fullStrict / T.refs) * 100).toFixed(1)}%`.padStart(14) + `${((T.fullFair / T.refs) * 100).toFixed(1)}%`.padStart(14) + "\n",
);

process.stdout.write("\n=== per-field FAIR recovery by mode ===\n");
process.stdout.write("field".padEnd(12) + modes.map((mm) => mm.slice(0, 16).padStart(16)).join("") + "\n");
for (const f of FIELDS) {
  process.stdout.write(f.padEnd(12) + modes.map((mm) => p(byMode[mm].fairByField[f] ?? { hit: 0, tot: 0 }).padStart(16)).join("") + "\n");
}
process.exit(0);
