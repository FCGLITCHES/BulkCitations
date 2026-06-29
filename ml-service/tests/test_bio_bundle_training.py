from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ML_SERVICE_ROOT = REPO_ROOT / "ml-service"


class BioBundleTrainingTest(unittest.TestCase):
    def test_trains_and_promotes_a_local_bio_bundle(self) -> None:
        rows = [
            {
                "id": "ref_000001",
                "raw_reference": "Smith J, Doe A. Example Article. Journal of Testing. 2024;12(4):123-145. doi:10.1000/test",
                "tokens": [
                    "Smith",
                    "J",
                    ",",
                    "Doe",
                    "A",
                    ".",
                    "Example",
                    "Article",
                    ".",
                    "Journal",
                    "of",
                    "Testing",
                    ".",
                    "2024",
                    ";",
                    "12",
                    "(",
                    "4",
                    ")",
                    ":",
                    "123-145",
                    ".",
                    "doi",
                    ":",
                    "10.1000/test",
                ],
                "bio_tags": [
                    "B-author",
                    "I-author",
                    "I-author",
                    "I-author",
                    "I-author",
                    "O",
                    "B-title",
                    "I-title",
                    "O",
                    "B-journal",
                    "I-journal",
                    "I-journal",
                    "O",
                    "B-year",
                    "O",
                    "B-volume",
                    "O",
                    "B-issue",
                    "O",
                    "O",
                    "B-pages",
                    "O",
                    "O",
                    "O",
                    "B-doi",
                ],
                "dataset_split": "train",
            },
            {
                "id": "ref_000002",
                "raw_reference": "World Health Organization. World malaria report 2023. Available at: https://example.org/report",
                "tokens": [
                    "World",
                    "Health",
                    "Organization",
                    ".",
                    "World",
                    "malaria",
                    "report",
                    "2023",
                    ".",
                    "Available",
                    "at",
                    ":",
                    "https://example.org/report",
                ],
                "bio_tags": [
                    "B-author",
                    "I-author",
                    "I-author",
                    "O",
                    "B-title",
                    "I-title",
                    "I-title",
                    "I-title",
                    "O",
                    "O",
                    "O",
                    "O",
                    "B-url",
                ],
                "dataset_split": "val",
            },
        ]

        with self.subTest("train-and-promote"):
            from tempfile import TemporaryDirectory

            with TemporaryDirectory() as temp_dir:
                temp_root = Path(temp_dir)
                dataset_path = temp_root / "citation_bio_sample.jsonl"
                model_root = temp_root / "models"
                version = "bio-bundle-test-v1"
                dataset_path.write_text(
                    "".join(json.dumps(row) + "\n" for row in rows),
                    encoding="utf-8",
                )

                train_result = subprocess.run(
                    [
                        sys.executable,
                        str(ML_SERVICE_ROOT / "tools" / "train_bio_bundle.py"),
                        str(dataset_path),
                        "--model-root",
                        str(model_root),
                        "--version",
                        version,
                        "--epochs",
                        "1",
                    ],
                    cwd=REPO_ROOT,
                    check=True,
                    capture_output=True,
                    text=True,
                )
                train_payload = json.loads(train_result.stdout)
                self.assertTrue(train_payload["ok"])
                self.assertEqual(train_payload["modelVersion"], version)
                self.assertEqual(train_payload["datasetStats"]["rows_total"], 2)
                self.assertIn("val_entity_exact_f1", train_payload["datasetStats"]["metrics"])
                self.assertIn("val_entity_per_label", train_payload["datasetStats"]["metrics"])
                self.assertTrue((model_root / "staged" / version / "extractor.onnx").exists())

                promote_result = subprocess.run(
                    [
                        sys.executable,
                        str(ML_SERVICE_ROOT / "tools" / "promote_bundle.py"),
                        version,
                        "--model-root",
                        str(model_root),
                    ],
                    cwd=REPO_ROOT,
                    check=True,
                    capture_output=True,
                    text=True,
                )
                promote_payload = json.loads(promote_result.stdout)
                self.assertTrue(promote_payload["promoted"])
                promoted_metadata = json.loads(
                    (model_root / "current" / "metadata.json").read_text(encoding="utf-8"),
                )
                self.assertEqual(promoted_metadata["modelVersion"], version)
                self.assertEqual(promoted_metadata["datasetSource"], str(dataset_path))
                self.assertTrue(promoted_metadata["datasetLineage"]["rawGoldRowsIncluded"])
                self.assertEqual(promoted_metadata["datasetLineage"]["rawGoldRowsScanned"], 2)
                self.assertEqual(promoted_metadata["datasetLineage"]["rowsLoadedForBundle"], 2)
                self.assertEqual(promoted_metadata["datasetLineage"]["rowsUsedForTraining"], 1)
                self.assertEqual(promoted_metadata["datasetLineage"]["validationRows"], 1)
                self.assertEqual(promoted_metadata["datasetLineage"]["quarantinedRowsExcluded"], 0)


if __name__ == "__main__":
    unittest.main()
