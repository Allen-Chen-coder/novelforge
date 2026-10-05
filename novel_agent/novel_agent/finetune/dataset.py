"""把小说工程的产出转化为微调数据集（JSONL）。

SFT（build_sft_dataset）：
    input  = 写作系统提示词 + 章节任务卡 + 角色账本 + 伏笔台账 + 滚动摘要
    output = 终稿正文（经过审校/修订后的版本）

DPO（build_dpo_dataset）—— 让模型学会「责编指出的问题自己提前改掉」：
    流水线每章保存 draft 历史（初稿 + 每轮修订稿），初稿是被审校打出 major 问题的版本，
    终稿是修订后的版本，二者共享同一份写作 prompt，天然构成偏好对：
        chosen   = 终稿（修订后）
        rejected = 初稿（被审校判定有 major 问题）
    只保留真正触发过修订的章节（revise_rounds >= 1 且初稿非空）。

另外导出一份纯正文语料（txt），可用于继续预训练 / LoRA 风格微调。
"""
from __future__ import annotations

import json
from pathlib import Path

from .. import prompts as P
from ..memory import StoryBible


def _writer_prompt(ctx_bible: StoryBible, ch: dict, rolling_last_n: int, target_words: int) -> list[dict]:
    """重建 Writer 环节线上同分布的 prompt（system + user messages）。"""
    user = P.WRITER_USER.format(
        title=ctx_bible.data["title"],
        world_setting=ctx_bible.data["world_setting"],
        characters=ctx_bible.characters_block(),
        open_foreshadowing=ctx_bible.foreshadowing_block(),
        rolling_summary=ctx_bible.rolling_summary(rolling_last_n),
        full_summary=ctx_bible.cumulative_summary(),
        index=ch["index"],
        chapter_title=ch.get("title", ""),
        goal=ch.get("goal", ""),
        conflict=ch.get("conflict", ""),
        hook=ch.get("hook", ""),
        target_words=target_words,
        opening_note=P.opening_note(ch["index"]),
    )
    return [
        {"role": "system", "content": P.WRITER_SYSTEM},
        {"role": "user", "content": user},
    ]


def _load_project(project_dir: Path) -> tuple[StoryBible, list[dict]]:
    project_dir = Path(project_dir)
    bible = StoryBible(project_dir / "story_bible.json")
    plan = json.loads((project_dir / "plan.json").read_text(encoding="utf-8"))
    chapters_plan = [
        ch for vol in plan.get("volumes", []) for ch in vol.get("chapters", [])
    ]
    return bible, chapters_plan


def build_sft_dataset(
    project_dir: Path,
    out_path: Path,
    rolling_last_n: int = 5,
) -> int:
    """从工程目录构建 messages 格式 JSONL，返回样本数。"""
    bible, chapters_plan = _load_project(project_dir)
    records = {rec["index"]: rec for rec in bible.data["chapters"]}

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(out_path, "w", encoding="utf-8") as f:
        for ch in chapters_plan:
            rec = records.get(ch["index"])
            if not rec or not rec.get("text"):
                continue
            # 用写完本章之前的圣经状态重建写作上下文，保证样本与线上推理同分布
            ctx_bible = _snapshot_before(bible, ch["index"])
            prompt = _writer_prompt(ctx_bible, ch, rolling_last_n, len(rec["text"]) // 2)
            sample = {"messages": [*prompt, {"role": "assistant", "content": rec["text"]}]}
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")
            n += 1
    return n


def build_dpo_dataset(
    project_dir: Path,
    out_path: Path,
    rolling_last_n: int = 5,
    min_revise_rounds: int = 1,
) -> int:
    """从工程目录构建 DPO 偏好对 JSONL（TRL 格式），返回对数。

    每章最多产出一对：rejected=初稿（审校不通过），chosen=终稿。
    初稿与终稿共享同一写作 prompt，与线上 Writer 环节严格同分布。
    """
    bible, chapters_plan = _load_project(project_dir)
    records = {rec["index"]: rec for rec in bible.data["chapters"]}

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(out_path, "w", encoding="utf-8") as f:
        for ch in chapters_plan:
            rec = records.get(ch["index"])
            if not rec or not rec.get("text"):
                continue
            drafts = rec.get("drafts") or []
            if rec.get("revise_rounds", 0) < min_revise_rounds or not drafts:
                continue
            rejected = (drafts[0] or "").strip()
            chosen = (rec["text"] or "").strip()
            if not rejected or rejected == chosen:
                continue  # 无有效对照（如 mock 环境修订稿退化）
            ctx_bible = _snapshot_before(bible, ch["index"])
            prompt = _writer_prompt(ctx_bible, ch, rolling_last_n, len(chosen) // 2)
            sample = {
                "prompt": prompt,
                "chosen": [{"role": "assistant", "content": chosen}],
                "rejected": [{"role": "assistant", "content": rejected}],
                # 元信息：训练时剔除，供筛选/分析
                "meta": {
                    "project": Path(project_dir).name,
                    "chapter": ch["index"],
                    "revise_rounds": rec.get("revise_rounds", 0),
                    "major_issues": rec.get("issues", []),
                },
            }
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")
            n += 1
    return n


def export_raw_corpus(project_dir: Path, out_path: Path) -> int:
    """导出纯正文语料（每章一段），用于 LoRA / 继续预训练。"""
    project_dir = Path(project_dir)
    bible = StoryBible(project_dir / "story_bible.json")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    texts = [rec.get("text", "") for rec in bible.data["chapters"] if rec.get("text")]
    out_path.write_text("\n\n".join(texts), encoding="utf-8")
    return len(texts)


def _snapshot_before(bible: StoryBible, index: int) -> StoryBible:
    """复制一份只包含第 index 章之前内容的圣经（不读写盘）。"""
    import copy

    snap = copy.deepcopy(bible)
    snap.data["chapters"] = [r for r in snap.data["chapters"] if r["index"] < index]
    # 伏笔状态按已写章节回退：保守起见全部保持 open（由 fact_updates 在正样本里体现）
    return snap
