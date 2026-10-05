#!/usr/bin/env python
"""从小说工程构建微调数据集。

产出：
    out/sft_messages.jsonl  —— OpenAI messages 格式 SFT 样本（章节任务 -> 终稿）
    out/dpo_pairs.jsonl     —— DPO 偏好对（chosen=终稿 / rejected=初稿，需 --dpo 显式开启）
    out/raw_corpus.txt      —— 纯正文语料（LoRA / 继续预训练用）

DPO 样本来自流水线的 draft 历史（story_bible.json 中每章的 drafts 字段），
只有真正触发过修订循环的章节才会产出偏好对。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from novel_agent.finetune.dataset import (
    build_dpo_dataset,
    build_sft_dataset,
    export_raw_corpus,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="工程目录，如 projects/demo")
    ap.add_argument("--out", default=None, help="输出目录，默认 <project>/finetune_data")
    ap.add_argument("--dpo", action="store_true", help="同时构建 DPO 偏好对（需工程含 draft 历史）")
    args = ap.parse_args()

    project = Path(args.project)
    if not project.is_absolute():
        project = ROOT / project
    out = Path(args.out) if args.out else project / "finetune_data"
    if not out.is_absolute():
        out = ROOT / out

    n1 = build_sft_dataset(project, out / "sft_messages.jsonl")
    n2 = export_raw_corpus(project, out / "raw_corpus.txt")
    print(f"SFT 样本：{n1} 条 -> {out / 'sft_messages.jsonl'}")
    print(f"正文语料：{n2} 章 -> {out / 'raw_corpus.txt'}")
    if args.dpo:
        n3 = build_dpo_dataset(project, out / "dpo_pairs.jsonl")
        print(f"DPO 偏好对：{n3} 对 -> {out / 'dpo_pairs.jsonl'}")
        if n3 == 0:
            print("提示：0 对通常是工程没有 draft 历史（旧工程）或未触发修订循环。")


if __name__ == "__main__":
    main()
