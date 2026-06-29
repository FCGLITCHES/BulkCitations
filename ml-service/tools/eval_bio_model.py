"""Two-tier BIO model evaluation harness.

Runs a model bundle over a held-out, real, stratified eval set and reports:
  Tier 1 (internal): char-span entity P/R/F1, per-label, BIO validity.
  Tier 2 (product):  accept-without-edit rate, mean field similarity / edit
                     distance, and the confident-wrong rate.

Gold rows use the BioGoldRow entity schema (entity_fields / entity_starts /
entity_ends) plus an optional `expected_fields` map (for the product tier) and a
`stratum` tag (for the per-stratum breakdown).

  python tools/eval_bio_model.py --gold <holdout.jsonl> [--bundle models/current]
         [--baseline reports/baseline.json] [--output reports/eval.json]

Comparing against a baseline report prints a PASS/FAIL promotion gate: entity F1
and accept-rate must not regress and confident-wrong must not rise.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate a BIO model bundle on a held-out eval set.")
    parser.add_argument("--gold", required=True, help="Path to the held-out eval JSONL.")
    parser.add_argument("--bundle", default=str(ML_SERVICE_ROOT / "models" / "current"), help="Model bundle dir.")
    parser.add_argument("--baseline", default=None, help="Optional baseline report JSON to gate against.")
    parser.add_argument("--output", default=str(ML_SERVICE_ROOT / "models" / "reports" / "bio_eval.json"))
    return parser.parse_args(argv)


def load_gold(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            payload = json.loads(line)
            raw_text = payload.get("raw_text") or payload.get("raw_reference")
            if not isinstance(raw_text, str) or not raw_text.strip():
                raise ValueError(f"line {line_number}: missing raw_text")
            payload["raw_text"] = raw_text
            rows.append(payload)
    return rows


def gold_char_spans(row: dict[str, Any]) -> list[tuple[str, int, int]]:
    fields = row.get("entity_fields") or []
    starts = row.get("entity_starts") or []
    ends = row.get("entity_ends") or []
    spans: list[tuple[str, int, int]] = []
    for field, start, end in zip(fields, starts, ends, strict=False):
        if isinstance(field, str) and isinstance(start, int) and isinstance(end, int) and end > start:
            spans.append((field, start, end))
    return spans


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    # Point the model registry at the requested bundle BEFORE importing inference.
    os.environ["MODEL_DIR"] = str(Path(args.bundle).resolve())

    from app.bio_eval_metrics import (
        aggregate_product_metrics,
        bio_validity_rate,
        entity_charspan_metrics,
        field_row_metrics,
    )
    from app.models.onnx_extractor import run_onnx_extraction

    gold_path = Path(args.gold).resolve()
    rows = load_gold(gold_path)
    if not rows:
        print(f"No rows found in {gold_path}", file=sys.stderr)
        return 1

    gold_spans_rows: list[list[tuple[str, int, int]]] = []
    pred_spans_rows: list[list[tuple[str, int, int]]] = []
    label_rows: list[list[str]] = []
    product_rows: list[dict[str, Any]] = []
    per_stratum: dict[str, list[dict[str, Any]]] = defaultdict(list)
    skipped = 0

    for row in rows:
        raw_text = row["raw_text"]
        result = run_onnx_extraction(raw_text)
        if result is None:
            skipped += 1
            continue

        bio = result.get("bio", {})
        pred_spans = [
            (str(entity.get("label", "O")), int(entity.get("charStart", -1)), int(entity.get("charEnd", -1)))
            for entity in bio.get("entities", [])
            if int(entity.get("charEnd", -1)) > int(entity.get("charStart", -1))
        ]
        gold_spans = gold_char_spans(row)

        gold_spans_rows.append(gold_spans)
        pred_spans_rows.append(pred_spans)
        label_rows.append([str(label) for label in bio.get("labels", [])])

        expected_fields = row.get("expected_fields") or {}
        if expected_fields:
            metrics = field_row_metrics(
                expected_fields,
                result.get("fields", {}),
                result.get("fieldConfidences", {}),
            )
            product_rows.append(metrics)
            per_stratum[str(row.get("stratum", "unspecified"))].append(metrics)

    tier1 = entity_charspan_metrics(gold_spans_rows, pred_spans_rows)
    tier1["bio_validity_rate"] = bio_validity_rate(label_rows)
    tier2 = aggregate_product_metrics(product_rows)

    stratum_summary = {
        stratum: aggregate_product_metrics(metrics)
        for stratum, metrics in sorted(per_stratum.items())
    }

    report = {
        "bundle": os.environ["MODEL_DIR"],
        "gold": str(gold_path),
        "rows_evaluated": len(gold_spans_rows),
        "rows_skipped": skipped,
        "internal": tier1,
        "product": tier2,
        "by_stratum": stratum_summary,
    }

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print_summary(report)
    if args.baseline:
        gate_passed = print_gate(report, Path(args.baseline).resolve())
        if not gate_passed:
            return 2
    print(f"\nreport written: {output_path}")
    return 0


def print_summary(report: dict[str, Any]) -> None:
    internal = report["internal"]
    product = report["product"]
    print("\n=== BIO model evaluation ===============================================")
    print(f"bundle:        {report['bundle']}")
    print(f"rows:          {report['rows_evaluated']} evaluated, {report['rows_skipped']} skipped")
    print("\n  Tier 1 — internal")
    print(f"    entity F1:           {internal['entity_exact_f1']}  (P {internal['entity_exact_precision']} / R {internal['entity_exact_recall']})")
    print(f"    BIO validity rate:   {internal['bio_validity_rate']}")
    weak = sorted(internal["per_label"].items(), key=lambda item: item[1]["f1"])[:5]
    print(f"    weakest labels:      {', '.join(f'{label} {m['f1']}' for label, m in weak)}")
    print("\n  Tier 2 — product")
    print(f"    accept-without-edit: {product['accept_without_edit_rate']}")
    print(f"    mean field sim:      {product['mean_field_similarity']}")
    print(f"    confident-wrong:     {product['confident_wrong_rate']}")
    print("\n  By stratum (accept-without-edit / confident-wrong)")
    for stratum, metrics in report["by_stratum"].items():
        print(f"    {stratum:<22} {metrics['accept_without_edit_rate']}  /  {metrics['confident_wrong_rate']}  (n={metrics['rows']})")
    print("========================================================================")


def print_gate(report: dict[str, Any], baseline_path: Path) -> bool:
    if not baseline_path.exists():
        print(f"\n[gate] baseline {baseline_path} not found — skipping gate.")
        return True
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    checks = [
        ("entity F1", report["internal"]["entity_exact_f1"], baseline["internal"]["entity_exact_f1"], "higher"),
        ("accept-without-edit", report["product"]["accept_without_edit_rate"], baseline["product"]["accept_without_edit_rate"], "higher"),
        ("confident-wrong", report["product"]["confident_wrong_rate"], baseline["product"]["confident_wrong_rate"], "lower"),
    ]
    print("\n  Promotion gate vs baseline")
    passed = True
    for name, current, base, direction in checks:
        ok = current >= base if direction == "higher" else current <= base
        passed = passed and ok
        arrow = "✓" if ok else "✗"
        print(f"    {arrow} {name:<22} {current}  vs baseline {base}  (want {direction})")
    print(f"  GATE: {'PASS' if passed else 'FAIL'}")
    return passed


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
