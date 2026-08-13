# -*- coding: utf-8 -*-
"""M1-B 阶段2：生成 label-embeddings.json。

读取 frontend/electron/main/ai/categories.json 的标签池，
用纯 Python BERT wordpiece tokenizer（来自 HF tokenizer.json）+
Chinese-CLIP 文本编码器（cn_clip_text.onnx）把每个 textPrompt 编码成
512 维 L2 归一化向量；支持一个标签多个 prompt（模板）时取平均后再归一化。

产物：frontend/electron/main/ai/label-embeddings.json
  {
    "version": "1",
    "model": "chinese-clip-vit-base-patch16",
    "dimension": 512,
    "labels": [ { id, name, layer, category, embedding: [512] } ]
  }

依赖：onnxruntime + numpy（禁止 torch / transformers）。
运行：python tools/gen_label_embeddings.py
"""
import json
import math
import os
import sys

import numpy as np
import onnxruntime as ort

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATEGORIES = os.path.join(ROOT, "frontend", "electron", "main", "ai", "categories.json")
OUTPUT = os.path.join(ROOT, "frontend", "electron", "main", "ai", "label-embeddings.json")

TEMP = os.environ.get("TEMP", "/tmp")
TOKENIZER_JSON = os.path.join(TEMP, "clip-tokenizer.json")
TEXT_ONNX = os.path.join(
    TEMP, "emoji-assistant-models", "chinese-clip-vit-base-patch16", "cn_clip_text.onnx"
)

MODEL_ID = "chinese-clip-vit-base-patch16"
MAX_LEN = 52
DIM = 512


def load_tokenizer(path):
    """从 HF tokenizer.json 提取 vocab 与模型配置。"""
    d = json.load(open(path, encoding="utf-8"))
    vocab = dict(d["model"]["vocab"])
    for t in d.get("added_tokens", []):
        vocab.setdefault(t["content"], t["id"])
    model = d["model"]
    return vocab, model


def wordpiece_tokenize(text, vocab, model):
    """最小 BERT wordpiece tokenize：CJK 逐字 + ASCII 逐字符（中文词表按字收录）。"""
    unk = vocab.get(model.get("unk_token", "[UNK]"), 100)
    out = []
    for ch in text.strip():
        if ch in " \t\u3000":
            continue
        if ch in vocab:
            out.append(vocab[ch])
            continue
        # wordpiece 最长前缀匹配（覆盖 ## 后缀情形）
        matched = False
        for i in range(len(ch) - 1, 0, -1):
            prefix = ch[:i]
            if prefix in vocab:
                out.append(vocab[prefix])
                rest = ch[i:]
                if ("##" + rest) in vocab:
                    out.append(vocab["##" + rest])
                    matched = True
                    break
        if not matched:
            out.append(unk)
    return out


def encode_prompt(session, text, vocab, model):
    """单条 prompt → 512 维 L2 归一化向量。"""
    cls = vocab.get("[CLS]", 101)
    sep = vocab.get("[SEP]", 102)
    pad = vocab.get("[PAD]", 0)
    ids = wordpiece_tokenize(text, vocab, model)
    ids = [cls] + ids[: MAX_LEN - 2] + [sep]
    pad_len = MAX_LEN - len(ids)
    ids += [pad] * pad_len
    mask = [1] * (MAX_LEN - pad_len) + [0] * pad_len
    out = session.run(
        None,
        {
            "input_ids": np.array([ids], dtype=np.int64),
            "attention_mask": np.array([mask], dtype=np.int64),
        },
    )[0][0]
    return out / np.linalg.norm(out)  # 官方输出已归一化，这里幂等兜底


def l2_normalize(v):
    norm = np.linalg.norm(v)
    if norm < 1e-12:
        return v
    return v / norm


def main():
    if not os.path.exists(TOKENIZER_JSON):
        print(f"缺少 tokenizer.json：{TOKENIZER_JSON}")
        sys.exit(1)
    if not os.path.exists(TEXT_ONNX):
        print(f"缺少文本 ONNX 模型：{TEXT_ONNX}")
        sys.exit(1)

    vocab, model = load_tokenizer(TOKENIZER_JSON)
    session = ort.InferenceSession(TEXT_ONNX, providers=["CPUExecutionProvider"])

    cats = json.load(open(CATEGORIES, encoding="utf-8"))
    labels = cats["labels"]
    print(f"标签池：{len(labels)} 个，开始编码…")

    out_labels = []
    for i, lab in enumerate(labels):
        prompts = lab.get("textPrompts") or [lab["textPrompt"]]
        vecs = [encode_prompt(session, p, vocab, model) for p in prompts]
        avg = l2_normalize(np.mean(vecs, axis=0))
        out_labels.append(
            {
                "id": lab["id"],
                "name": lab["name"],
                "layer": lab["layer"],
                "category": lab["category"],
                "embedding": [round(float(x), 6) for x in avg],
            }
        )
        print(f"  [{i + 1}/{len(labels)}] {lab['id']} ({len(prompts)} 模板)")

    # 自校验：维度与范数
    bad = []
    for lab in out_labels:
        e = lab["embedding"]
        if len(e) != DIM:
            bad.append(f"{lab['id']}: 维度 {len(e)}")
            continue
        norm = math.sqrt(sum(x * x for x in e))
        if abs(norm - 1.0) > 1e-4:
            bad.append(f"{lab['id']}: 范数 {norm:.5f}")
    if bad:
        print("自校验失败：")
        for b in bad:
            print("  -", b)
        sys.exit(1)

    payload = {
        "version": str(cats.get("version", 1)),
        "model": MODEL_ID,
        "dimension": DIM,
        "labels": out_labels,
    }
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"\n完成：{len(out_labels)} 个标签 → {OUTPUT}")
    print(f"全部校验通过：dimension={DIM}，L2=1.0")


if __name__ == "__main__":
    main()
