"""Evaluate a model bundle on the gold A/B test sets via the real inference path.

Reuses the project's run_onnx_extraction + bio_eval_metrics so numbers match the
shipping eval harness. Usage:
    MODEL_DIR=<bundle> python eval_ab.py <bundle_dir> <label>
Writes data/eval_<label>.json and prints a compact summary.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ML_ROOT = HERE.parents[1]
DATA = HERE / "data"
sys.path.insert(0, str(ML_ROOT))


def load(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def gold_char_spans(row):
    f = row.get("entity_fields") or []
    s = row.get("entity_starts") or []
    e = row.get("entity_ends") or []
    return [(fi, si, ei) for fi, si, ei in zip(f, s, e)
            if isinstance(fi, str) and isinstance(si, int) and isinstance(ei, int) and ei > si]


def main() -> None:
    bundle = Path(sys.argv[1]).resolve()
    label = sys.argv[2]
    os.environ["MODEL_DIR"] = str(bundle)

    from app.bio_eval_metrics import (
        aggregate_product_metrics,
        entity_charspan_metrics,
        field_row_metrics,
    )
    from app.models.onnx_extractor import run_onnx_extraction

    result = {"bundle": str(bundle), "label": label, "sets": {}}

    for setname, fname, tier in [
        ("validated_holdout", "test_validated.jsonl", 1),
        ("real_corpus", "test_realcorpus.jsonl", 2),
        ("real_input", "test_realinput.jsonl", 2),
    ]:
        rows = load(DATA / fname)
        gold_spans_rows, pred_spans_rows = [], []
        product_rows = []
        skipped = 0
        for row in rows:
            raw = row.get("raw_text")
            ext = run_onnx_extraction(raw)
            if ext is None:
                skipped += 1
                continue
            bio = ext.get("bio", {})
            pred_spans = [
                (str(en.get("label", "O")), int(en.get("charStart", -1)), int(en.get("charEnd", -1)))
                for en in bio.get("entities", [])
                if int(en.get("charEnd", -1)) > int(en.get("charStart", -1))
            ]
            gold_spans_rows.append(gold_char_spans(row))
            pred_spans_rows.append(pred_spans)
            exp = row.get("expected_fields") or {}
            if exp:
                product_rows.append(field_row_metrics(
                    exp, ext.get("fields", {}), ext.get("fieldConfidences", {})
                ))

        t1 = entity_charspan_metrics(gold_spans_rows, pred_spans_rows)
        t2 = aggregate_product_metrics(product_rows)
        result["sets"][setname] = {
            "tier": tier,
            "rows": len(gold_spans_rows),
            "skipped": skipped,
            "entity_exact_f1": t1["entity_exact_f1"],
            "entity_exact_precision": t1["entity_exact_precision"],
            "entity_exact_recall": t1["entity_exact_recall"],
            "per_label_f1": {k: v["f1"] for k, v in t1["per_label"].items()},
            "field_accept_without_edit_rate": t2["accept_without_edit_rate"],
            "field_mean_similarity": t2["mean_field_similarity"],
            "field_confident_wrong_rate": t2["confident_wrong_rate"],
            "field_mean_edit_distance": t2["mean_edit_distance"],
        }

    out = DATA / f"eval_{label}.json"
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    for sn, m in result["sets"].items():
        if m["tier"] == 1:
            print(f"[{label}] {sn:18} n={m['rows']:<3} entityF1={m['entity_exact_f1']:.4f} "
                  f"(P={m['entity_exact_precision']:.3f}/R={m['entity_exact_recall']:.3f})")
        else:
            print(f"[{label}] {sn:18} n={m['rows']:<3} fieldSim={m['field_mean_similarity']:.4f} "
                  f"accept={m['field_accept_without_edit_rate']:.4f} "
                  f"confWrong={m['field_confident_wrong_rate']:.4f}")
    print(f"  -> {out}")


if __name__ == "__main__":
    main()
