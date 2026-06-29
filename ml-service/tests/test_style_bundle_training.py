from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.train_style_bundle import bundle_payload, split_style_rows, write_style_bundle
from app.training_dataset import load_training_jsonl


class StyleBundleTrainingTest(unittest.TestCase):
    def test_trains_and_writes_a_local_style_bundle(self) -> None:
        rows = [
            {
                "raw_text": "Smith, J. (2020). Example article. Journal of Examples, 12(3), 44-50. https://doi.org/10.1000/apa",
                "expected_fields": {"title": "Example article"},
                "expected_style": "apa7",
                "dataset_split": "train",
                "trust_level": "gold",
            },
            {
                "raw_text": "BSI British Standards (2013) Lamps for road vehicles. BSI British Standards. Available at: https://doi.org/10.3403/01032627.",
                "expected_fields": {"title": "Lamps for road vehicles"},
                "expected_style": "harvard-ctr",
                "dataset_split": "train",
                "trust_level": "gold",
            },
            {
                "raw_text": "[1]Monchik EP. MAIN ACTIVITIES OF THE REPUBLICAN LIBRARY FOR SCIENCE AND TECHNOLOGY OF BELARUS, УП «ИВЦ Минфина»; 2022. https://doi.org/10.47612/978-985-880-283-7-2022-158-166.",
                "expected_fields": {"title": "MAIN ACTIVITIES OF THE REPUBLICAN LIBRARY FOR SCIENCE AND TECHNOLOGY OF BELARUS"},
                "expected_style": "vancouver",
                "dataset_split": "train",
                "trust_level": "gold",
            },
            {
                "raw_text": "Ali, Nafhesa. Older South Asian Migrant Women’s Experiences of Ageing in the UK. Springer International Publishing, 2024, https://doi.org/10.1007/978-3-031-50462-4.",
                "expected_fields": {"title": "Older South Asian Migrant Women’s Experiences of Ageing in the UK"},
                "expected_style": "mla9",
                "dataset_split": "val",
                "trust_level": "gold",
            },
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            dataset_path = Path(temp_dir) / "style_gold.jsonl"
            dataset_path.write_text(
                "".join(json.dumps(row) + "\n" for row in rows),
                encoding="utf-8",
            )
            training_rows = load_training_jsonl(dataset_path)
            payload = bundle_payload(
                training_rows,
                version="style-reviewed-test-v1",
                feature_version="style-features-v1",
                epochs=40,
                learning_rate=0.15,
                l2=1e-4,
            )

            self.assertEqual(payload["modelVersion"], "style-reviewed-test-v1")
            self.assertIn("apa7", payload["weights"])
            self.assertIn("harvard-ctr", payload["weights"])
            self.assertGreater(payload["rowCounts"]["train"], 0)

            output_path = write_style_bundle(payload, Path(temp_dir) / "models", "style-reviewed-test-v1")
            self.assertTrue(output_path.exists())
            self.assertTrue((output_path.parent / "thresholds.json").exists())
            self.assertTrue((output_path.parent / "decision_policy.json").exists())
            self.assertTrue((output_path.parent / "reason_codes.json").exists())
            written = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(written["modelVersion"], "style-reviewed-test-v1")
            decision_policy = json.loads((output_path.parent / "decision_policy.json").read_text(encoding="utf-8"))
            self.assertEqual(decision_policy["operatingMode"], "shadow")
            self.assertTrue(decision_policy["requireCalibrationForPrimary"])
            self.assertTrue(decision_policy["abstainOnMissingPrimaryCalibration"])
            self.assertFalse(decision_policy["calibration"]["available"])

    def test_split_rows_train_model_and_hold_validation_for_metrics(self) -> None:
        rows = [
            {
                "raw_text": "Smith, J. (2020). Train APA article. Journal of Examples, 12(3), 44-50.",
                "expected_fields": {"title": "Train APA article"},
                "expected_style": "apa7",
                "dataset_split": "train",
                "trust_level": "gold",
            },
            {
                "raw_text": "[1] J. Smith, \"Train IEEE article,\" Journal of Examples, vol. 12, no. 3, pp. 44-50, 2020.",
                "expected_fields": {"title": "Train IEEE article"},
                "expected_style": "ieee",
                "dataset_split": "train",
                "trust_level": "gold",
            },
            {
                "raw_text": "BSI British Standards (2013) Validation-only report. BSI British Standards. Available at: https://example.test/validation.",
                "expected_fields": {"title": "Validation-only report"},
                "expected_style": "harvard-ctr",
                "dataset_split": "val",
                "trust_level": "gold",
            },
            {
                "raw_text": "Doe J. Test-only article. Journal of Examples. 2020;12(3):44-50.",
                "expected_fields": {"title": "Test-only article"},
                "expected_style": "vancouver",
                "dataset_split": "test",
                "trust_level": "gold",
            },
            {
                "raw_text": "Brown, B. Holdout-only article. Journal of Examples, 2020.",
                "expected_fields": {"title": "Holdout-only article"},
                "expected_style": "mla9",
                "dataset_split": "holdout",
                "trust_level": "gold",
            },
            {
                "raw_text": "Quarantine, Q. (2020). Should not train. Journal of Examples, 1(1), 1-2.",
                "expected_fields": {"title": "Should not train"},
                "expected_style": "apa7",
                "dataset_split": "train",
                "trust_level": "gold",
                "row_status": "quarantined",
            },
            {
                "raw_text": "Draft, D. (2020). Should not train either. Journal of Examples, 1(1), 1-2.",
                "expected_fields": {"title": "Should not train either"},
                "expected_style": "apa7",
                "dataset_split": "train",
                "trust_level": "draft",
                "row_status": "draft",
            },
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            dataset_path = Path(temp_dir) / "style_gold.jsonl"
            dataset_path.write_text(
                "".join(json.dumps(row) + "\n" for row in rows),
                encoding="utf-8",
            )
            training_rows = load_training_jsonl(dataset_path)

        splits = split_style_rows(training_rows)
        self.assertEqual({split: len(values) for split, values in splits.items()}, {
            "train": 4,
            "val": 1,
            "test": 1,
            "holdout": 1,
        })

        payload = bundle_payload(
            training_rows,
            version="style-split-smoke-v1",
            feature_version="style-features-v1",
            epochs=30,
            learning_rate=0.2,
            l2=0.0,
        )

        self.assertEqual(payload["rowCounts"], {
            "train": 2,
            "val": 1,
            "test": 1,
            "holdout": 1,
        })
        self.assertIn("val_accuracy", payload["metrics"])
        self.assertIn("test_accuracy", payload["metrics"])
        self.assertGreaterEqual(payload["metrics"]["train_accuracy"], 0.0)

        # This feature appears only on the validation row. If validation rows
        # leaked into training, gradient descent would assign it a weight.
        self.assertIn("available_at", payload["featureNames"])
        for style_weights in payload["weights"].values():
            self.assertNotIn("available_at", style_weights)


if __name__ == "__main__":
    unittest.main()
