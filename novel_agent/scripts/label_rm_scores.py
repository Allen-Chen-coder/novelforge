#!/usr/bin/env python
"""给 DPO 偏好对跑写作 RM 评审，产出带分数的 rm_pairs.jsonl。

用法：
    # 真实模型（走 config.yaml 的 provider）
    python scripts/label_rm_scores.py --pairs out/dpo_pairs.jsonl --out out/rm_pairs.jsonl

    # 离线 mock 验证
    python scripts/label_rm_scores.py --pairs out/dpo_pairs.jsonl --out out/rm_pairs.jsonl --mock

产出：每对附加 "rm" 字段（draft/revised 五维分数、总分、差值 margin、improved）。
可用 --min-margin 过滤「修订其实没变好」的噪声对（RM 判定 improved 且分差达标才保留），
过滤后的数据可直接进 DPO / RewardTrainer 训练。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from novel_agent.llm import LLMClient, ProviderConfig, load_config
from novel_agent.finetune.rm import WritingRMJudge


def _extract_goal(user_text: str) -> str:
    m = re.search(r"目标：(.{0,80}?)\s*冲突：", user_text, re.S)
    return m.group(1).strip() if m else ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", required=True, help="dpo_pairs.jsonl 路径")
    ap.add_argument("--out", required=True, help="输出 rm_pairs.jsonl 路径")
    ap.add_argument("--config", default=str(ROOT / "config.yaml"))
    ap.add_argument("--mock", action="store_true", help="离线 mock，不调用真实 API")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 对（调试用）")
    ap.add_argument("--min-margin", type=int, default=None,
                    help="过滤：只保留 RM 判定 improved 且总分差 >= N 的对（不填则全部保留）")
    args = ap.parse_args()

    if args.mock:
        provider = ProviderConfig(model="mock")
    else:
        provider, _ = load_config(args.config)
    judge = WritingRMJudge(LLMClient(provider))

    pairs_path, out_path = Path(args.pairs), Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    total = kept = failed = 0
    with open(pairs_path, encoding="utf-8") as fin, open(out_path, "w", encoding="utf-8") as fout:
        for line in fin:
            line = line.strip()
            if not line:
                continue
            if args.limit and total >= args.limit:
                break
            pair = json.loads(line)
            total += 1
            try:
                user_text = next(
                    (m["content"] for m in pair["prompt"] if m["role"] == "user"), ""
                )
                verdict = judge.compare_texts(
                    goal=_extract_goal(user_text),
                    draft=pair["rejected"][0]["content"],
                    revised=pair["chosen"][0]["content"],
                )
                pair["rm"] = {
                    "draft_total": verdict.draft_total,
                    "revised_total": verdict.revised_total,
                    "margin": verdict.margin,
                    "improved": verdict.improved,
                    "reason": verdict.reason,
                    "draft_scores": verdict.draft_scores,
                    "revised_scores": verdict.revised_scores,
                }
            except Exception as e:
                failed += 1
                print(f"[warn] 第 {total} 对评审失败：{e}", file=sys.stderr)
                pair["rm"] = None
            if args.min_margin is not None:
                rm = pair.get("rm") or {}
                if not (rm.get("improved") and rm.get("margin", 0) >= args.min_margin):
                    continue
            fout.write(json.dumps(pair, ensure_ascii=False) + "\n")
            kept += 1
    print(f"评审 {total} 对（失败 {failed}），保留 {kept} 对 -> {out_path}")


if __name__ == "__main__":
    main()
