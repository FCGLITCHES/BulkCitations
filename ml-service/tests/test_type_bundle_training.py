from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.training_dataset import load_training_jsonl
from app.type_classifier import predict_type_batch
from tools.train_type_bundle import bundle_payload, split_type_rows, write_type_bundle


class TypeBundleTrainingTest(unittest.TestCase):
    def test_trains_writes_and_uses_local_type_bundle(self) -> None:
        rows = [
            {
                "raw_text": "Smith J. Example article. Journal of Examples. 2020;12(3):44-50.",
                "expected_fields": {"title": "Example article"},
                "expected_type": "article-journal",
                "dataset_split": "train",
                "trust_level": "gold",
                "row_status": "reviewed",
            },
            {
                "raw_text": "Jones A. Example book. Springer Publishing; 2020. ISBN 9781234567897.",
                "expected_fields": {"title": "Example book"},
                "expected_type": "book",
                "dataset_split": "train",
                "trust_level": "gold",
                "row_status": "reviewed",
            },
            {
                "raw_text": "Doe A. In: Smith J, editor. Example chapter. Example Book. Springer; 2021. pp. 1-10.",
                "expected_fields": {"title": "Example chapter"},
                "expected_type": "book-chapter",
                "dataset_split": "train",
                "trust_level": "gold",
                "row_status": "reviewed",
            },
            {
                "raw_text": "Roe A. Example thesis. Doctoral dissertation, Example University; 2022.",
                "expected_fields": {"title": "Example thesis"},
                "expected_type": "thesis",
                "dataset_split": "val",
                "trust_level": "gold",
                "row_status": "reviewed",
            },
            {
                "raw_text": "Conference A. Example proceeding. In Proceedings of the Example Conference; 2023. pp. 3-9.",
                "expected_fields": {"title": "Example proceeding"},
                "expected_type": "conference-paper",
                "dataset_split": "test",
                "trust_level": "gold",
                "row_status": "reviewed",
            },
            {
                "raw_text": "Quarantine A. Bad article. Journal of Examples. 2020;1(1):1-2.",
                "expected_fields": {"title": "Bad article"},
                "expected_type": "article-journal",
                "dataset_split": "train",
                "trust_level": "gold",
                "row_status": "quarantined",
            },
            {
                "raw_text": "Draft A. Draft article. Journal of Examples. 2020;1(1):1-2.",
                "expected_fields": {"title": "Draft article"},
                "expected_type": "article-journal",
                "dataset_split": "train",
                "trust_level": "draft",
                "row_status": "draft",
            },
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            dataset_path = Path(temp_dir) / "type_gold.jsonl"
            dataset_path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            training_rows = load_training_jsonl(dataset_path)

            splits = split_type_rows(training_rows)
            self.assertEqual(len(splits["train"]), 5)

            payload = bundle_payload(
                training_rows,
                version="type-reviewed-test-v1",
                feature_version="type-features-v1",
                epochs=50,
                learning_rate=0.15,
                l2=1e-4,
                source_path=dataset_path,
            )
            self.assertEqual(payload["rowCounts"]["train"], 3)
            self.assertEqual(payload["rowCounts"]["val"], 1)
            self.assertEqual(payload["rowCounts"]["test"], 1)
            self.assertEqual(payload["excludedRows"]["quarantined_or_draft"], 2)
            self.assertTrue(payload["datasetLineage"]["rawGoldRowsIncluded"])
            self.assertEqual(payload["datasetLineage"]["rawGoldRowsScanned"], 7)
            self.assertEqual(payload["datasetLineage"]["eligibleCertifiedRows"], 5)
            self.assertEqual(payload["datasetLineage"]["rowsUsedForTraining"], 3)
            self.assertEqual(payload["datasetLineage"]["validationRows"], 1)
            self.assertEqual(payload["datasetLineage"]["testRows"], 1)
            self.assertEqual(payload["datasetLineage"]["quarantinedRowsExcluded"], 1)
            self.assertEqual(payload["datasetLineage"]["draftRowsExcluded"], 1)
            self.assertIn("article-journal", payload["weights"])
            self.assertIn("book", payload["weights"])

            output_path = write_type_bundle(payload, Path(temp_dir) / "models", "type-reviewed-test-v1")
            self.assertTrue(output_path.exists())

        prediction = predict_type_batch(["Patent US1234567, Example device patent, 2020."])[0]
        self.assertIn(prediction["type"], {"patent", "article-journal", "unknown"})
        self.assertIn("modelVersion", prediction)


if __name__ == "__main__":
    unittest.main()
