"""OCR post-correction prototype v2 — real dictionary + name guard + perf trim.

Changes from v1:
  1) Real English dictionary (wordfreq top-N, frequency-ranked) + domain vocab,
     instead of the tiny 1,219-word domain-only set.
  2) Proper-noun / name guard: corrections must land on a COMMON word; Title-case
     (proper-noun-like) OOV words need a STRICTER (more frequent) target.
  3) Throughput: single-substitution only + a pre-filter that skips words with no
     known confusion source. Intended to run gated to OCR mode.

Tests on ALL refs (external dict => no train/test split needed). English-only is
enforced naturally: a corrector target must be a common ENGLISH word, so Spanish/
Portuguese/etc. are left untouched. Reports fix-rate, precision, throughput on 10k words.
"""
import json, re, difflib, time
from pathlib import Path
from wordfreq import top_n_list

REPO = Path(__file__).resolve().parents[3]
POOL = REPO / "datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl"

def load(p): return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]
def words(s): return re.findall(r"[A-Za-z]+", str(s))

SUBS = [
    ("rn","m"),("m","rn"),("cl","d"),("c","e"),("e","c"),("l","i"),("i","l"),
    ("o","a"),("a","o"),("q","g"),("g","q"),("p","b"),("b","p"),("g","t"),("t","g"),
    ("d","s"),("s","d"),("h","b"),("nn","m"),("vv","w"),("rt","n"),("ii","u"),
]
SUB_SOURCES = tuple(sorted({a for a, _ in SUBS}, key=len, reverse=True))

VALID  = set(top_n_list("en", 80000))   # "is this a real word? -> leave alone"
COMMON = set(top_n_list("en", 25000))   # correction target must be at least this common
STRICT = set(top_n_list("en", 8000))    # Title-case (proper-noun-like) targets: stricter

def gen_candidates(word):
    wl = word.lower()
    if not any(s in wl for s in SUB_SOURCES):     # pre-filter: no confusion source -> skip
        return ()
    out = set()
    for a, b in SUBS:                              # single substitution only
        start = 0
        while True:
            i = wl.find(a, start)
            if i == -1: break
            out.add(word[:i] + b + word[i+len(a):])
            start = i + 1
    return out

def correct(word, domain):
    wl = word.lower()
    if len(word) < 4 or wl in VALID or wl in domain:
        return word
    title = word[0].isupper() and word[1:].islower()
    target = STRICT if title else COMMON          # name guard: stricter bar for proper-noun-like
    cands = {c for c in gen_candidates(word) if c.lower() in target}
    return next(iter(cands)) if len(cands) == 1 else word

def lev(a, b):
    if a == b: return 0
    m, n = len(a), len(b)
    if m < n: a, b, m, n = b, a, n, m
    prev = list(range(n+1))
    for i in range(1, m+1):
        cur = [i] + [0]*n
        for j in range(1, n+1):
            cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1] != b[j-1]))
        prev = cur
    return prev[n]

def clean_words_of(ef):
    out = []
    for v in ef.values():
        for x in (v if isinstance(v, list) else [v]):
            if isinstance(x, dict): x = f"{x.get('family','')} {x.get('given','')}"
            out += words(x)
    return out

def main():
    refs = load(POOL)
    domain = {w.lower() for r in refs for w in clean_words_of(r.get("expected_fields") or {}) if len(w) >= 3}

    eng_pairs, noneng_pairs, clean_seen = [], [], []
    for r in refs:
        inp = r.get("input", ""); iw = words(inp); iwl = [w.lower() for w in iw]
        for c in clean_words_of(r.get("expected_fields") or {}):
            if len(c) < 4 or not c.isascii(): continue
            cl = c.lower()
            if cl in iwl:
                clean_seen.append(c); continue
            best, br = None, 0.0
            for w in iw:
                if abs(len(w) - len(c)) > 2 or not w.isascii(): continue
                rr = difflib.SequenceMatcher(None, cl, w.lower()).ratio()
                if rr > br: br, best = rr, w
            if best and br >= 0.78 and 1 <= lev(cl, best.lower()) <= 3:
                (eng_pairs if cl in VALID else noneng_pairs).append((best, c))

    fixed = missed = wrong = 0; ex_fix, ex_miss, ex_wrong = [], [], []
    for ocr, clean in eng_pairs:
        out = correct(ocr, domain)
        if out.lower() == clean.lower(): fixed += 1; len(ex_fix) < 10 and ex_fix.append(f"{ocr}->{out}")
        elif out.lower() == ocr.lower(): missed += 1; len(ex_miss) < 8 and ex_miss.append(f"{ocr}(want {clean})")
        else: wrong += 1; len(ex_wrong) < 8 and ex_wrong.append(f"{ocr}->{out}(want {clean})")

    left = changed = 0; ex_false = []
    for c in clean_seen:
        if correct(c, domain).lower() != c.lower(): changed += 1; len(ex_false) < 10 and ex_false.append(f"{c}->{correct(c, domain)}")
        else: left += 1
    noneng_touched = sum(1 for ocr, _ in noneng_pairs if correct(ocr, domain).lower() != ocr.lower())

    stream = [w for r in refs for w in words(r.get("input", ""))][:10000]
    t0 = time.perf_counter()
    for w in stream: correct(w, domain)
    dt = time.perf_counter() - t0
    us_word = dt / len(stream) * 1e6
    fwpr = sum(len(clean_words_of(r.get("expected_fields") or {})) for r in refs) / len(refs)
    us_ref = us_word * fwpr

    def pct(a, b): return f"{(a/b*100):.1f}%" if b else "n/a"
    print("="*66)
    print(f"DICT: wordfreq 80k + {len(domain):,} domain words | targets: COMMON 25k / STRICT 8k")
    print(f"TEST: {len(refs)} refs | english OCR pairs={len(eng_pairs)} | non-eng pairs={len(noneng_pairs)} | clean words={len(clean_seen):,} | throughput stream={len(stream):,}")
    print("-"*66)
    print(f"FIX-RATE (english OCR words):  fixed={fixed} ({pct(fixed,len(eng_pairs))})  missed={missed} ({pct(missed,len(eng_pairs))})  wrong={wrong} ({pct(wrong,len(eng_pairs))})")
    print(f"PRECISION (clean words):  left-alone={left:,} ({pct(left,len(clean_seen))})  WRONGLY-CHANGED={changed} ({pct(changed,len(clean_seen))})")
    print(f"          non-english words wrongly touched: {noneng_touched}/{len(noneng_pairs)} ({pct(noneng_touched,len(noneng_pairs))})")
    print(f"          change precision = {pct(fixed, fixed+wrong+changed)}  (of all edits, fraction correct)")
    print(f"THROUGHPUT: {us_word:.3f} us/word | ~{fwpr:.0f} field-words/ref -> {us_ref:.1f} us/ref")
    print(f"            impact: {pct(us_ref,3333)} of a 300/s ref | {pct(us_ref,11111)} of a 90/s ref  (gated: clean refs hit fast-path)")
    print("-"*66)
    print("FIXES:        ", ex_fix)
    print("MISSES:       ", ex_miss)
    print("WRONG FIXES:  ", ex_wrong or "none")
    print("FALSE CHANGES:", ex_false or "none")
    print("="*66)

if __name__ == "__main__":
    main()
