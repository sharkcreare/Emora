# -*- coding: utf-8 -*-
"""一次性验证：纯 Python tokenizer + Chinese-CLIP 文本编码器 → 512 维向量。
运行：python tools/verify_text_encoder.py
"""
import json
import os
import math
import sys

import onnxruntime as ort

TEMP = os.environ.get("TEMP", "/tmp")
TOKENIZER_JSON = os.path.join(TEMP, "clip-tokenizer.json")
TEXT_ONNX = os.path.join(
    TEMP, "emoji-assistant-models", "chinese-clip-vit-base-patch16", "cn_clip_text.onnx"
)

MAX_LEN = 52


def load_tokenizer(path):
    d = json.load(open(path, encoding="utf-8"))
    vocab = d["model"]["vocab"]  # token -> id
    # added_tokens 的 id 可能超出 vocab 的 key 范围，这里按 added_tokens 显式并入
    for t in d.get("added_tokens", []):
        if str(t["id"]) not in vocab:
            vocab[t["content"]] = t["id"]
    id2tok = {v: k for k, v in vocab.items()}
    model = d["model"]
    return vocab, id2tok, model


def tokenize(text, vocab, model):
    """最小 BERT wordpiece tokenize（中文按字切分 + 英文 wordpiece）。"""
    unk = vocab.get(model.get("unk_token", "[UNK]"), 100)
    tokens = []
    # 中文/英文字符拆分：把连续 ASCII/数字 保留成词，CJK 每个字一个 token
    for ch in text.strip():
        if ord(ch) < 128 and ch not in " 　":
            tokens.append(ch)
        elif ch in " 　":
            continue
        else:
            tokens.append(ch)
    # wordpiece：尝试最长前缀匹配（对中文单字通常直接命中）
    out = []
    for tok in tokens:
        if tok in vocab:
            out.append(vocab[tok])
            continue
        # 尝试 ## 后缀
        matched = False
        for i in range(len(tok) - 1, 0, -1):
            prefix = tok[:i]
            if prefix in vocab:
                out.append(vocab[prefix])
                rest = tok[i:]
                if ("##" + rest) in vocab:
                    out.append(vocab["##" + rest])
                    matched = True
                    break
        if not matched:
            out.append(unk)
    return out


def main():
    if not os.path.exists(TOKENIZER_JSON):
        print("缺少 tokenizer.json，请先下载到", TOKENIZER_JSON)
        sys.exit(1)
    if not os.path.exists(TEXT_ONNX):
        print("缺少文本 ONNX 模型，请先下载到", TEXT_ONNX)
        sys.exit(1)

    vocab, id2tok, model = load_tokenizer(TOKENIZER_JSON)
    session = ort.InferenceSession(TEXT_ONNX, providers=["CPUExecutionProvider"])

    prompts = [
        "一张表达无语、无奈、不想说话情绪的表情包图片",
        "一张表达开心、大笑情绪的表情包图片",
        "狗头表情包，一种用狗头表示阴阳怪气的网络梗",
        "一只可爱的猫的图片",
    ]

    for p in prompts:
        ids = tokenize(p, vocab, model)
        # [CLS] ... [SEP] [PAD]*
        cls = vocab.get("[CLS]", 101)
        sep = vocab.get("[SEP]", 102)
        pad = vocab.get("[PAD]", 0)
        ids = [cls] + ids[: MAX_LEN - 2] + [sep]
        pad_len = MAX_LEN - len(ids)
        ids += [pad] * pad_len
        mask = [1] * (MAX_LEN - pad_len) + [0] * pad_len
        import numpy as np

        feed = {
            "input_ids": np.array([ids], dtype=np.int64),
            "attention_mask": np.array([mask], dtype=np.int64),
        }
        out = session.run(None, feed)[0][0]
        norm = math.sqrt(sum(float(x) * float(x) for x in out))
        print(f"prompt: {p}")
        print(f"  tokens: {len([t for t in ids if t != pad])} (有效), 归一化范数: {norm:.6f}")
        print(f"  前5维: {[round(float(x), 4) for x in out[:5]]}")

    # 验证两个无语 prompt 的相似度 > 无语 vs 开心
    import numpy as np

    def emb(p):
        ids = tokenize(p, vocab, model)
        cls = vocab.get("[CLS]", 101)
        sep = vocab.get("[SEP]", 102)
        pad = vocab.get("[PAD]", 0)
        ids = [cls] + ids[: MAX_LEN - 2] + [sep]
        pad_len = MAX_LEN - len(ids)
        ids += [pad] * pad_len
        mask = [1] * (MAX_LEN - pad_len) + [0] * pad_len
        return session.run(
            None,
            {"input_ids": np.array([ids], dtype=np.int64), "attention_mask": np.array([mask], dtype=np.int64)},
        )[0][0]

    a = emb("一张表达无语、无奈情绪的表情包图片")
    b = emb("一张表达无语、不想说话情绪的表情包图片")
    c = emb("一张表达开心、大笑情绪的表情包图片")
    cos = lambda x, y: float(np.dot(x, y) / (np.linalg.norm(x) * np.linalg.norm(y)))
    print(f"\n无语a vs 无语b: {cos(a, b):.4f}")
    print(f"无语a vs 开心c: {cos(a, c):.4f}")
    assert cos(a, b) > cos(a, c), "语义相似度校验失败"


if __name__ == "__main__":
    main()
