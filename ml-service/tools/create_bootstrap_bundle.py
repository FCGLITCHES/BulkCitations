"""Generate a tiny staged ONNX bundle that fits the committed fixture dataset."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import shutil
import sys
from collections import OrderedDict
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

from app.bundle_validation import validate_bundle_dir
from app.metrics import summarize_predictions
from app.preprocessing import DEFAULT_PREPROCESSING_SPEC, normalize_inference_text
from app.training_dataset import TrainingRow, load_training_jsonl

PRETOKENIZER = PretokenizerSequence(
    [WhitespaceSplit(), Punctuation(behavior="isolated")]
)
DEFAULT_MODEL_VERSION = "bootstrap-fixture-onnx-v1"
DEFAULT_FEATURE_VERSION = "plain-text-bootstrap-v1"
SPECIAL_TOKENS = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"]
FIELD_LABELS = OrderedDict(
    [
        ("authors", "author"),
        ("editors", "editors"),
        ("year", "year"),
        ("title", "title"),
        ("journal", "journal"),
        ("conferenceTitle", "conference_title"),
        ("bookTitle", "book_title"),
        ("publisher", "publisher"),
        ("institution", "institution"),
        ("edition", "edition"),
        ("thesisType", "thesis_type"),
        ("repository", "repository"),
        ("articleNumber", "article_number"),
        ("accessedDate", "accessed_date"),
        ("siteName", "site_name"),
        ("database", "database"),
        ("reportNumber", "report_number"),
        ("volume", "volume"),
        ("issue", "issue"),
        ("pages", "pages"),
        ("doi", "doi"),
        ("url", "url"),
    ]
)
FIELD_SEARCH_ORDER = list(FIELD_LABELS.keys())


class TinyTokenClassifier(nn.Module):
    def __init__(self, vocab_size: int, num_labels: int, pad_id: int) -> None:
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, 64, padding_idx=pad_id)
        self.encoder = nn.LSTM(
            64,
            64,
            batch_first=True,
            bidirectional=True,
        )
        self.classifier = nn.Linear(128, num_labels)

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
    parser.add_argument("jsonl", help="Path to flat training-export JSONL")
    parser.add_argument("--model-root", default=str(ML_SERVICE_ROOT / "models"))
    parser.add_argument("--version", default=DEFAULT_MODEL_VERSION)
    parser.add_argument("--feature-version", default=DEFAULT_FEATURE_VERSION)
    parser.add_argument("--epochs", type=int, default=600)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def pretokenize(text: str) -> list[str]:
    return [piece for piece, _offsets in PRETOKENIZER.pre_tokenize_str(text)]


def build_tokenizer(rows: list[TrainingRow]) -> tuple[PreTrainedTokenizerFast, dict[str, int]]:
    vocab: OrderedDict[str, int] = OrderedDict((token, index) for index, token in enumerate(SPECIAL_TOKENS))

    def add_text(text: str) -> None:
        for token in pretokenize(text):
            vocab.setdefault(token, len(vocab))

    for row in rows:
        add_text(row["raw_text"])
        for value in row["expected_fields"].values():
            if isinstance(value, list):
                for item in value:
                    if item is None:
                        continue
                    add_text(str(item))
            elif value is not None:
                add_text(str(value))

    tokenizer = Tokenizer(WordLevel(dict(vocab), unk_token="[UNK]"))
    tokenizer.pre_tokenizer = PRETOKENIZER
    tokenizer.post_processor = TemplateProcessing(
        single="[CLS] $A [SEP]",
        pair="[CLS] $A [SEP] $B:1 [SEP]:1",
        special_tokens=[
            ("[CLS]", vocab["[CLS]"]),
            ("[SEP]", vocab["[SEP]"]),
        ],
    )

    fast_tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=tokenizer,
        unk_token="[UNK]",
        pad_token="[PAD]",
        cls_token="[CLS]",
        sep_token="[SEP]",
        mask_token="[MASK]",
    )
    fast_tokenizer.model_max_length = 256
    return fast_tokenizer, dict(vocab)


def build_label_maps() -> tuple[dict[int, str], dict[str, int]]:
    id2label: dict[int, str] = {0: "O"}
    for core_label in FIELD_LABELS.values():
        if f"B-{core_label}" not in id2label.values():
            next_index = len(id2label)
            id2label[next_index] = f"B-{core_label}"
            id2label[next_index + 1] = f"I-{core_label}"
    label2id = {label: index for index, label in id2label.items()}
    return id2label, label2id


def coerce_field_values(field_name: str, value: Any) -> list[str]:
    if value is None:
        return []
    if field_name in {"authors", "editors"}:
        if isinstance(value, list):
            return [str(item) for item in value if item is not None]
        return [str(value)]
    if isinstance(value, list):
        return [str(item) for item in value if item is not None]
    return [str(value)]


def find_subsequence(
    haystack: list[str],
    needle: list[str],
    start_index: int,
) -> tuple[int, int] | None:
    if not needle:
        return None
    max_start = len(haystack) - len(needle)
    for start in range(start_index, max_start + 1):
        if haystack[start : start + len(needle)] == needle:
            return start, start + len(needle)
    return None


def label_row(
    row: TrainingRow,
    tokenizer: PreTrainedTokenizerFast,
    label2id: dict[str, int],
) -> tuple[str, list[int], list[int], list[int]]:
    raw_text = normalize_inference_text(row["raw_text"], DEFAULT_PREPROCESSING_SPEC)
    raw_tokens = tokenizer.tokenize(raw_text)
    label_names = ["O"] * len(raw_tokens)
    search_cursor = 0

    for field_name in FIELD_SEARCH_ORDER:
        if field_name not in row["expected_fields"]:
            continue
        values = coerce_field_values(field_name, row["expected_fields"][field_name])
        if not values:
            continue

        for value in values:
            normalized_value = normalize_inference_text(value, DEFAULT_PREPROCESSING_SPEC)
            value_tokens = tokenizer.tokenize(normalized_value)
            match = find_subsequence(raw_tokens, value_tokens, search_cursor)
            if match is None:
                match = find_subsequence(raw_tokens, value_tokens, 0)
            if match is None:
                raise ValueError(
                    f"Could not align field '{field_name}' value '{value}' in text '{row['raw_text']}'"
                )

            start, end = match
            core_label = FIELD_LABELS[field_name]
            label_names[start] = f"B-{core_label}"
            for index in range(start + 1, end):
                label_names[index] = f"I-{core_label}"
            search_cursor = end

    encoded = tokenizer(
        raw_text,
        add_special_tokens=True,
        truncation=True,
        max_length=min(int(tokenizer.model_max_length or 256), 256),
    )
    input_ids = list(encoded["input_ids"])
    attention_mask = list(encoded["attention_mask"])
    token_type_ids = list(encoded.get("token_type_ids", [0] * len(input_ids)))

    labels = [label2id["O"], *[label2id[name] for name in label_names], label2id["O"]]
    if len(labels) != len(input_ids):
        raise ValueError(
            f"Label alignment failed for '{row['raw_text']}' ({len(labels)} labels vs {len(input_ids)} ids)"
        )

    return raw_text, input_ids, attention_mask, token_type_ids, labels


def pad_batch(items: list[list[int]], pad_value: int) -> torch.Tensor:
    max_length = max(len(item) for item in items)
    output = torch.full((len(items), max_length), pad_value, dtype=torch.long)
    for row_index, item in enumerate(items):
        output[row_index, : len(item)] = torch.tensor(item, dtype=torch.long)
    return output


def build_training_tensors(
    rows: list[TrainingRow],
    tokenizer: PreTrainedTokenizerFast,
    label2id: dict[str, int],
) -> tuple[list[TrainingRow], torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    prepared_rows: list[TrainingRow] = []
    input_ids_rows: list[list[int]] = []
    attention_mask_rows: list[list[int]] = []
    token_type_rows: list[list[int]] = []
    label_rows: list[list[int]] = []

    for row in rows:
        prepared_row, input_ids, attention_mask, token_type_ids, labels = label_row(
            row,
            tokenizer,
            label2id,
        )
        prepared_rows.append(
            {
                **row,
                "raw_text": prepared_row,
            }
        )
        input_ids_rows.append(input_ids)
        attention_mask_rows.append(attention_mask)
        token_type_rows.append(token_type_ids)
        label_rows.append(labels)

    pad_id = tokenizer.pad_token_id
    if pad_id is None:
        raise ValueError("Tokenizer is missing a pad token id")

    input_ids = pad_batch(input_ids_rows, pad_id)
    attention_mask = pad_batch(attention_mask_rows, 0)
    token_type_ids = pad_batch(token_type_rows, 0)
    labels = pad_batch(label_rows, -100)
    return prepared_rows, input_ids, attention_mask, token_type_ids, labels


def train_model(
    model: TinyTokenClassifier,
    input_ids: torch.Tensor,
    attention_mask: torch.Tensor,
    token_type_ids: torch.Tensor,
    labels: torch.Tensor,
    epochs: int,
) -> TinyTokenClassifier:
    optimizer = torch.optim.Adam(model.parameters(), lr=0.02)
    loss_fn = nn.CrossEntropyLoss(ignore_index=-100)

    for epoch in range(epochs):
        model.train()
        optimizer.zero_grad()
        logits = model(input_ids, attention_mask, token_type_ids)
        loss = loss_fn(logits.view(-1, logits.shape[-1]), labels.view(-1))
        loss.backward()
        optimizer.step()

        with torch.no_grad():
            predictions = logits.argmax(dim=-1)
            mask = labels != -100
            if torch.equal(predictions[mask], labels[mask]):
                return model.eval()

    raise RuntimeError("Bootstrap bundle training did not converge to a perfect fixture fit")


def save_bundle(
    bundle_dir: Path,
    model: TinyTokenClassifier,
    tokenizer: PreTrainedTokenizerFast,
    id2label: dict[int, str],
    label2id: dict[str, int],
    rows: list[TrainingRow],
    dataset_hash: str,
    model_version: str,
    feature_version: str,
    sample_inputs: tuple[torch.Tensor, torch.Tensor, torch.Tensor],
) -> None:
    if bundle_dir.exists():
        shutil.rmtree(bundle_dir)
    bundle_dir.mkdir(parents=True, exist_ok=True)

    config = BertConfig(
        vocab_size=tokenizer.vocab_size,
        hidden_size=128,
        num_hidden_layers=1,
        num_attention_heads=2,
        intermediate_size=256,
        max_position_embeddings=256,
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
    (bundle_dir / "metadata.json").write_text(
        json.dumps(
            {
                "modelVersion": model_version,
                "featureVersion": feature_version,
                "bundleClass": "bootstrap",
                "intendedUse": "development-only",
                "bundleType": "token-classification",
                "framework": "pytorch",
                "runtimeTarget": "onnxruntime-cpu",
                "datasetHash": dataset_hash,
                "trainedRows": len(rows),
                "id2label": {str(index): label for index, label in id2label.items()},
                "label2id": label2id,
                "generator": "create_bootstrap_bundle.py",
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    (bundle_dir / "feature_manifest.json").write_text(
        json.dumps(
            {
                "featureVersion": feature_version,
                "exportSchemaVersion": "training-export-v1",
                "datasetHash": dataset_hash,
                "preprocessingVersion": preprocessing_spec["version"],
                "inputFormat": "flat-jsonl",
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    (bundle_dir / "optimization_manifest.json").write_text(
        json.dumps(
            {
                "graphOptimized": False,
                "quantization": "none",
                "offlineOptimized": False,
                "provider": "CPUExecutionProvider",
                "notes": "Bootstrap fixture bundle generated in-repo for validation and smoke coverage.",
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )

    input_ids, attention_mask, token_type_ids = sample_inputs
    model.eval()
    torch.onnx.export(
        model,
        (input_ids, attention_mask, token_type_ids),
        bundle_dir / "extractor.onnx",
        input_names=["input_ids", "attention_mask", "token_type_ids"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "token_type_ids": {0: "batch", 1: "sequence"},
            "logits": {0: "batch", 1: "sequence"},
        },
        opset_version=17,
        dynamo=False,
    )


def evaluate_bundle(bundle_dir: Path, rows: list[TrainingRow]) -> dict[str, Any]:
    os.environ["MODEL_DIR"] = str(bundle_dir)

    from app.main import _build_extract_result, _load_extractor_runtime
    from app.models.loader import registry

    registry.clear_extractor_cache()
    runtime = _load_extractor_runtime(require_onnx=True)
    predictions: list[dict[str, Any]] = []
    for row in rows:
        result = _build_extract_result(
            row["raw_text"],
            row.get("expected_style") or "unknown",
            runtime,
            require_onnx=True,
        )
        predictions.append({"fields": result.fields})
    return summarize_predictions(rows, predictions)


def main() -> int:
    args = parse_args()
    set_seed(args.seed)

    try:
        import onnx  # noqa: F401
    except Exception as exc:
        raise RuntimeError(
            "The 'onnx' package is required to generate the bootstrap bundle. Install ml-service/requirements.txt first."
        ) from exc

    rows = load_training_jsonl(args.jsonl)
    if not rows:
        raise RuntimeError("Training JSONL is empty")

    tokenizer, vocab = build_tokenizer(rows)
    id2label, label2id = build_label_maps()
    prepared_rows, input_ids, attention_mask, token_type_ids, labels = (
        build_training_tensors(rows, tokenizer, label2id)
    )

    pad_id = tokenizer.pad_token_id
    if pad_id is None:
        raise RuntimeError("Tokenizer pad token id is missing")

    model = TinyTokenClassifier(
        vocab_size=len(vocab),
        num_labels=len(id2label),
        pad_id=pad_id,
    )
    trained_model = train_model(
        model,
        input_ids,
        attention_mask,
        token_type_ids,
        labels,
        epochs=args.epochs,
    )

    dataset_hash = hashlib.sha256(Path(args.jsonl).read_bytes()).hexdigest()
    model_root = Path(args.model_root)
    bundle_dir = model_root / "staged" / args.version
    save_bundle(
        bundle_dir=bundle_dir,
        model=trained_model,
        tokenizer=tokenizer,
        id2label=id2label,
        label2id=label2id,
        rows=prepared_rows,
        dataset_hash=dataset_hash,
        model_version=args.version,
        feature_version=args.feature_version,
        sample_inputs=(
            input_ids[:1],
            attention_mask[:1],
            token_type_ids[:1],
        ),
    )

    validation = validate_bundle_dir(bundle_dir)
    if not validation["valid"]:
        print(json.dumps(validation, indent=2, sort_keys=True), file=sys.stderr)
        return 1

    summary = evaluate_bundle(bundle_dir, prepared_rows)
    print(
        json.dumps(
            {
                "bundleDir": str(bundle_dir),
                "datasetHash": dataset_hash,
                "modelVersion": args.version,
                "featureVersion": args.feature_version,
                "validation": validation,
                "evaluation": summary,
            },
            indent=2,
            sort_keys=True,
        )
    )

    if summary["row_exact_rate"] < 1.0 or summary["field_exact_rate"] < 1.0:
        print("Bootstrap bundle did not achieve exact fixture parity.", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
