"""Build BEFORE/AFTER training sets + held-out real test sets for the gold A/B.

Deterministic (seeded). Produces, under experiments/gold_ab/data/:
  base.jsonl              base corpus subsample (dataset_split=train)
  gold_train.jsonl        validated gold rows added in AFTER (dataset_split=train)
  before.jsonl            = base
  after.jsonl             = base + gold_train
  test_validated.jsonl    held-out validated gold (char-span, Tier-1)
  test_realcorpus.jsonl   real_corpus_gold_v1 (expected_fields, Tier-2)
  test_realinput.jsonl    real-input-gold sample (expected_fields, Tier-2)
"""
from __future__ import annotations

import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # ml-service/
REPO = ROOT.parent
DATA = Path(__file__).resolve().parent / "data"
DATA.mkdir(parents=True, exist_ok=True)

SEED = 11
BASE_N = 600
REALINPUT_N = 100

BASE_CORPUS = ROOT / "datasets/citation-bio/_archive_synthetic/style_gold_supervision.jsonl"
VERIFIED = ROOT / "datasets/citation-bio/review/verified.jsonl"
REAL_CORPUS = ROOT / "datasets/citation-bio/processed/real_corpus_gold_v1.jsonl"
REAL_INPUT = REPO / "datasets/engine-v2/gold/real-input/real-input-gold-v1.jsonl"

# Tokenizer mirrors convert_spans_to_bio.py so produced tokens exist verbatim in raw_text.
TOKEN_RE = re.compile(
    r"https?://\S+"
    r"|10\.\d{4,9}/\S+"
    r"|[A-Za-z]?\d+(?:-\d+)?"
    r"|[A-Za-z]+(?:'[A-Za-z]+)?"
    r"|[^\w\s]",
)


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def spans_to_bio(raw_text: str, fields: list[str], starts: list[int], ends: list[int]):
    """Convert char spans to (bio_tokens, bio_tags) using offset containment."""
    spans = sorted(zip(fields, starts, ends), key=lambda s: (s[1], s[2]))
    tokens, tags = [], []
    prior_field = None
    for m in TOKEN_RE.finditer(raw_text):
        ts, te = m.start(), m.end()
        tag = "O"
        field = None
        for f, s, e in spans:
            if ts >= s and te <= e:
                prefix = "B" if prior_field != f else "I"
                tag = f"{prefix}-{f}"
                field = f
                break
        prior_field = field
        tokens.append(m.group(0))
        tags.append(tag)
    return tokens, tags


def doi_of(expected: dict) -> str | None:
    doi = expected.get("doi")
    if isinstance(doi, str) and doi.strip():
        return doi.strip().lower().replace("https://doi.org/", "")
    return None


def main() -> None:
    rnd = random.Random(SEED)

    # ---- base corpus subsample ------------------------------------------------
    base = read_jsonl(BASE_CORPUS)
    rnd.shuffle(base)
    base = base[:BASE_N]
    for r in base:
        r["dataset_split"] = "train"
    write_jsonl(DATA / "base.jsonl", base)

    # ---- validated gold (verified.jsonl): split train/test --------------------
    verified = read_jsonl(VERIFIED)
    rnd.shuffle(verified)
    n_test = 23
    v_test = verified[:n_test]
    v_train_src = verified[n_test:]

    gold_train = []
    skipped = 0
    for r in v_train_src:
        toks, tags = spans_to_bio(
            r["raw_text"], r["entity_fields"], r["entity_starts"], r["entity_ends"]
        )
        if not any(t != "O" for t in tags):
            skipped += 1
            continue
        gold_train.append({
            "raw_text": r["raw_text"],
            "bio_tokens": toks,
            "bio_tags": tags,
            "expected_type": r.get("expected_type"),
            "dataset_split": "train",
            "trust_level": "gold",
            "provenance": r.get("provenance", "human_verified"),
            "stratum": r.get("stratum"),
        })
    write_jsonl(DATA / "gold_train.jsonl", gold_train)
    write_jsonl(DATA / "test_validated.jsonl", v_test)

    gold_train_dois = {doi_of(r) for r in v_train_src
                       if isinstance(r.get("expected_fields"), dict)}  # usually empty (no expected_fields)
    gold_train_raw = {r["raw_text"] for r in gold_train}

    # ---- BEFORE / AFTER training files ---------------------------------------
    write_jsonl(DATA / "before.jsonl", base)
    write_jsonl(DATA / "after.jsonl", base + gold_train)

    # ---- real_corpus test (Tier-2) -------------------------------------------
    real_corpus = read_jsonl(REAL_CORPUS)
    for r in real_corpus:
        r.setdefault("stratum", "real_corpus")
    write_jsonl(DATA / "test_realcorpus.jsonl", real_corpus)

    # ---- real-input-gold sample (Tier-2) -------------------------------------
    real_input = read_jsonl(REAL_INPUT)
    rnd.shuffle(real_input)
    out = []
    seen_dois = set(gold_train_dois)
    for r in real_input:
        exp = r.get("expected_fields") or {}
        raw = r.get("input")
        if not isinstance(raw, str) or not raw.strip() or not isinstance(exp, dict):
            continue
        if raw in gold_train_raw:
            continue
        d = doi_of(exp)
        if d and d in seen_dois:
            continue
        if d:
            seen_dois.add(d)
        out.append({
            "raw_text": raw,
            "expected_fields": exp,
            "expected_type": r.get("reference_type"),
            "stratum": r.get("input_profile") or "real_input",
        })
        if len(out) >= REALINPUT_N:
            break
    write_jsonl(DATA / "test_realinput.jsonl", out)

    print(json.dumps({
        "seed": SEED,
        "base_rows": len(base),
        "gold_train_rows": len(gold_train),
        "gold_train_skipped": skipped,
        "before_rows": len(base),
        "after_rows": len(base) + len(gold_train),
        "test_validated_rows": len(v_test),
        "test_realcorpus_rows": len(real_corpus),
        "test_realinput_rows": len(out),
        "total_real_test_refs": len(v_test) + len(real_corpus) + len(out),
    }, indent=2))


if __name__ == "__main__":
    main()
