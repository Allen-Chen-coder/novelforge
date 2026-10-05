#!/usr/bin/env python
"""云端微调：上传数据集 -> 创建任务 -> 轮询 -> 输出微调后模型名。

示例：
    python scripts/cloud_finetune.py upload --file projects/demo/finetune_data/sft_messages.jsonl
    python scripts/cloud_finetune.py create --file file-xxx --model qwen2.5-7b-instruct --suffix my-novel-style
    python scripts/cloud_finetune.py wait --job ftjob-xxx
    python scripts/cloud_finetune.py list
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from novel_agent.finetune.cloud import FineTuneClient


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_up = sub.add_parser("upload", help="上传训练集 JSONL")
    p_up.add_argument("--file", required=True)

    p_cr = sub.add_parser("create", help="创建微调任务")
    p_cr.add_argument("--file", required=True, help="已上传的 file_id")
    p_cr.add_argument("--model", required=True, help="基础模型，如 qwen2.5-7b-instruct / gpt-4o-mini")
    p_cr.add_argument("--suffix", default="novel-style")
    p_cr.add_argument("--lr", type=float, default=None, help="学习率，如 2e-5")

    p_wt = sub.add_parser("wait", help="轮询任务直到结束")
    p_wt.add_argument("--job", required=True)
    p_wt.add_argument("--poll", type=int, default=60)

    sub.add_parser("list", help="列出最近任务")

    args = ap.parse_args()
    client = FineTuneClient.from_env()

    if args.cmd == "upload":
        fid = client.upload_file(Path(args.file))
        print(f"file_id = {fid}")
    elif args.cmd == "create":
        hp = {"learning_rate_multiplier": args.lr} if args.lr else None
        job = client.create_job(args.file, args.model, args.suffix, hp)
        print(json.dumps(job, ensure_ascii=False, indent=2))
        print(f"\njob_id = {job['id']}  （用 wait 子命令轮询）")
    elif args.cmd == "wait":
        job = client.wait_job(args.job, poll_seconds=args.poll)
        print(json.dumps(job, ensure_ascii=False, indent=2))
        ft_model = job.get("fine_tuned_model")
        if job.get("status") == "succeeded" and ft_model:
            print(f"\n微调完成。把 config.yaml 的 provider.model 改为: {ft_model}")
    elif args.cmd == "list":
        for j in client.list_jobs():
            print(f"{j.get('id')}  {j.get('status')}  model={j.get('model')} -> {j.get('fine_tuned_model','')}")


if __name__ == "__main__":
    main()
