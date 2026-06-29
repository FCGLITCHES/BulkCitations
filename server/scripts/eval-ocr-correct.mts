/**
 * Benchmark the engine OCR corrector on the real OCR'd inputs.
 *
 * For every English, word-bearing field, checks whether the CLEAN expected value is recoverable
 * (present as words) in the input BEFORE vs AFTER OCR correction. Reports field-level and
 * word-level recovery + any fields the corrector BROKE (precision damage).
 *
 *   cd server && npx tsx scripts/eval-ocr-correct.mts
 */
import { readFileSync } from 'node:fs';
import { correctOcrText, setOcrDomain } from '../src/engine/ingestion/ocrCorrect.js';

const POOL = new URL('../../datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl', import.meta.url);
const CORRECTABLE = ['title', 'journal', 'conferenceTitle', 'bookTitle', 'publisher', 'institution', 'siteName'];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const allRefs = readFileSync(POOL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// Held-out: learn the domain vocabulary from 80% of refs, measure recovery on the other 20%, so the
// domain dict's gain is honest GENERALIZATION (not the corrector knowing the test refs' own terms).
const split = Math.floor(allRefs.length * 0.8);
const heldoutDomain = new Set<string>();
for (const r of allRefs.slice(0, split)) {
  const ef = r.expected_fields ?? {};
  for (const f of CORRECTABLE) {
    const v = ef[f];
    if (typeof v === 'string') for (const w of v.match(/[A-Za-z]+/g) ?? []) if (w.length >= 4) heldoutDomain.add(w.toLowerCase());
  }
}
'springer elsevier wiley routledge palgrave macmillan pearson emerald hindawi frontiers blackwell brill bentham apress avestia'.split(' ').forEach((w) => heldoutDomain.add(w));
setOcrDomain(process.env.NO_DOMAIN === '1' ? [] : [...heldoutDomain]);
const refs = allRefs.slice(split);

let fTotal = 0, fBase = 0, fCorr = 0, fBroke = 0;
let wTotal = 0, wBase = 0, wCorr = 0;
let refsTouched = 0, fieldsChangedByCorrector = 0;
const fixed: string[] = [];
const broken: string[] = [];

for (const r of refs) {
  const input: string = r.input ?? '';
  const corrected = correctOcrText(input);
  if (corrected.changed) refsTouched += 1;
  const ni = ` ${norm(input)} `, nc = ` ${norm(corrected.text)} `;
  const ef = r.expected_fields ?? {};
  for (const key of CORRECTABLE) {
    const v = ef[key];
    if (typeof v !== 'string' || !v.trim()) continue;
    const nv = norm(v);
    if (!/[a-z]/.test(nv) || !v.split('').every((c) => c.charCodeAt(0) < 128)) continue; // english-ascii only
    fTotal += 1;
    const base = ni.includes(` ${nv} `), corr = nc.includes(` ${nv} `);
    if (base) fBase += 1;
    if (corr) fCorr += 1;
    if (base && !corr) { fBroke += 1; if (broken.length < 12) broken.push(`${key}: "${v.slice(0, 50)}"`); }
    if (!base && corr) { fieldsChangedByCorrector += 1; if (fixed.length < 12) fixed.push(`${key}: "${v.slice(0, 48)}"`); }
    for (const w of nv.split(' ')) {
      if (w.length < 4) continue;
      wTotal += 1;
      if (ni.includes(` ${w} `)) wBase += 1;
      if (nc.includes(` ${w} `)) wCorr += 1;
    }
  }
}

const pct = (a: number, b: number) => (b ? `${(a / b * 100).toFixed(1)}%` : 'n/a');
console.log('='.repeat(64));
console.log(`refs=${refs.length} | english word-bearing field values=${fTotal} | field-words=${wTotal}`);
console.log(`refs the corrector changed: ${refsTouched} (${pct(refsTouched, refs.length)})`);
console.log('-'.repeat(64));
console.log('FIELD-VALUE RECOVERY (whole value present as words):');
console.log(`   before correction: ${fBase}/${fTotal} = ${pct(fBase, fTotal)}`);
console.log(`   after  correction: ${fCorr}/${fTotal} = ${pct(fCorr, fTotal)}`);
console.log(`   DELTA: +${fCorr - fBase} fields  (+${pct(fCorr - fBase, fTotal)})`);
console.log(`   fields BROKEN by corrector (was present, now absent): ${fBroke}  <- precision damage`);
console.log('WORD-LEVEL RECOVERY (field-words present):');
console.log(`   before: ${pct(wBase, wTotal)} | after: ${pct(wCorr, wTotal)} | DELTA: +${wCorr - wBase} words (+${pct(wCorr - wBase, wTotal)})`);
console.log('-'.repeat(64));
console.log('SAMPLE NEWLY-RECOVERED FIELDS:');
for (const f of fixed) console.log('   ' + f);
console.log('SAMPLE BROKEN FIELDS (corrector over-stepped):');
for (const f of broken) console.log('   ' + f);
console.log('='.repeat(64));
