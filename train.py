"""
Fine-tune google/gemma-3-270m-it on a chat JSONL dataset.
Full precision (float32), single GPU.
Exports to ONNX after training.

Usage:
    python train.py
"""

import json, os, torch
from huggingface_hub import login
from torch.utils.data import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    Trainer,
    TrainingArguments,
)

# ── Config ──────────────────────────────────────────────────────────────────
MODEL_ID = "google/gemma-3-270m-it"
data = "/home/jemin/Projects/acm-extension/dataset.jsonl"
OUTPUT_DIR = "/home/jemin/Projects/acm-extension/memoio-270m-finetuned"
ONNX_PATH = "/home/jemin/Projects/acm-extension/memoio-270m.onnx"
ONNX_INT4_PATH = "/home/jemin/Projects/acm-extension/memoio-270m-int4.onnx"
EPOCHS = 3
BATCH_SIZE = 1           # 6GB VRAM is tight
GRAD_ACCUM = 8
LR = 2e-5
MAX_SEQ_LEN = 384
# ────────────────────────────────────────────────────────────────────────────


class ChatJsonlDataset(Dataset):
    """Reads JSONL with {"messages": [...]} rows, tokenizes as chat."""

    def __init__(self, path, tokenizer, max_len):
        self.tokenizer = tokenizer
        self.max_len = max_len
        self.rows = []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    self.rows.append(json.loads(line))

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        messages = self.rows[idx]["messages"]
        text = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=False,
        )
        enc = self.tokenizer(
            text, max_length=self.max_len, truncation=True,
            add_special_tokens=False,
        )
        input_ids = enc["input_ids"]
        labels = input_ids.copy()
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "attention_mask": torch.ones(len(input_ids), dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
        }


def collate_fn(batch):
    """Pad to longest in batch."""
    max_len = max(b["input_ids"].size(0) for b in batch)
    pad_id = 0
    out = {"input_ids": [], "attention_mask": [], "labels": []}
    for b in batch:
        pad_n = max_len - b["input_ids"].size(0)
        out["input_ids"].append(
            torch.cat([b["input_ids"], torch.full((pad_n,), pad_id, dtype=torch.long)])
        )
        out["attention_mask"].append(
            torch.cat([b["attention_mask"], torch.zeros(pad_n, dtype=torch.long)])
        )
        out["labels"].append(
            torch.cat([b["labels"], torch.full((pad_n,), -100, dtype=torch.long)])
        )
    return {k: torch.stack(v) for k, v in out.items()}


def export_onnx(model, tokenizer, onnx_path):
    """Export the fine-tuned model to ONNX."""
    model.eval()
    model.cpu()  # ONNX export on CPU to avoid multi-gpu issues
    dummy = tokenizer("hello", return_tensors="pt")
    dummy_ids = dummy["input_ids"]
    dummy_mask = dummy["attention_mask"]
    torch.onnx.export(
        model,
        (dummy_ids, dummy_mask),
        onnx_path,
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "logits": {0: "batch", 1: "seq"},
        },
        opset_version=17,
    )
    print(f"ONNX exported → {onnx_path}")


def quantize_onnx_int4(onnx_in, onnx_out):
    """Quantize an ONNX model to INT4 using ONNX Runtime's MatMulNBitsQuantizer."""
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    print("Quantizing ONNX model to INT4...")
    quantizer = MatMulNBitsQuantizer(
        model=onnx_in,
        bits=4,
        block_size=128,
        is_symmetric=True,
    )
    quantizer.process()
    quantizer.model.save_model_to_file(onnx_out)
    print(f"INT4 ONNX exported → {onnx_out}")
    print(f"INT4 Model size: {os.path.getsize(onnx_out) / 1e6:.1f} MB")


def main():
    # ── HF auth (Gemma is gated) ────────────────────────────────────────
    hf_token = os.environ.get("HF_TOKEN") or None
    if hf_token:
        login(token=hf_token)

    # ── Load model & tokenizer ──────────────────────────────────────────
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, token=hf_token)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.bfloat16,
        token=hf_token,
    )

    # ── Dataset ─────────────────────────────────────────────────────────
    dataset = ChatJsonlDataset(data, tokenizer, MAX_SEQ_LEN)
    print(f"Loaded {len(dataset)} examples from {data}")

    # ── Training args (dual GPU via accelerate) ─────────────────────────
    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM,
        learning_rate=LR,
        weight_decay=0.01,
        warmup_ratio=0.1,
        logging_steps=10,
        save_strategy="epoch",
        save_total_limit=2,
        bf16=True,             # bf16 to fit in 6GB VRAM
        fp16=False,
        gradient_checkpointing=True,
        dataloader_num_workers=0,
        remove_unused_columns=False,
        report_to="none",

    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        data_collator=collate_fn,
    )

    # ── Train ───────────────────────────────────────────────────────────
    trainer.train()
    trainer.save_model(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)
    print(f"Model saved → {OUTPUT_DIR}")

    # ── ONNX export & INT4 Quantization ─────────────────────────────────
    # Only do this on the main process
    if training_args.local_rank in (-1, 0):
        export_onnx(model, tokenizer, ONNX_PATH)
        quantize_onnx_int4(ONNX_PATH, ONNX_INT4_PATH)


if __name__ == "__main__":
    main()
