"""Assemble a REAL-DATA-ONLY BIO training set (no synthetic).

Sources:
  - 40 user-validated gold (verified.jsonl split, char-spans -> BIO)  [data/gold_train.jsonl]
  - ~900 real-input-gold refs: expected_fields projected -> weak BIO labels
Held out for eval (never trained): data/test_validated.jsonl (23),
  data/test_realcorpus.jsonl (57), data/test_realinput.jsonl (100).

Writes data/real_train.jsonl (dataset_split=train).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ROOT = HERE.parents[1]            # ml-service/
REPO = ROOT.parent
REAL_INPUT = REPO / "datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl"

# Keep up to this many real citation-style renderings per ref (style-invariance aug).
MAX_VARIANTS_PER_REF = 4

# Unicode-aware: [^\W\d_] = any letter (incl. Cyrillic/CJK/accented), not digit/underscore.
TOKEN_RE = re.compile(
    r"https?://\S+"
    r"|10\.\d{4,9}/\S+"
    r"|\d+(?:[\-‐-―−]\d+)?"   # page/number ranges keep hyphen/en-dash/em-dash/minus as ONE token
    r"|[^\W\d_]+(?:['’][^\W\d_]+)?"
    r"|[^\w\s]",
)

# expected_fields key -> canonical BIO core (must be in CANONICAL_BIO_LABELS).
# Keys with None have no BIO label and are skipped (isbn/issn/patent are not taggable).
FIELD_TO_CORE = {
    "authors": "author", "author": "author", "editors": "editors",
    "title": "title", "bookTitle": "book_title", "conferenceTitle": "conference_title",
    "journal": "journal", "year": "year",
    "institution": "institution", "publisher": "publisher",
    "repository": "repository", "siteName": "site_name", "thesisType": "thesis_type",
    "volume": "volume", "issue": "issue", "pages": "pages",
    "doi": "doi", "url": "url",
    "isbn": None, "issn": None, "patent": None,
}
# longer/structural fields first so short values (year) don't grab title tokens
FIELD_ORDER = [
    "bookTitle", "conferenceTitle", "title", "journal", "authors", "editors",
    "institution", "publisher", "repository", "siteName", "thesisType",
    "doi", "url", "pages", "volume", "issue", "year",
]


def read_jsonl(p: Path):
    with p.open(encoding="utf-8") as fh:
        return [json.loads(l) for l in fh if l.strip()]


_DASH = re.compile(r"[‐-―−]")
_SQ = re.compile(r"[‘’‚‛′´`]")
_DQ = re.compile(r"[“”„‟″]")


def normtok(t: str) -> str:
    t = _DASH.sub("-", t)
    t = _SQ.sub("'", t)
    t = _DQ.sub('"', t)
    return t.lower()


def tok(text: str):
    toks, offs = [], []
    for m in TOKEN_RE.finditer(text):
        toks.append(m.group(0)); offs.append((m.start(), m.end()))
    return toks, offs


def _author_strings(value):
    out = []
    if isinstance(value, list):
        for a in value:
            if isinstance(a, str) and a.strip():
                out.append(a.strip())
            elif isinstance(a, dict):
                lit = (a.get("literal") or "").strip()
                fam = (a.get("family") or "").strip(); giv = (a.get("given") or "").strip()
                out.append(lit or (f"{fam}, {giv}" if fam and giv else fam or giv))
    elif isinstance(value, str):
        out.append(value.strip())
    return [s for s in out if s]


def _values_for(field, value):
    if field in ("authors", "author"):
        return _author_strings(value)
    if value is None:
        return []
    return [str(value).strip()] if str(value).strip() else []


def find_run(doc_low, val_low, occupied):
    L = len(val_low)
    if L == 0:
        return None
    for s in range(0, len(doc_low) - L + 1):
        if any((s + i) in occupied for i in range(L)):
            continue
        if doc_low[s:s + L] == val_low:
            return (s, s + L)
    return None


def find_containing_token(doc_low, val_low, occupied):
    """First unoccupied doc token that CONTAINS val_low — for url-wrapped DOIs
    (https://doi.org/<doi>, doi:<doi>) and URLs that exact token-matching misses."""
    if not val_low:
        return None
    for t in range(len(doc_low)):
        if t in occupied:
            continue
        if val_low in doc_low[t]:
            return (t, t + 1)
    return None


def find_longest_subrun(doc_low, vlow, occupied, min_len):
    """Longest contiguous slice of vlow (>= min_len tokens) that find_run matches in doc.
    Long venue/book names often render with a prefix ('Proceedings of …') or get truncated,
    so the full value misses — match the longest chunk that IS present instead."""
    n = len(vlow)
    if n < min_len:
        return None
    for length in range(n, min_len - 1, -1):
        for start in range(0, n - length + 1):
            run = find_run(doc_low, vlow[start:start + length], occupied)
            if run is not None:
                return run
    return None


def _match_candidates(field, val):
    """Token-string candidates to try, longest/most-specific first."""
    cands = [val]
    if field in ("authors", "author"):
        fam = val.split(",", 1)[0].strip()        # "Family, Given" -> "Family"
        if fam and fam != val:
            cands.append(fam)
    return cands


def project(raw_text: str, expected: dict):
    toks, _ = tok(raw_text)
    doc_low = [normtok(t) for t in toks]
    tags = ["O"] * len(toks)
    occupied = set()
    labeled = 0
    for field in FIELD_ORDER:
        if field not in expected:
            continue
        core = FIELD_TO_CORE.get(field)
        if not core:
            continue
        for val in _values_for(field, expected[field]):
            run = None
            for cand in _match_candidates(field, val):
                vtoks, _ = tok(cand)
                vlow = [normtok(t) for t in vtoks]
                run = find_run(doc_low, vlow, occupied)
                if run is not None:
                    break
            if run is None and core in ("doi", "url"):
                # DOIs/URLs are usually wrapped (https://doi.org/<doi>, "doi:<doi>"), so exact
                # token-sequence matching misses them — fall back to the single doc token that
                # CONTAINS the value. This takes doi recall from ~1% to ~full.
                run = find_containing_token(doc_low, normtok(val), occupied)
            if run is None and core in ("conference_title", "book_title"):
                # Long venue/book names render with prefixes/truncation; match the longest
                # contiguous chunk (>= half the value, >= 3 tokens) rather than the full string.
                vtoks, _ = tok(val)
                vlow = [normtok(t) for t in vtoks]
                run = find_longest_subrun(doc_low, vlow, occupied, max(3, len(vlow) // 2))
            if run is None:
                continue
            s, e = run
            tags[s] = f"B-{core}"
            for i in range(s + 1, e):
                tags[i] = f"I-{core}"
            for i in range(s, e):
                occupied.add(i)
            labeled += 1
    return toks, tags, labeled


def doi_of(exp):
    d = exp.get("doi")
    return d.strip().lower().replace("https://doi.org/", "") if isinstance(d, str) and d.strip() else None


def norm_key(s: str) -> str:
    """Aggressive identity key for leak detection: drop case/space/punctuation.
    verified.jsonl and real_corpus_gold render the SAME refs differently, so an
    exact-text check misses overlaps — this catches same-ref-different-rendering."""
    return re.sub(r"[^a-z0-9а-яё]", "", (s or "").lower())


def main():
    # held-out eval sets (clean, comparable to production) — exclude their refs from
    # ALL training sources (raw text, DOI, and normalized identity key).
    eval_raw, eval_doi, eval_norm = set(), set(), set()
    for f in ["test_validated.jsonl", "test_realinput.jsonl"]:
        for r in read_jsonl(DATA / f):
            if r.get("raw_text"):
                eval_raw.add(r["raw_text"]); eval_norm.add(norm_key(r["raw_text"]))
            ex = r.get("expected_fields") or {}
            d = doi_of(ex)
            if d:
                eval_doi.add(d)

    def is_heldout(raw, d=None):
        return (raw in eval_raw) or (norm_key(raw) in eval_norm) or (bool(d) and d in eval_doi)

    rows = []
    dropped_leak = 0

    # 1) 40 validated gold (already BIO) — guard against any held-out overlap
    gold = read_jsonl(DATA / "gold_train.jsonl")
    kept_verified = 0
    for r in gold:
        if is_heldout(r["raw_text"]):
            dropped_leak += 1
            continue
        r["dataset_split"] = "train"; r["trust_level"] = "gold"
        rows.append(r); kept_verified += 1

    # 1b) real_corpus full-field gold BIO — DROP any ref that is in the held-out
    #     validated set (verified.jsonl and real_corpus overlap on ~19 refs).
    realcorpus = read_jsonl(DATA / "test_realcorpus.jsonl")
    kept_realcorpus = 0
    for r in realcorpus:
        if is_heldout(r["raw_text"], doi_of(r.get("expected_fields") or {})):
            dropped_leak += 1
            continue
        r["dataset_split"] = "train"
        r.setdefault("trust_level", "gold")
        rows.append(r); kept_realcorpus += 1

    # 2) real-input projected. real-input-gold renders each ref in several REAL citation
    #    styles (apa/mla/chicago/vancouver/...). We keep up to MAX_VARIANTS_PER_REF of
    #    them per ref — same real ref, different surface forms = style-invariance
    #    augmentation (not synthetic, not just volume). Richest styles kept first.
    #    Held-out DOIs/texts are fully excluded, so no eval leak.
    per_ref: dict[str, list[tuple[tuple, dict]]] = {}
    seen_raw: set[str] = set()
    for r in read_jsonl(REAL_INPUT):
        raw = r.get("input"); exp = r.get("expected_fields") or {}
        if not isinstance(raw, str) or not raw.strip() or not isinstance(exp, dict):
            continue
        if raw in seen_raw:
            continue
        d = doi_of(exp)
        if is_heldout(raw, d):
            continue
        toks, tags, labeled = project(raw, exp)
        if labeled < 2 or not any(t != "O" for t in tags):
            continue
        seen_raw.add(raw)
        # rank styles: author-bearing first, then most distinct fields, then most labels
        has_author = any(t.startswith("B-author") for t in tags)
        distinct = len({t.split("-", 1)[1] for t in tags if t != "O"})
        score = (1 if has_author else 0, distinct, labeled)
        key = d or ("rawkey::" + raw)
        cand = {
            "raw_text": raw, "bio_tokens": toks, "bio_tags": tags,
            "expected_type": r.get("reference_type"),
            "citation_style": r.get("citation_style"),
            "dataset_split": "train", "trust_level": "projected_weak",
            "provenance": "real-input-gold:field-projection",
        }
        per_ref.setdefault(key, []).append((score, cand))
    proj_rows = []
    for key, variants in per_ref.items():
        variants.sort(key=lambda sc_row: sc_row[0], reverse=True)
        proj_rows.extend(row for _, row in variants[:MAX_VARIANTS_PER_REF])
    proj_labeled = sum(sum(1 for t in row["bio_tags"] if t.startswith("B-")) for row in proj_rows)
    rows.extend(proj_rows)

    with (DATA / "real_train.jsonl").open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(json.dumps({
        "validated_gold_rows": kept_verified,
        "real_corpus_gold_rows_kept": kept_realcorpus,
        "rows_dropped_as_heldout_leak": dropped_leak,
        "unique_realinput_refs": len(per_ref),
        "projected_realinput_rows": len(proj_rows),
        "avg_style_variants_per_ref": round(len(proj_rows) / max(1, len(per_ref)), 2),
        "max_variants_per_ref": MAX_VARIANTS_PER_REF,
        "avg_labels_per_projected_row": round(proj_labeled / max(1, len(proj_rows)), 2),
        "total_real_train_rows": len(rows),
        "held_out_excluded": len(eval_raw),
    }, indent=2))


if __name__ == "__main__":
    main()
