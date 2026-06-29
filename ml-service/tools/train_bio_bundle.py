"""Train a token-classification ONNX bundle from BIO-annotated gold NDJSON."""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import sys
from collections import Counter, OrderedDict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import torch
from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import Punctuation, Sequence as PretokenizerSequence
from tokenizers.pre_tokenizers import WhitespaceSplit
from tokenizers.processors import TemplateProcessing
from torch import nn
from transformers import BertConfig, PreTrainedTokenizerFast

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))

from app.bio_training_dataset import CANONICAL_BIO_LABELS, load_bio_gold_jsonl  # noqa: E402
from app.bundle_validation import validate_bundle_dir  # noqa: E402
from app.dataset_paths import resolve_bio_gold_jsonl_path  # noqa: E402
from app.preprocessing import DEFAULT_PREPROCESSING_SPEC  # noqa: E402

PRETOKENIZER = PretokenizerSequence(
    [WhitespaceSplit(), Punctuation(behavior="isolated")]
)
SPECIAL_TOKENS = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"]
DEFAULT_MODEL_VERSION = "bio-gold-local-v1"
DEFAULT_FEATURE_VERSION = "plain-text-bio-v1"


class TinyTokenClassifier(nn.Module):
    def __init__(self, vocab_size: int, num_labels: int, pad_id: int) -> None:
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, 96, padding_idx=pad_id)
        self.encoder = nn.LSTM(
            96,
            96,
            batch_first=True,
            bidirectional=True,
        )
        self.classifier = nn.Linear(192, num_labels)

    def forward(  # type: ignore[override]
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor | None = None,
        token_type_ids: torch.Tensor | None = None,
    ) -> torch.Tensor:
        del attention_mask
        del token_type_ids
        embedded = self.embedding(input_ids)
        encoded, _ = self.encoder(embedded)
        return self.classifier(encoded)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("jsonl", help="BIO gold NDJSON path")
    parser.add_argument("--model-root", default=str(ML_SERVICE_ROOT / "models"))
    parser.add_argument("--version", default=DEFAULT_MODEL_VERSION)
    parser.add_argument("--feature-version", default=DEFAULT_FEATURE_VERSION)
    parser.add_argument("--epochs", type=int, default=280)
    parser.add_argument("--seed", type=int, default=11)
    parser.add_argument(
        "--max-length",
        type=int,
        default=256,
        help="Maximum sequence length for tokenizer + model export",
    )
    parser.add_argument(
        "--dataset-track",
        default="citation-bio-gold",
        help="Dataset track marker stored in metadata (keeps BIO gold separate from other ML truth exports).",
    )
    return parser.parse_args()


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def build_label_maps() -> tuple[dict[int, str], dict[str, int]]:
    id2label: dict[int, str] = {0: "O"}
    for core_label in CANONICAL_BIO_LABELS:
        next_index = len(id2label)
        id2label[next_index] = f"B-{core_label}"
        id2label[next_index + 1] = f"I-{core_label}"
    label2id = {label: index for index, label in id2label.items()}
    return id2label, label2id


def build_tokenizer(rows: list[dict[str, Any]], max_length: int) -> tuple[PreTrainedTokenizerFast, dict[str, int]]:
    vocab: OrderedDict[str, int] = OrderedDict((token, index) for index, token in enumerate(SPECIAL_TOKENS))
    for row in rows:
        for token in row["bio_tokens"]:
            if isinstance(token, str) and token.strip():
                vocab.setdefault(token, len(vocab))

    tokenizer = Tokenizer(WordLevel(dict(vocab), unk_token="[UNK]"))
    tokenizer.pre_tokenizer = PRETOKENIZER
    tokenizer.post_processor = TemplateProcessing(
        single="[CLS] $A [SEP]",
        pair="[CLS] $A [SEP] $B:1 [SEP]:1",
        special_tokens=[("[CLS]", vocab["[CLS]"]), ("[SEP]", vocab["[SEP]"])],
    )

    fast_tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=tokenizer,
        unk_token="[UNK]",
        pad_token="[PAD]",
        cls_token="[CLS]",
        sep_token="[SEP]",
        mask_token="[MASK]",
    )
    fast_tokenizer.model_max_length = max_length
    return fast_tokenizer, dict(vocab)


def pad_batch(items: list[list[int]], pad_value: int) -> torch.Tensor:
    max_length = max(len(item) for item in items)
    output = torch.full((len(items), max_length), pad_value, dtype=torch.long)
    for row_index, item in enumerate(items):
        output[row_index, : len(item)] = torch.tensor(item, dtype=torch.long)
    return output


def align_row(
    row: dict[str, Any],
    tokenizer: PreTrainedTokenizerFast,
    label2id: dict[str, int],
) -> tuple[list[int], list[int], list[int], list[int]]:
    raw_text = row["raw_text"]
    bio_tags = row["bio_tags"]
    encoded_tokens = tokenizer.tokenize(raw_text)

    source_tokens = row["bio_tokens"]
    normalized_labels = ["O"] * len(encoded_tokens)

    cursor = 0
    for source_token, tag in zip(source_tokens, bio_tags, strict=True):
        source_tokenized = tokenizer.tokenize(source_token)
        if not source_tokenized:
            continue

        matched = False
        for start in range(cursor, len(encoded_tokens) - len(source_tokenized) + 1):
            if encoded_tokens[start : start + len(source_tokenized)] == source_tokenized:
                if tag != "O":
                    prefix, core = tag.split("-", 1)
                    normalized_labels[start] = f"B-{core}" if prefix == "B" else f"I-{core}"
                    for idx in range(start + 1, start + len(source_tokenized)):
                        normalized_labels[idx] = f"I-{core}"
                cursor = start + len(source_tokenized)
                matched = True
                break
        if not matched:
            for start in range(0, len(encoded_tokens) - len(source_tokenized) + 1):
                if encoded_tokens[start : start + len(source_tokenized)] == source_tokenized:
                    if tag != "O":
                        prefix, core = tag.split("-", 1)
                        normalized_labels[start] = f"B-{core}" if prefix == "B" else f"I-{core}"
                        for idx in range(start + 1, start + len(source_tokenized)):
                            normalized_labels[idx] = f"I-{core}"
                    cursor = start + len(source_tokenized)
                    matched = True
                    break
        if not matched:
            continue

    encoded = tokenizer(
        raw_text,
        add_special_tokens=True,
        truncation=True,
        max_length=min(int(tokenizer.model_max_length or 256), 512),
    )
    input_ids = list(encoded["input_ids"])
    attention_mask = list(encoded["attention_mask"])
    token_type_ids = list(encoded.get("token_type_ids", [0] * len(input_ids)))

    labels = [label2id["O"], *[label2id.get(name, label2id["O"]) for name in normalized_labels], label2id["O"]]
    if len(labels) != len(input_ids):
        target_length = min(len(labels), len(input_ids))
        labels = labels[:target_length]
        input_ids = input_ids[:target_length]
        attention_mask = attention_mask[:target_length]
        token_type_ids = token_type_ids[:target_length]

    return input_ids, attention_mask, token_type_ids, labels


def build_training_tensors(
    rows: list[dict[str, Any]],
    tokenizer: PreTrainedTokenizerFast,
    label2id: dict[str, int],
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    input_ids_rows: list[list[int]] = []
    attention_mask_rows: list[list[int]] = []
    token_type_rows: list[list[int]] = []
    label_rows: list[list[int]] = []

    for row in rows:
        input_ids, attention_mask, token_type_ids, labels = align_row(row, tokenizer, label2id)
        input_ids_rows.append(input_ids)
        attention_mask_rows.append(attention_mask)
        token_type_rows.append(token_type_ids)
        label_rows.append(labels)

    pad_id = tokenizer.pad_token_id
    if pad_id is None:
        raise ValueError("Tokenizer missing pad token id")

    input_ids = pad_batch(input_ids_rows, pad_id)
    attention_mask = pad_batch(attention_mask_rows, 0)
    token_type_ids = pad_batch(token_type_rows, 0)
    labels = pad_batch(label_rows, -100)
    return input_ids, attention_mask, token_type_ids, labels


def train_model(
    model: TinyTokenClassifier,
    input_ids: torch.Tensor,
    attention_mask: torch.Tensor,
    token_type_ids: torch.Tensor,
    labels: torch.Tensor,
    epochs: int,
    batch_size: int = 128,
) -> tuple[TinyTokenClassifier, float]:
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)
    loss_fn = nn.CrossEntropyLoss(ignore_index=-100)
    best_accuracy = 0.0
    row_count = int(input_ids.shape[0])
    order = list(range(row_count))

    def batched_accuracy() -> float:
        model.eval()
        correct = total = 0
        with torch.no_grad():
            for start in range(0, row_count, batch_size):
                idx = order[start : start + batch_size]
                logits = model(input_ids[idx], attention_mask[idx], token_type_ids[idx])
                preds = logits.argmax(dim=-1)
                row_mask = labels[idx] != -100
                correct += int((preds[row_mask] == labels[idx][row_mask]).sum().item())
                total += int(row_mask.sum().item())
        return (correct / total) if total > 0 else 0.0

    for epoch in range(epochs):
        model.train()
        random.shuffle(order)
        # Mini-batch instead of full-batch: bounds peak activation memory so large datasets
        # (>700 rows) train without thrashing/timing out, and gives more gradient updates/epoch.
        for start in range(0, row_count, batch_size):
            idx = order[start : start + batch_size]
            optimizer.zero_grad()
            logits = model(input_ids[idx], attention_mask[idx], token_type_ids[idx])
            loss = loss_fn(logits.view(-1, logits.shape[-1]), labels[idx].view(-1))
            loss.backward()
            optimizer.step()
        if epoch % 10 == 0 or epoch == epochs - 1:
            best_accuracy = max(best_accuracy, batched_accuracy())

    return model.eval(), best_accuracy


def split_rows(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    buckets: dict[str, list[dict[str, Any]]] = {
        "train": [],
        "val": [],
        "test": [],
        "holdout": [],
    }
    for row in rows:
        split = (row.get("dataset_split") or "train").lower()
        if split not in buckets:
            split = "train"
        buckets[split].append(row)

    if not buckets["train"]:
        buckets["train"] = [row for row in rows if (row.get("dataset_split") or "").lower() != "holdout"]

    return buckets


def score_split(
    model: TinyTokenClassifier,
    rows: list[dict[str, Any]],
    tokenizer: PreTrainedTokenizerFast,
    label2id: dict[str, int],
) -> float:
    return score_split_metrics(model, rows, tokenizer, label2id)["token_accuracy"]


def score_split_metrics(
    model: TinyTokenClassifier,
    rows: list[dict[str, Any]],
    tokenizer: PreTrainedTokenizerFast,
    label2id: dict[str, int],
) -> dict[str, Any]:
    if not rows:
        return {
            "token_accuracy": 0.0,
            "entity_exact_precision": 0.0,
            "entity_exact_recall": 0.0,
            "entity_exact_f1": 0.0,
            "entity_true": 0,
            "entity_predicted": 0,
            "entity_correct": 0,
            "per_label": {},
        }

    id2label = {index: label for label, index in label2id.items()}
    with torch.no_grad():
        input_ids, attention_mask, token_type_ids, labels = build_training_tensors(rows, tokenizer, label2id)
        logits = model(input_ids, attention_mask, token_type_ids)
        predictions = logits.argmax(dim=-1)
        mask = labels != -100
        correct = (predictions[mask] == labels[mask]).sum().item()
        total = int(mask.sum().item())
        true_sequences: list[list[str]] = []
        pred_sequences: list[list[str]] = []
        for row_index in range(labels.shape[0]):
            row_mask = labels[row_index] != -100
            true_ids = labels[row_index][row_mask].tolist()
            pred_ids = predictions[row_index][row_mask].tolist()
            true_sequences.append([id2label.get(int(label_id), "O") for label_id in true_ids])
            pred_sequences.append([id2label.get(int(label_id), "O") for label_id in pred_ids])
        entity_metrics = compute_entity_exact_metrics(true_sequences, pred_sequences)
        return {
            "token_accuracy": float(correct / total) if total > 0 else 0.0,
            **entity_metrics,
        }


def compute_entity_exact_metrics(
    true_sequences: list[list[str]],
    pred_sequences: list[list[str]],
) -> dict[str, Any]:
    true_entities: list[tuple[str, int, int, int]] = []
    pred_entities: list[tuple[str, int, int, int]] = []
    for row_index, tags in enumerate(true_sequences):
        true_entities.extend((row_index, *entity) for entity in extract_bio_entities(tags))
    for row_index, tags in enumerate(pred_sequences):
        pred_entities.extend((row_index, *entity) for entity in extract_bio_entities(tags))

    true_set = set(true_entities)
    pred_set = set(pred_entities)
    correct_set = true_set & pred_set
    precision = len(correct_set) / len(pred_set) if pred_set else 0.0
    recall = len(correct_set) / len(true_set) if true_set else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if precision + recall > 0 else 0.0

    labels = sorted({entity[1] for entity in true_set | pred_set})
    per_label: dict[str, dict[str, Any]] = {}
    for label in labels:
        true_label = {entity for entity in true_set if entity[1] == label}
        pred_label = {entity for entity in pred_set if entity[1] == label}
        correct_label = true_label & pred_label
        label_precision = len(correct_label) / len(pred_label) if pred_label else 0.0
        label_recall = len(correct_label) / len(true_label) if true_label else 0.0
        label_f1 = (
            2 * label_precision * label_recall / (label_precision + label_recall)
            if label_precision + label_recall > 0
            else 0.0
        )
        per_label[label] = {
            "precision": round(label_precision, 4),
            "recall": round(label_recall, 4),
            "f1": round(label_f1, 4),
            "true": len(true_label),
            "predicted": len(pred_label),
            "correct": len(correct_label),
        }

    return {
        "entity_exact_precision": round(precision, 4),
        "entity_exact_recall": round(recall, 4),
        "entity_exact_f1": round(f1, 4),
        "entity_true": len(true_set),
        "entity_predicted": len(pred_set),
        "entity_correct": len(correct_set),
        "per_label": per_label,
    }


def extract_bio_entities(tags: list[str]) -> list[tuple[str, int, int]]:
    entities: list[tuple[str, int, int]] = []
    current_label: str | None = None
    start: int | None = None
    for index, tag in enumerate([*tags, "O"]):
        if tag == "O" or "-" not in tag:
            if current_label is not None and start is not None:
                entities.append((current_label, start, index))
            current_label = None
            start = None
            continue

        prefix, label = tag.split("-", 1)
        if prefix == "B" or current_label != label:
            if current_label is not None and start is not None:
                entities.append((current_label, start, index))
            current_label = label
            start = index
        elif prefix != "I":
            if current_label is not None and start is not None:
                entities.append((current_label, start, index))
            current_label = None
            start = None

    return entities


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_dataset_lineage(
    jsonl_path: str | Path,
    rows: list[dict[str, Any]],
    split_buckets: dict[str, list[dict[str, Any]]],
    dataset_track: str,
    feature_version: str,
) -> dict[str, Any]:
    file_path = resolve_bio_gold_jsonl_path(jsonl_path)
    scanned = 0
    quarantined = 0
    draft = 0
    uncertified = 0
    supported_raw_rows = 0
    with file_path.open(encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            scanned += 1
            payload = json.loads(line)
            if not isinstance(payload, dict):
                continue
            row_status = payload.get("row_status")
            trust_level = payload.get("trust_level")
            if row_status == "quarantined":
                quarantined += 1
            if trust_level == "draft":
                draft += 1
            if row_status != "quarantined" and trust_level != "draft":
                if trust_level not in {"gold", "reviewed", "certified"}:
                    uncertified += 1
                if isinstance(payload.get("raw_text") or payload.get("raw_reference"), str):
                    supported_raw_rows += 1

    input_hashes = sorted(str(row.get("input_hash") or sha256_text(str(row["raw_text"]))) for row in rows)
    raw_corpus_hash = sha256_text("\n".join(str(row["raw_text"]) for row in rows))
    return {
        "sourceDatasetName": dataset_track,
        "sourceDatasetVersion": "style-gold-supervision-jsonl",
        "sourceDatasetHash": sha256_file(file_path),
        "rawGoldInputHashesHash": sha256_text("\n".join(input_hashes)),
        "rawGoldInputHashesSample": input_hashes[:25],
        "rawGoldRowsIncluded": True,
        "rawGoldRowsScanned": scanned,
        "eligibleCertifiedRows": len(rows),
        "supportedRawRows": supported_raw_rows,
        "rowsLoadedForBundle": len(rows),
        "rowsUsedForTraining": len(split_buckets["train"]),
        "trainRows": len(split_buckets["train"]),
        "validationRows": len(split_buckets["val"]),
        "testRows": len(split_buckets["test"]),
        "holdoutRows": len(split_buckets["holdout"]),
        "draftRowsExcluded": draft,
        "quarantinedRowsExcluded": quarantined,
        "uncertifiedRowsExcluded": uncertified,
        "expectedFieldsPresent": all(isinstance(row.get("expected_fields"), dict) for row in rows),
        "entityLevelMetricsPresent": True,
        "tokenAccuracyPresent": True,
        "perFieldMetricsPresent": True,
        "labelSchemaVersion": "bio-field-spans-v1",
        "tokenizationVersion": DEFAULT_PREPROCESSING_SPEC.get("version", feature_version),
        "exporterVersion": "bio-supervision-export-v1",
        "trainingScriptVersion": "train_bio_bundle-v2",
        "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "rawTextCorpusSha256": raw_corpus_hash,
    }


def save_bundle(
    bundle_dir: Path,
    model: TinyTokenClassifier,
    tokenizer: PreTrainedTokenizerFast,
    id2label: dict[int, str],
    label2id: dict[str, int],
    version: str,
    feature_version: str,
    dataset_stats: dict[str, Any],
    dataset_lineage: dict[str, Any],
    dataset_track: str,
    dataset_source: str,
    sample_inputs: tuple[torch.Tensor, torch.Tensor, torch.Tensor],
) -> None:
    if bundle_dir.exists():
        shutil.rmtree(bundle_dir)
    bundle_dir.mkdir(parents=True, exist_ok=True)

    config = BertConfig(
        vocab_size=tokenizer.vocab_size,
        hidden_size=192,
        num_hidden_layers=1,
        num_attention_heads=3,
        intermediate_size=384,
        max_position_embeddings=512,
        type_vocab_size=2,
        num_labels=len(id2label),
        id2label={str(index): label for index, label in id2label.items()},
        label2id=label2id,
    )
    config.save_pretrained(bundle_dir)
    tokenizer.save_pretrained(bundle_dir)

    preprocessing_spec = dict(DEFAULT_PREPROCESSING_SPEC)
    preprocessing_spec["version"] = feature_version
    preprocessing_spec["tokenizerStrategy"] = "wordlevel-punctuation-v1"
    (bundle_dir / "preprocessing.json").write_text(
        json.dumps(preprocessing_spec, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    (bundle_dir / "feature_manifest.json").write_text(
        json.dumps(
            {
                "featureVersion": feature_version,
                "labelSchema": "BIO",
                "labelCount": len(id2label),
                "source": dataset_track,
                "datasetLineage": dataset_lineage,
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    (bundle_dir / "optimization_manifest.json").write_text(
        json.dumps(
            {
                "quantized": False,
                "precision": "float32",
                "graphOptimizations": ["lstm_encoder", "linear_head"],
                "trainingRows": dataset_stats["rows_total"],
                "rowsUsedForTraining": dataset_lineage["rowsUsedForTraining"],
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    (bundle_dir / "metadata.json").write_text(
        json.dumps(
            {
                "modelVersion": version,
                "featureVersion": feature_version,
                "bundleType": "token-classification",
                "bundleClass": "standard",
                "framework": "pytorch",
                "runtimeTarget": "onnxruntime-cpu",
                "id2label": {str(index): label for index, label in id2label.items()},
                "label2id": label2id,
                "datasetStats": dataset_stats,
                "datasetLineage": dataset_lineage,
                "datasetTrack": dataset_track,
                "datasetSource": dataset_source,
                "generator": "train_bio_bundle.py",
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )

    input_ids, attention_mask, token_type_ids = sample_inputs
    torch.onnx.export(
        model,
        (input_ids, attention_mask, token_type_ids),
        str(bundle_dir / "extractor.onnx"),
        input_names=["input_ids", "attention_mask", "token_type_ids"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "token_type_ids": {0: "batch", 1: "sequence"},
            "logits": {0: "batch", 1: "sequence"},
        },
        opset_version=17,
        # The dynamo exporter hard-freezes sequence length on this tiny LSTM model under
        # the local PyTorch runtime. Keep the legacy tracer here so staged BIO bundles
        # still export with dynamic sequence axes.
        dynamo=False,
    )


def main() -> None:
    args = parse_args()
    set_seed(args.seed)

    rows = load_bio_gold_jsonl(args.jsonl)
    if not rows:
        raise SystemExit("No BIO rows found in input JSONL.")

    split_buckets = split_rows(rows)
    train_rows = split_buckets["train"]
    if not train_rows:
        raise SystemExit("No train rows available after split resolution.")

    dataset_lineage = build_dataset_lineage(
        args.jsonl,
        rows,
        split_buckets,
        dataset_track=args.dataset_track,
        feature_version=args.feature_version,
    )

    id2label, label2id = build_label_maps()
    tokenizer, _vocab = build_tokenizer(rows, max_length=args.max_length)
    train_input_ids, train_attention, train_token_types, train_labels = build_training_tensors(
        train_rows,
        tokenizer,
        label2id,
    )

    model = TinyTokenClassifier(
        vocab_size=tokenizer.vocab_size,
        num_labels=len(id2label),
        pad_id=tokenizer.pad_token_id or 0,
    )
    # Bound total row-passes so large datasets finish within the admin timeout: small sets keep the
    # full epoch budget; big sets scale epochs down (mini-batching keeps convergence healthy).
    effective_epochs = min(args.epochs, max(60, 150_000 // max(1, len(train_rows))))
    model, train_accuracy_peak = train_model(
        model,
        train_input_ids,
        train_attention,
        train_token_types,
        train_labels,
        epochs=effective_epochs,
    )

    val_metrics = score_split_metrics(model, split_buckets["val"], tokenizer, label2id)
    test_metrics = score_split_metrics(model, split_buckets["test"], tokenizer, label2id)

    label_distribution = Counter(
        tag
        for row in rows
        for tag in row["bio_tags"]
    )
    dataset_stats = {
        "rows_total": len(rows),
        "rows_train": len(split_buckets["train"]),
        "rows_val": len(split_buckets["val"]),
        "rows_test": len(split_buckets["test"]),
        "rows_holdout": len(split_buckets["holdout"]),
        "dataset_lineage": dataset_lineage,
        "label_distribution": dict(sorted(label_distribution.items())),
        "metrics": {
            "train_token_accuracy_peak": round(train_accuracy_peak, 4),
            "val_token_accuracy": round(val_metrics["token_accuracy"], 4),
            "test_token_accuracy": round(test_metrics["token_accuracy"], 4),
            "val_entity_exact_precision": val_metrics["entity_exact_precision"],
            "val_entity_exact_recall": val_metrics["entity_exact_recall"],
            "val_entity_exact_f1": val_metrics["entity_exact_f1"],
            "test_entity_exact_precision": test_metrics["entity_exact_precision"],
            "test_entity_exact_recall": test_metrics["entity_exact_recall"],
            "test_entity_exact_f1": test_metrics["entity_exact_f1"],
            "val_entity_counts": {
                "true": val_metrics["entity_true"],
                "predicted": val_metrics["entity_predicted"],
                "correct": val_metrics["entity_correct"],
            },
            "test_entity_counts": {
                "true": test_metrics["entity_true"],
                "predicted": test_metrics["entity_predicted"],
                "correct": test_metrics["entity_correct"],
            },
            "val_entity_per_label": val_metrics["per_label"],
            "test_entity_per_label": test_metrics["per_label"],
        },
    }

    bundle_dir = Path(args.model_root) / "staged" / args.version
    sample_inputs = (
        train_input_ids[:1],
        train_attention[:1],
        train_token_types[:1],
    )
    save_bundle(
        bundle_dir=bundle_dir,
        model=model,
        tokenizer=tokenizer,
        id2label=id2label,
        label2id=label2id,
        version=args.version,
        feature_version=args.feature_version,
        dataset_stats=dataset_stats,
        dataset_lineage=dataset_lineage,
        dataset_track=args.dataset_track,
        dataset_source=str(Path(args.jsonl)),
        sample_inputs=sample_inputs,
    )

    validation = validate_bundle_dir(bundle_dir)
    if not validation["valid"]:
        raise RuntimeError(
            f"Trained BIO bundle failed validation: {validation['errors']}"
        )

    print(
        json.dumps(
            {
                "ok": True,
                "bundleDir": str(bundle_dir),
                "modelVersion": args.version,
                "featureVersion": args.feature_version,
                "datasetStats": dataset_stats,
                "validation": validation,
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
