// Verifies Phase 8 enrichment OFFLINE ($0, zero network) by running every gold row
// twice — enrichment OFF (production baseline) vs ON (against the gold-derived
// provider fixture) — and reporting the recovery delta per input mode, plus an
// over-enrichment precision guard and a hard network guard.
import { readFileSync } from 'node:fs';

process.env.BULKREFERENCES_ISOLATED_RUNTIME = 'true';
process.env.ML_PHASE4_MODE = 'heuristic'; // prod-realistic: enrichment overlays heuristic extraction

// --- network guard: any EXTERNAL fetch (a costly/rate-limited provider API) is a
// failure. Localhost calls (the ML health poll) are local + free and excluded —
// the whole point of the fixture is to avoid live Crossref/OpenAlex traffic.
let externalFetches = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  const url = String((args[0] as { url?: string } | undefined)?.url ?? args[0]);
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) externalFetches += 1;
  return (realFetch as (...a: unknown[]) => unknown)(...args);
}) as typeof fetch;

const { createPipelineDependencies } = await import('../src/pipeline/dependencies.js');
const { createPipelineContext, runConvertPipeline } = await import('../src/pipeline/orchestrator.js');
const { Phase8Enrich } = await import('../src/engine/phases/phase8Enrich.js');
const { loadFixtureProviders } = await import('../test/helpers/fixtureProviders.js');

const rows = readFileSync('../datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl', 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

const fp = loadFixtureProviders();
const offDeps = createPipelineDependencies();
const onDeps = createPipelineDependencies({
  enrichmentPhase: new Phase8Enrich(fp.crossref, fp.openalex, fp.semanticScholar),
});

const FIELDS = ['authors', 'title', 'journal', 'year', 'doi', 'volume', 'issue', 'pages', 'publisher'];
const FUZZY = new Set(['title', 'journal', 'publisher']);

function uni(s: string): string {
  return s.normalize('NFKD').replace(/\p{Mark}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
function flat(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object'
    ? (x as Record<string, string>).literal ?? [(x as Record<string, string>).family, (x as Record<string, string>).given].filter(Boolean).join(' ')
    : x)).join(' ');
  return String(v ?? '');
}
function lev(a: string, b: string): number {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let p = Array.from({ length: n + 1 }, (_, j) => j); let c = new Array(n + 1);
  for (let i = 1; i <= m; i++) { c[0] = i; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [p, c] = [c, p]; }
  return p[n];
}
function getField(fields: Record<string, unknown>, name: string): unknown {
  const f = fields?.[name];
  if (f == null) return null;
  if (typeof f === 'object' && !Array.isArray(f) && 'value' in (f as object)) return (f as Record<string, unknown>).value;
  return f;
}
function authorsOk(got: unknown, exp: unknown): boolean {
  const ea = (Array.isArray(exp) ? exp : [exp]).map((e) => String(e));
  const ga = Array.isArray(got) ? got : got == null ? [] : [got];
  if (!ga.length) return false;
  return ea.every((e) => {
    const efam = uni(String(e).split(',')[0] ?? '');
    return ga.some((g) => {
      const gn = g && typeof g === 'object' ? (g as Record<string, string>).family ?? '' : String(g).split(',')[0];
      const gfam = uni(gn);
      return gfam && efam && (gfam === efam || (gfam.length > 3 && (gfam.includes(efam) || efam.includes(gfam))));
    });
  });
}
function match(field: string, got: unknown, exp: unknown): boolean | null {
  if (exp == null || exp === '') return null;
  if (field === 'authors') return authorsOk(got, exp);
  const g = uni(flat(got)), e = uni(flat(exp));
  if (!e) return null;
  if (!g) return false;
  if (g === e || (e.length > 4 && (g.includes(e) || e.includes(g)))) return true;
  if (FUZZY.has(field)) return 1 - lev(g, e) / Math.max(g.length, e.length) >= 0.88;
  return false;
}

type Stat = { refs: number; offFull: number; onFull: number; field: Record<string, { off: number; on: number; tot: number }> };
const byMode: Record<string, Stat> = {};
let regressions = 0; // fields correct OFF but wrong ON (over-enrichment)
let enrichedRows = 0;

async function runRow(row: Record<string, unknown>, on: boolean): Promise<Record<string, unknown>> {
  const ctx = createPipelineContext(on
    ? ({ outputStyle: 'apa7', options: { parseProfile: 'pro_overlay_enrich', enrich: true, extractionMl: 'off', authorDisambiguationMl: 'off', typeClassificationMl: 'off', styleDetectionMl: 'off' } } as never)
    : ({ outputStyle: 'apa7' } as never));
  const res = await runConvertPipeline(
    { sourceType: 'text', content: row.input, outputStyle: 'apa7' } as never, ctx, on ? onDeps : offDeps,
  );
  const ref = res.response.references[0] as { fields?: Record<string, unknown> } | undefined;
  return ref?.fields ?? {};
}

for (const row of rows) {
  const mode = row.input_profile as string;
  const m = (byMode[mode] ??= { refs: 0, offFull: 0, onFull: 0, field: {} });
  m.refs += 1;
  let offFields: Record<string, unknown> = {};
  let onFields: Record<string, unknown> = {};
  try { offFields = await runRow(row, false); onFields = await runRow(row, true); } catch { continue; }
  let offAll = true, onAll = true, scored = 0, rowImproved = false;
  for (const f of FIELDS) {
    const exp = row.expected_fields[f];
    const off = match(f, getField(offFields, f), exp);
    const on = match(f, getField(onFields, f), exp);
    if (off === null) continue;
    scored += 1;
    const fc = (m.field[f] ??= { off: 0, on: 0, tot: 0 }); fc.tot += 1;
    if (off) fc.off += 1; else offAll = false;
    if (on) fc.on += 1; else onAll = false;
    if (off && !on) regressions += 1;
    if (!off && on) rowImproved = true;
  }
  if (rowImproved) enrichedRows += 1;
  if (scored > 0 && offAll) m.offFull += 1;
  if (scored > 0 && onAll) m.onFull += 1;
}

process.stdout.write(`\nfixture records: ${fp.size} | fixture provider lookups: ${fp.calls.count} | rows with enriched fields: ${enrichedRows}\n`);
process.stdout.write(`mode | refs | full-recover OFF -> ON\n`);
let tOff = 0, tOn = 0, tRefs = 0;
for (const [mode, m] of Object.entries(byMode)) {
  tOff += m.offFull; tOn += m.onFull; tRefs += m.refs;
  process.stdout.write(`${mode.padEnd(20)} | ${String(m.refs).padStart(4)} | ${((m.offFull / m.refs) * 100).toFixed(1)}% -> ${((m.onFull / m.refs) * 100).toFixed(1)}%  (+${(((m.onFull - m.offFull) / m.refs) * 100).toFixed(1)})\n`);
}
process.stdout.write(`${'ALL'.padEnd(20)} | ${String(tRefs).padStart(4)} | ${((tOff / tRefs) * 100).toFixed(1)}% -> ${((tOn / tRefs) * 100).toFixed(1)}%  (+${(((tOn - tOff) / tRefs) * 100).toFixed(1)})\n`);
process.stdout.write(`\nmode | FIELD-recovery OFF -> ON (the 90% target metric)\n`);
let fOffSum = 0, fOnSum = 0, fTotSum = 0;
for (const [mode, m] of Object.entries(byMode)) {
  let off = 0, on = 0, tot = 0;
  for (const c of Object.values(m.field)) { off += c.off; on += c.on; tot += c.tot; }
  fOffSum += off; fOnSum += on; fTotSum += tot;
  process.stdout.write(`${mode.padEnd(20)} | ${((off / tot) * 100).toFixed(1)}% -> ${((on / tot) * 100).toFixed(1)}%  (+${(((on - off) / tot) * 100).toFixed(1)})\n`);
}
process.stdout.write(`${'ALL'.padEnd(20)} | ${((fOffSum / fTotSum) * 100).toFixed(1)}% -> ${((fOnSum / fTotSum) * 100).toFixed(1)}%  (+${(((fOnSum - fOffSum) / fTotSum) * 100).toFixed(1)})\n`);
process.stdout.write(`\nper-field recovery OFF -> ON (ALL modes):\n`);
const agg: Record<string, { off: number; on: number; tot: number }> = {};
for (const m of Object.values(byMode)) for (const [f, c] of Object.entries(m.field)) { const a = (agg[f] ??= { off: 0, on: 0, tot: 0 }); a.off += c.off; a.on += c.on; a.tot += c.tot; }
for (const f of FIELDS) { const a = agg[f]; if (a) process.stdout.write(`  ${f.padEnd(10)} ${((a.off / a.tot) * 100).toFixed(0)}% -> ${((a.on / a.tot) * 100).toFixed(0)}%\n`); }
process.stdout.write(`\nover-enrichment regressions (correct OFF, wrong ON): ${regressions}\n`);
process.stdout.write(`NETWORK GUARD: ${externalFetches} external provider fetches (MUST be 0; localhost ML excluded)\n`);
process.exit(0);
