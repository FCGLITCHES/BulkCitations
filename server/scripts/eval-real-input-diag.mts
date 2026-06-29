// Diagnostic version of eval-real-input: per-field, per-mode recovery + failure samples.
// Read-only; deletable. Tells us WHICH fields fail in WHICH modes so we know what to fix.
import { readFileSync, writeFileSync } from "node:fs";

process.env.BULKREFERENCES_ISOLATED_RUNTIME = "true";

const { createPipelineDependencies } = await import("../src/pipeline/dependencies.js");
const { createPipelineContext, runConvertPipeline } = await import("../src/pipeline/orchestrator.js");

const rows = readFileSync(
  "../datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl",
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const deps = createPipelineDependencies();
const FIELDS = ["authors", "title", "journal", "year", "doi", "volume", "issue", "pages", "publisher"];

function nrm(value: unknown): string {
  let v: unknown = value;
  if (Array.isArray(v)) {
    v = v
      .map((x) =>
        x && typeof x === "object"
          ? (x as Record<string, string>).literal ??
            [(x as Record<string, string>).family, (x as Record<string, string>).given]
              .filter(Boolean)
              .join(" ")
          : x,
      )
      .join(" ");
  }
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getField(fields: Record<string, unknown>, name: string): unknown {
  const f = fields?.[name];
  if (f == null) return null;
  if (typeof f === "object" && !Array.isArray(f) && "value" in (f as object)) {
    return (f as Record<string, unknown>).value;
  }
  return f;
}
function match(got: unknown, exp: unknown): boolean | null {
  const g = nrm(got);
  const e = nrm(exp);
  if (!e) return null;
  if (!g) return false;
  return g === e || (e.length > 4 && (g.includes(e) || e.includes(g)));
}

type FieldStat = { hit: number; tot: number; missing: number; wrong: number };
type ModeStat = {
  total: number;
  hit: number;
  tot: number;
  full: number;
  byField: Record<string, FieldStat>;
};
const byMode: Record<string, ModeStat> = {};
const samples: Array<{ mode: string; field: string; kind: string; exp: string; got: string; input: string }> = [];
const SAMPLES_PER_BUCKET = 6;
const sampleCount: Record<string, number> = {};

let idx = 0;
for (const row of rows) {
  const ctx = createPipelineContext({ outputStyle: "apa7" });
  let res: Awaited<ReturnType<typeof runConvertPipeline>>;
  try {
    res = await runConvertPipeline(
      { sourceType: "text", content: row.input, outputStyle: "apa7" } as never,
      ctx,
      deps,
    );
  } catch {
    continue;
  }
  const ref = res.response.references[0] as { fields?: Record<string, unknown> } | undefined;
  const fields = ref?.fields ?? {};
  const mode = row.input_profile as string;
  const m = (byMode[mode] ??= { total: 0, hit: 0, tot: 0, full: 0, byField: {} });
  m.total += 1;
  let allOk = true;
  let scored = 0;
  for (const f of FIELDS) {
    const exp = row.expected_fields[f];
    if (exp == null || exp === "") continue;
    m.tot += 1;
    scored += 1;
    const fs = (m.byField[f] ??= { hit: 0, tot: 0, missing: 0, wrong: 0 });
    fs.tot += 1;
    const got = getField(fields, f);
    if (match(got, exp)) {
      m.hit += 1;
      fs.hit += 1;
    } else {
      allOk = false;
      const gotStr = nrm(got);
      const kind = gotStr === "" ? "missing" : "wrong";
      if (kind === "missing") fs.missing += 1;
      else fs.wrong += 1;
      const bucket = `${mode}|${f}|${kind}`;
      sampleCount[bucket] = (sampleCount[bucket] ?? 0) + 1;
      if (sampleCount[bucket] <= SAMPLES_PER_BUCKET) {
        samples.push({
          mode,
          field: f,
          kind,
          exp: String(Array.isArray(exp) ? JSON.stringify(exp) : exp).slice(0, 120),
          got: String(JSON.stringify(got)).slice(0, 120),
          input: String(row.input).replace(/\n/g, "\\n").slice(0, 200),
        });
      }
    }
  }
  if (scored > 0 && allOk) m.full += 1;
  idx += 1;
}

// Summary table
const lines: string[] = [];
lines.push("mode | refs | field-recovery | full-recover");
const T = { total: 0, hit: 0, tot: 0, full: 0 };
for (const [mode, m] of Object.entries(byMode)) {
  T.total += m.total;
  T.hit += m.hit;
  T.tot += m.tot;
  T.full += m.full;
  lines.push(
    `${mode.padEnd(20)} | ${String(m.total).padStart(4)} | ${((m.hit / m.tot) * 100).toFixed(1)}% | ${((m.full / m.total) * 100).toFixed(1)}%`,
  );
}
lines.push(
  `${"ALL".padEnd(20)} | ${String(T.total).padStart(4)} | ${((T.hit / T.tot) * 100).toFixed(1)}% | ${((T.full / T.total) * 100).toFixed(1)}%`,
);

// Per-field per-mode breakdown
lines.push("\n=== per-field recovery by mode (recovery% [miss/wrong of failures]) ===");
const header = "field".padEnd(14) + Object.keys(byMode).map((mname) => mname.slice(0, 16).padStart(18)).join("");
lines.push(header);
for (const f of FIELDS) {
  let rowStr = f.padEnd(14);
  for (const mode of Object.keys(byMode)) {
    const fs = byMode[mode].byField[f];
    if (!fs || fs.tot === 0) {
      rowStr += "—".padStart(18);
      continue;
    }
    const pct = ((fs.hit / fs.tot) * 100).toFixed(0);
    const cell = `${pct}%(${fs.missing}m/${fs.wrong}w)`;
    rowStr += cell.padStart(18);
  }
  lines.push(rowStr);
}

// Biggest failure buckets (absolute miss count)
lines.push("\n=== biggest failure buckets (mode/field: failures, missing, wrong) ===");
const buckets: Array<{ key: string; fails: number; missing: number; wrong: number }> = [];
for (const [mode, m] of Object.entries(byMode)) {
  for (const [f, fs] of Object.entries(m.byField)) {
    const fails = fs.missing + fs.wrong;
    if (fails > 0) buckets.push({ key: `${mode}/${f}`, fails, missing: fs.missing, wrong: fs.wrong });
  }
}
buckets.sort((a, b) => b.fails - a.fails);
for (const b of buckets.slice(0, 25)) {
  lines.push(`  ${b.key.padEnd(34)} fails=${String(b.fails).padStart(3)}  missing=${String(b.missing).padStart(3)}  wrong=${String(b.wrong).padStart(3)}`);
}

const report = lines.join("\n");
process.stdout.write(report + "\n");

// Dump failure samples to a file for inspection
const sampleLines = samples.map(
  (s) => `[${s.mode}/${s.field}/${s.kind}]\n  exp: ${s.exp}\n  got: ${s.got}\n  in : ${s.input}`,
);
writeFileSync("../tmp/eval-failure-samples.txt", sampleLines.join("\n\n"), "utf8");
writeFileSync("../tmp/eval-diag-report.txt", report, "utf8");
process.stdout.write(`\nWrote ${samples.length} failure samples to tmp/eval-failure-samples.txt\n`);
process.exit(0);
