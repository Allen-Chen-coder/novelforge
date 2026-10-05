#!/usr/bin/env python
"""小说生成 Agent 命令行入口。

用法示例：
    # 用真实模型（默认走 config.yaml 的 provider，如 Kimi）
    python scripts/run_novel.py --idea "废土上最后一个快递员发现包裹里是自己" --genre 科幻末世 --chapters 12

    # 离线验证流水线（不需要 API Key）
    python scripts/run_novel.py --idea "test" --chapters 3 --mock --name demo

    # 继续未完成的工程（断点续跑）
    python scripts/run_novel.py --resume --name demo
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from novel_agent.llm import LLMClient, ProviderConfig, load_config
from novel_agent.pipeline import NovelPipeline


def main() -> None:
    ap = argparse.ArgumentParser(description="自动生成小说的多智能体流水线")
    ap.add_argument("--idea", default="", help="一句话创作意图（必填，除非 --resume）")
    ap.add_argument("--genre", default="", help="题材类型，默认取 config.yaml")
    ap.add_argument("--chapters", type=int, default=None, help="目标章节数")
    ap.add_argument("--name", default="default", help="工程名（projects/<name>/）")
    ap.add_argument("--config", default=str(ROOT / "config.yaml"))
    ap.add_argument("--mock", action="store_true", help="离线 mock 模式，不调用真实 API")
    ap.add_argument("--resume", action="store_true", help="断点续跑已有工程")
    ap.add_argument("--reward-gate", action="store_true",
                    help="开启 RM 修订验收门：修订稿评分不提升则拒收（judge 可经模型路由配置独立模型）")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    provider, raw = load_config(args.config)
    if args.mock:
        provider.model = "mock"
    if not args.resume and not args.idea:
        ap.error("非 --resume 模式必须提供 --idea")

    genre = args.genre or raw.get("pipeline", {}).get("genre", "")
    project_dir = ROOT / raw.get("pipeline", {}).get("project_dir", "projects") / args.name

    llm = LLMClient(provider)
    cfg = dict(raw.get("pipeline", {}))
    if args.reward_gate:
        cfg["reward_gate"] = True
    pipeline = NovelPipeline(llm, project_dir, cfg, on_progress=print)

    if args.resume:
        print(f"续跑工程：{project_dir}")
        bible = pipeline.run(idea="(resume)", genre=genre, target_chapters=args.chapters)
    else:
        print(f"新工程：{project_dir}")
        print(f"创作意图：{args.idea}")
        bible = pipeline.run(idea=args.idea, genre=genre, target_chapters=args.chapters)

    print("\n=== 完成 ===")
    print(f"书名：《{bible.data['title']}》  共 {bible.chapter_count} 章")
    print(f"工程目录：{project_dir}")
    print(f"- full_novel.md / .txt / .docx 已导出")
    print(f"- story_bible.json / plan.json 可用于微调数据集构建（scripts/build_finetune_data.py）")


if __name__ == "__main__":
    main()
