"""StoryBible：长篇一致性记忆（角色账本、伏笔台账、滚动摘要、事实库）。

持久化为工程目录下的 story_bible.json，支持断点续跑时完整恢复。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ChapterRecord:
    index: int
    title: str
    text: str
    summary: str = ""
    revise_rounds: int = 0
    issues: list = field(default_factory=list)


class StoryBible:
    def __init__(self, path: Path):
        self.path = path
        self.data: dict[str, Any] = {
            "title": "",
            "logline": "",
            "world_setting": "",
            "characters": [],            # [{name, role, goal, traits, state}]
            "foreshadowing": [],         # [{setup, planned_payoff, status: open/resolved, chapter}]
            "chapters": [],              # [ChapterRecord dict]
        }
        if path.exists():
            self.load()

    # ------------------------------------------------------------------ #
    def load(self) -> None:
        with open(self.path, "r", encoding="utf-8") as f:
            self.data.update(json.load(f))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)

    # ------------------------------------------------------------------ #
    def init_from_plan(self, plan: dict) -> None:
        self.data["title"] = plan.get("title", "")
        self.data["logline"] = plan.get("logline", "")
        self.data["world_setting"] = plan.get("world_setting", "")
        self.data["characters"] = [
            {**c, "state": ""} for c in plan.get("characters", [])
        ]
        self.data["foreshadowing"] = [
            {**fw, "status": "open", "chapter": None}
            for fw in plan.get("foreshadowing", [])
        ]
        self.save()

    @property
    def chapter_count(self) -> int:
        return len(self.data["chapters"])

    # ------------------------------------------------------------------ #
    def open_foreshadowing(self) -> list[dict]:
        return [fw for fw in self.data["foreshadowing"] if fw.get("status") == "open"]

    def rolling_summary(self, last_n: int = 5) -> str:
        records = self.data["chapters"][-last_n:]
        if not records:
            return "（本书开篇，无前文）"
        return "\n".join(
            f"第{r['index']}章《{r.get('title','')}》：{r.get('summary','')}" for r in records
        )

    def cumulative_summary(self, max_chars_per_chapter: int = 60) -> str:
        """全书梗概（个人书库）：所有已写章节的压缩摘要，供跨批次续写保持连贯。

        与 rolling_summary 的区别：滚动摘要只看最近 N 章的细节，
        全书梗概覆盖从第1章到当前的全部剧情脉络，章节再多也不丢主线。
        """
        records = self.data["chapters"]
        if not records:
            return "（本书开篇，无前文）"
        lines = []
        for r in records:
            s = (r.get("summary") or "").strip()
            if len(s) > max_chars_per_chapter:
                s = s[:max_chars_per_chapter] + "…"
            lines.append(f"第{r['index']}章：{s}")
        return "\n".join(lines)

    def characters_block(self) -> str:
        lines = []
        for c in self.data["characters"]:
            state = f"；当前状态：{c['state']}" if c.get("state") else ""
            voice = f"；声纹：{c['voice']}" if c.get("voice") else ""
            relations = f"；关系：{c['relations']}" if c.get("relations") else ""
            wound = f"；内在缺口：{c['wound']}" if c.get("wound") else ""
            lines.append(
                f"- {c.get('name')}（{c.get('role')}）：目标={c.get('goal')}；性格={c.get('traits')}{wound}{voice}{relations}{state}"
            )
        return "\n".join(lines) or "（无）"

    def foreshadowing_block(self) -> str:
        open_fw = self.open_foreshadowing()
        if not open_fw:
            return "（无未回收伏笔）"
        return "\n".join(f"- {fw['setup']}（计划回收：{fw.get('planned_payoff','')}）" for fw in open_fw)

    # ------------------------------------------------------------------ #
    def ingest_chapter(
        self,
        index: int,
        title: str,
        text: str,
        summary: str = "",
        fact_updates: dict | None = None,
        issues: list | None = None,
        revise_rounds: int = 0,
        drafts: list[str] | None = None,
        rm_log: list | None = None,
    ) -> None:
        fact_updates = fact_updates or {}
        # 角色状态回灌
        for chg in fact_updates.get("characters", []):
            for c in self.data["characters"]:
                if c["name"] == chg.get("name"):
                    c["state"] = chg.get("change", c["state"])
        # 伏笔台账回灌
        for fw in fact_updates.get("new_foreshadowing", []):
            self.data["foreshadowing"].append(
                {**fw, "status": "open", "chapter": index}
            )
        resolved = {
            fw.get("setup") for fw in fact_updates.get("resolved_foreshadowing", [])
        }
        for fw in self.data["foreshadowing"]:
            if fw.get("setup") in resolved and fw.get("status") == "open":
                fw["status"] = "resolved"
                fw["resolved_chapter"] = index
        # 章节记录（已存在则更新，保证可重跑）
        record = {
            "index": index,
            "title": title,
            "text": text,
            "summary": summary,
            "revise_rounds": revise_rounds,
            "issues": issues or [],
        }
        # draft 历史（初稿 + 每轮修订稿），用于构建 DPO 偏好对（chosen=终稿 / rejected=初稿）
        if drafts:
            record["drafts"] = drafts
        # RM 验收门日志（每轮修订的评分对比），用于训练数据分析
        if rm_log:
            record["rm_log"] = rm_log
        chapters = self.data["chapters"]
        if chapters and chapters[-1]["index"] == index:
            chapters[-1] = record
        else:
            chapters.append(record)
        self.save()
