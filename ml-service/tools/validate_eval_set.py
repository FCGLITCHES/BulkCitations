"""Validate a held-out BIO eval set.

Enforces the guarantees that make the eval set trustworthy:
  * schema: raw_text + parallel entity_fields/starts/ends arrays,
  * offset correctness: raw_text[start:end] == entity_text,
  * labels in the canonical BIO core space,
  * stratum present and declared in strata.json,
  * per-stratum counts vs targets,
  * HELD-OUT: no input_hash collides with any training-track row.

  python tools/validate_eval_set.py --gold <holdout.jsonl> \
         [--training <glob> ...] [--strata datasets/citation-bio/eval/strata.json]

Exit code 0 == valid (warnings allowed), non-zero == hard errors found.
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))

from app.bio_training_dataset import BIO_CORE_ALIASES, compute_input_hash, normalize_bio_core

DEFAULT_TRAINING_GLOBS = [
    str(ML_SERVICE_ROOT / "datasets" / "citation-bio" / "processed" / "*.jsonl"),
]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate a held-out BIO eval set.")
    parser.add_argument("--gold", required=True)
    parser.add_argument("--training", nargs="*", default=DEFAULT_TRAINING_GLOBS)
    parser.add_argument("--strata", default=str(ML_SERVICE_ROOT / "datasets" / "citation-bio" / "eval" / "strata.json"))
    parser.add_argument("--lenient-examples", action="store_true",
                        help="Treat offset errors on provenance containing EXAMPLE as warnings.")
    return parser.parse_args(argv)


def load_training_hashes(globs: list[str]) -> set[str]:
    hashes: set[str] = set()
    for pattern in globs:
        for path in glob.glob(pattern):
            file_path = Path(path)
            if file_path.name.startswith("holdout") or "eval" in file_path.parts:
                continue
            with file_path.open(encoding="utf-8") as handle:
                for raw_line in handle:
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    raw_text = payload.get("raw_text") or payload.get("raw_reference")
                    given = payload.get("input_hash")
                    if isinstance(given, str) and given:
                        hashes.add(given)
                    if isinstance(raw_text, str) and raw_text.strip():
                        hashes.add(compute_input_hash(raw_text))
    return hashes


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    gold_path = Path(args.gold).resolve()
    strata = json.loads(Path(args.strata).read_text(encoding="utf-8"))
    known_strata = {item["key"]: item["target"] for item in strata["strata"]}
    canonical = set(BIO_CORE_ALIASES.values())

    training_hashes = load_training_hashes(args.training)
    errors: list[str] = []
    warnings: list[str] = []
    stratum_counts: Counter[str] = Counter()
    seen_hashes: set[str] = set()
    row_count = 0

    with gold_path.open(encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            row_count += 1
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                errors.append(f"line {line_number}: invalid JSON ({exc})")
                continue

            is_example = "EXAMPLE" in str(row.get("provenance", ""))
            offence = warnings.append if (is_example and args.lenient_examples) else errors.append

            raw_text = row.get("raw_text")
            if not isinstance(raw_text, str) or not raw_text.strip():
                errors.append(f"line {line_number}: missing raw_text")
                continue

            fields = row.get("entity_fields") or []
            starts = row.get("entity_starts") or []
            ends = row.get("entity_ends") or []
            texts = row.get("entity_texts") or []
            if not (len(fields) == len(starts) == len(ends)):
                errors.append(f"line {line_number}: entity_fields/starts/ends length mismatch")
            else:
                for i, (field, start, end) in enumerate(zip(fields, starts, ends)):
                    core = BIO_CORE_ALIASES.get(normalize_bio_core(str(field)))
                    if core is None or core not in canonical:
                        errors.append(f"line {line_number}: entity[{i}] unknown label '{field}'")
                    if not (isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(raw_text)):
                        offence(f"line {line_number}: entity[{i}] offsets out of range [{start},{end}]")
                        continue
                    if i < len(texts) and isinstance(texts[i], str) and raw_text[start:end] != texts[i]:
                        offence(
                            f"line {line_number}: entity[{i}] offset mismatch — "
                            f"raw[{start}:{end}]={raw_text[start:end]!r} != {texts[i]!r}"
                        )

            stratum = row.get("stratum")
            if not isinstance(stratum, str) or stratum not in known_strata:
                errors.append(f"line {line_number}: stratum '{stratum}' not declared in strata.json")
            else:
                stratum_counts[stratum] += 1

            input_hash = row.get("input_hash") if isinstance(row.get("input_hash"), str) else compute_input_hash(raw_text)
            if input_hash in seen_hashes:
                errors.append(f"line {line_number}: duplicate reference within eval set")
            seen_hashes.add(input_hash)
            if input_hash in training_hashes:
                errors.append(f"line {line_number}: HELD-OUT VIOLATION — reference also appears in training data")

    print(f"\n=== eval-set validation: {gold_path.name} ===")
    print(f"rows: {row_count}   training hashes loaded: {len(training_hashes)}")
    print("\nper-stratum coverage (have / target):")
    for key, target in known_strata.items():
        have = stratum_counts.get(key, 0)
        flag = "" if have >= target else "  ← under target"
        print(f"  {key:<24} {have:>4} / {target}{flag}")

    if warnings:
        print(f"\nwarnings ({len(warnings)}):")
        for warning in warnings[:20]:
            print(f"  ! {warning}")
    if errors:
        print(f"\nERRORS ({len(errors)}):")
        for error in errors[:40]:
            print(f"  ✗ {error}")
        print("\nRESULT: INVALID")
        return 1

    total_have = sum(stratum_counts.values())
    total_target = sum(known_strata.values())
    print(f"\nRESULT: VALID  ({total_have}/{total_target} toward target)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
