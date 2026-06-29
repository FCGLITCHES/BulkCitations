// Dumps FAIR-scored failures for specific fields (authors, issue) with got/exp/input,
// grouped by mode, so we can see the real extraction bugs. Read-only/deletable.
import { readFileSync, writeFileSync } from "node:fs";
process.env.BULKREFERENCES_ISOLATED_RUNTIME = "true";
const { createPipelineDependencies } = await import("../src/pipeline/dependencies.js");
const { createPipelineContext, runConvertPipeline } = await import("../src/pipeline/orchestrator.js");

const rows = readFileSync("../datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl", "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));
const deps = createPipelineDependencies();
const TARGET = (process.argv[2] ?? "authors,issue").split(",");

function uni(s: string): string {
  return s.normalize("NFKD").replace(/\p{Mark}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function parseGold(s: string): { family: string; given: string } {
  const c = s.indexOf(","); if (c >= 0) return { family: s.slice(0, c).trim(), given: s.slice(c + 1).trim() };
  const p = s.trim().split(/\s+/); return p.length === 1 ? { family: p[0] ?? "", given: "" } : { family: p[p.length - 1] ?? "", given: p.slice(0, -1).join(" ") };
}
function gotName(x: unknown): { family: string; given: string } {
  if (x && typeof x === "object") { const o = x as Record<string, string>; if (o.literal) return parseGold(o.literal); return { family: o.family ?? "", given: o.given ?? o.initials ?? "" }; }
  return parseGold(String(x ?? ""));
}
function fi(g: string): string { const m = g.normalize("NFKC").trim().match(/\p{L}/u); return m ? m[0].toLowerCase() : ""; }
function authorsOk(got: unknown, exp: unknown): boolean {
  const ea = Array.isArray(exp) ? exp : [exp]; const ga = Array.isArray(got) ? got : got == null ? [] : [got];
  if (!ga.length) return false;
  let matched = 0;
  for (const e of ea) {
    const en = parseGold(String(e)); const efam = uni(en.family); const einit = fi(en.given);
    if (ga.some((g) => { const gn = gotName(g); const gf = uni(gn.family); if (!gf || !efam) return false; const fo = gf === efam || (gf.length > 3 && (gf.includes(efam) || efam.includes(gf))); if (!fo) return false; const gi = fi(gn.given); return !einit || !gi || gi === einit; })) matched += 1;
  }
  return matched >= ea.length;
}
function getField(fields: Record<string, unknown>, n: string): unknown {
  const f = fields?.[n]; if (f == null) return null; if (typeof f === "object" && !Array.isArray(f) && "value" in (f as object)) return (f as Record<string, unknown>).value; return f;
}
function scalarOk(got: unknown, exp: unknown): boolean {
  const g = uni(String(got ?? "")), e = uni(String(exp ?? "")); if (!e) return true; if (!g) return false; return g === e || (e.length > 1 && (g.includes(e) || e.includes(g)));
}

const out: string[] = [];
const counts: Record<string, number> = {};
for (const row of rows) {
  const mode = row.input_profile as string;
  const ctx = createPipelineContext({ outputStyle: "apa7" });
  let res: Awaited<ReturnType<typeof runConvertPipeline>>;
  try { res = await runConvertPipeline({ sourceType: "text", content: row.input, outputStyle: "apa7" } as never, ctx, deps); } catch { continue; }
  const fields = (res.response.references[0] as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
  for (const f of TARGET) {
    const exp = row.expected_fields[f]; if (exp == null || exp === "") continue;
    const got = getField(fields, f);
    const ok = f === "authors" ? authorsOk(got, exp) : scalarOk(got, exp);
    if (!ok) {
      const k = `${mode}/${f}`; counts[k] = (counts[k] ?? 0) + 1;
      if ((counts[k] ?? 0) <= 8) out.push(`[${k}] exp=${JSON.stringify(exp)} got=${JSON.stringify(got)}\n   in: ${String(row.input).replace(/\n/g, "\\n").slice(0, 190)}`);
    }
  }
}
writeFileSync("../tmp/field-fails.txt", Object.entries(counts).sort((a, z) => z[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n\n" + out.join("\n\n"), "utf8");
process.stdout.write("counts:\n" + Object.entries(counts).sort((a, z) => z[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\nWrote samples to tmp/field-fails.txt\n");
process.exit(0);
