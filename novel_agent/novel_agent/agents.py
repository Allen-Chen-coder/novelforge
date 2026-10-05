"""五个智能体分工：Planner / Writer / Critic / Reviser / Summarizer。

对应生产链：策划 -> 写作 -> 审校 -> 修订（循环） -> 记忆回灌。
"""
from __future__ import annotations

from typing import Any

from .llm import LLMClient
from .memory import StoryBible
from . import prompts as P


class Planner:
    """把一句灵感扩展成整本书策划（世界观/角色/伏笔/分卷章纲）。"""

    def __init__(self, llm: LLMClient):
        self.llm = llm

    def make_plan(
        self, idea: str, genre: str, target_chapters: int, style_notes: str = ""
    ) -> dict[str, Any]:
        user = P.PLANNER_USER.format(
            idea=idea,
            genre=genre,
            target_chapters=target_chapters,
            style_notes=style_notes or "（无特殊要求）",
        )
        plan = self.llm.chat_json(P.PLANNER_SYSTEM, user)
        self._validate(plan, target_chapters)
        return plan

    def make_continuation_plan(
        self,
        bible: StoryBible,
        plan: dict[str, Any],
        additional: int,
        start_index: int,
    ) -> dict[str, Any]:
        """基于个人书库规划续写卷：承接主线、回收伏笔、章节从 start_index 连续编号。"""
        last_index = start_index - 1
        user = P.CONTINUATION_PLANNER_USER.format(
            title=bible.data.get("title") or plan.get("title", ""),
            world_setting=bible.data.get("world_setting") or plan.get("world_setting", ""),
            core_drive=plan.get("core_drive", "（见全书梗概）"),
            characters=bible.characters_block(),
            open_foreshadowing=bible.foreshadowing_block(),
            full_summary=bible.cumulative_summary(),
            additional=additional,
            start_index=start_index,
            last_index=last_index,
        )
        volume = self.llm.chat_json(P.CONTINUATION_PLANNER_SYSTEM, user)
        chapters = volume.get("chapters", [])
        if len(chapters) != additional:
            raise ValueError(
                f"续写策划章节数 {len(chapters)} 与目标 {additional} 不一致，请重试"
            )
        expected = list(range(start_index, start_index + additional))
        actual = [int(c.get("index", 0)) for c in chapters]
        if actual != expected:
            raise ValueError(f"续写章节编号不连续：期望 {expected}，实际 {actual}")
        return volume

    @staticmethod
    def _validate(plan: dict, target_chapters: int) -> None:
        chapters = [
            ch
            for vol in plan.get("volumes", [])
            for ch in vol.get("chapters", [])
        ]
        if len(chapters) != target_chapters:
            raise ValueError(
                f"策划章节数 {len(chapters)} 与目标 {target_chapters} 不一致，请重试或调整 prompt"
            )


class Writer:
    """按任务卡写正文，携带角色账本 + 伏笔台账 + 滚动摘要作为上下文。"""

    def __init__(self, llm: LLMClient):
        self.llm = llm

    def write_chapter(
        self,
        bible: StoryBible,
        chapter: dict,
        rolling_last_n: int = 5,
        target_words: int = 3000,
        on_chunk=None,
    ) -> str:
        user = P.WRITER_USER.format(
            title=bible.data["title"],
            world_setting=bible.data["world_setting"],
            characters=bible.characters_block(),
            open_foreshadowing=bible.foreshadowing_block(),
            rolling_summary=bible.rolling_summary(rolling_last_n),
            full_summary=bible.cumulative_summary(),
            index=chapter["index"],
            chapter_title=chapter.get("title", ""),
            goal=chapter.get("goal", ""),
            conflict=chapter.get("conflict", ""),
            hook=chapter.get("hook", ""),
            target_words=target_words,
            opening_note=P.opening_note(chapter["index"]),
        )
        if on_chunk is not None:
            # 流式写作：逐 chunk 回调（用于 SSE 直播），结束后返回完整正文
            parts: list[str] = []
            for delta in self.llm.chat_stream(P.WRITER_SYSTEM, user):
                parts.append(delta)
                on_chunk(delta)
            return "".join(parts)
        return self.llm.chat(P.WRITER_SYSTEM, user)


class Critic:
    """审校正文，输出结构化问题 + 章节摘要 + 事实更新。"""

    def __init__(self, llm: LLMClient):
        self.llm = llm

    def review(
        self, bible: StoryBible, chapter: dict, draft: str, rolling_last_n: int = 5
    ) -> dict[str, Any]:
        user = P.CRITIC_USER.format(
            characters=bible.characters_block(),
            rolling_summary=bible.rolling_summary(rolling_last_n),
            index=chapter["index"],
            chapter_title=chapter.get("title", ""),
            goal=chapter.get("goal", ""),
            conflict=chapter.get("conflict", ""),
            hook=chapter.get("hook", ""),
            draft=draft,
        )
        result = self.llm.chat_json(P.CRITIC_SYSTEM, user)
        result.setdefault("scores", {})
        result.setdefault("issues", [])
        result.setdefault("chapter_summary", "")
        result.setdefault("fact_updates", {})
        return result

    @staticmethod
    def has_major_issues(review: dict) -> bool:
        """major 判定：优先看评分制 rubric，退化到 severity 标注。

        红线（评分制）：人设与逻辑 consistency<=5、钩子 hook<=4、五维总分<=25。
        """
        scores = review.get("scores") or {}
        if scores:
            try:
                consistency = int(scores.get("consistency", 10))
                hook = int(scores.get("hook", 10))
                total = sum(int(v) for v in scores.values())
                if consistency <= 5 or hook <= 4 or total <= 25:
                    return True
            except (TypeError, ValueError):
                pass  # 分数缺失/异常时退化到 severity 判定
        return any(
            str(i.get("severity", "")).lower() == "major" for i in review.get("issues", [])
        )


class Reviser:
    """按责编意见修订正文。"""

    def __init__(self, llm: LLMClient):
        self.llm = llm

    def revise(self, bible: StoryBible, chapter: dict, draft: str, issues: list) -> str:
        import json

        user = P.REVISER_USER.format(
            index=chapter["index"],
            chapter_title=chapter.get("title", ""),
            goal=chapter.get("goal", ""),
            conflict=chapter.get("conflict", ""),
            hook=chapter.get("hook", ""),
            characters=bible.characters_block(),
            issues_json=json.dumps(issues, ensure_ascii=False, indent=2),
            draft=draft,
        )
        return self.llm.chat(P.REVISER_SYSTEM, user)


class Summarizer:
    """章节正文 -> 滚动记忆所需的结构化摘要（审校摘要之外的补充冗余保险）。"""

    def __init__(self, llm: LLMClient):
        self.llm = llm

    def summarize(self, chapter: dict, text: str) -> str:
        try:
            result = self.llm.chat_json(
                P.SUMMARIZER_SYSTEM,
                P.SUMMARIZER_USER.format(
                    index=chapter["index"], chapter_title=chapter.get("title", ""), draft=text
                ),
            )
            return result.get("summary", "")
        except Exception:
            return ""
