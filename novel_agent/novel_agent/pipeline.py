"""主编排流水线：Plan -> 逐章 (Write -> Critique -> Revise 循环) -> 记忆回灌。

支持断点续跑：所有状态落在工程目录的 story_bible.json / plan.json。
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable, Optional

from .agents import Critic, Planner, Reviser, Summarizer, Writer
from .llm import LLMClient
from .memory import StoryBible

logger = logging.getLogger("novel_agent.pipeline")


class NovelPipeline:
    def __init__(
        self,
        llm: LLMClient,
        project_dir: Path,
        pipeline_cfg: Optional[dict] = None,
        on_progress: Optional[Callable[[str], None]] = None,
        role_llms: Optional[dict[str, LLMClient]] = None,
        on_chapter_chunk: Optional[Callable[[int, str], None]] = None,
        on_chapter_done: Optional[Callable[[int, dict], None]] = None,
    ):
        self.llm = llm
        self.project_dir = Path(project_dir)
        self.cfg = pipeline_cfg or {}
        self.on_progress = on_progress or (lambda msg: logger.info(msg))
        # 流式直播回调：逐章正文 chunk / 章节定稿
        self.on_chapter_chunk = on_chapter_chunk
        self.on_chapter_done = on_chapter_done
        # 模型路由：按角色（planner/writer/critic/reviser/summarizer/judge）指定不同模型，未配置回退默认
        self._role_llms = role_llms or {}

        self.bible = StoryBible(self.project_dir / "story_bible.json")
        self.plan_path = self.project_dir / "plan.json"
        self.planner = Planner(self._role("planner"))
        self.writer = Writer(self._role("writer"))
        self.critic = Critic(self._role("critic"))
        self.reviser = Reviser(self._role("reviser"))
        self.summarizer = Summarizer(self._role("summarizer"))
        # 写作奖励模型（验收门）：reward_gate 开启后，修订稿 RM 得分不提升则拒收
        self.judge: Optional[WritingRMJudge] = None
        if self.cfg.get("reward_gate"):
            from .finetune.rm import WritingRMJudge

            self.judge = WritingRMJudge(self._role("judge"))

    def _role(self, name: str) -> LLMClient:
        return self._role_llms.get(name) or self.llm

    # ------------------------------------------------------------------ #
    def _load_plan(self) -> dict[str, Any]:
        if self.plan_path.exists():
            with open(self.plan_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}

    def _save_plan(self, plan: dict[str, Any]) -> None:
        self.project_dir.mkdir(parents=True, exist_ok=True)
        with open(self.plan_path, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)

    def _all_chapters(self, plan: dict) -> list[dict]:
        return [
            ch
            for vol in plan.get("volumes", [])
            for ch in vol.get("chapters", [])
        ]

    # ------------------------------------------------------------------ #
    def run(self, idea: str, genre: str = "", target_chapters: int | None = None) -> StoryBible:
        target = target_chapters or int(self.cfg.get("target_chapters", 10))
        rolling_n = int(self.cfg.get("rolling_summary_chapters", 5))
        max_rounds = int(self.cfg.get("max_revise_rounds", 2))
        self.project_dir.mkdir(parents=True, exist_ok=True)

        # 1) 策划（已有 plan 则复用，支持续跑）
        plan = self._load_plan()
        if not plan:
            self.on_progress(f"[1/3] 策划：把灵感扩展为 {target} 章整书方案…")
            plan = self.planner.make_plan(idea, genre, target, self.cfg.get("style_notes", ""))
            self._save_plan(plan)
            self.bible.init_from_plan(plan)
        else:
            self.on_progress("[1/3] 策划：检测到已有 plan.json，直接续跑。")
            if not self.bible.data.get("title"):
                self.bible.init_from_plan(plan)

        chapters_plan = self._all_chapters(plan)
        self.on_progress(f"[2/3] 开始生产：共 {len(chapters_plan)} 章，已完成 {self.bible.chapter_count} 章。")

        # 2) 逐章生产
        for ch in chapters_plan:
            if ch["index"] <= self.bible.chapter_count:
                continue  # 断点续跑：跳过已完成章节
            self._produce_chapter(ch, rolling_n, max_rounds)

        self.on_progress("[3/3] 全部章节完成，正在导出…")
        from .export import export_all

        export_all(self.bible, self.project_dir)
        return self.bible

    # ------------------------------------------------------------------ #
    def _produce_chapter(self, ch: dict, rolling_n: int, max_rounds: int) -> None:
        idx = ch["index"]
        self.on_progress(f"  ▶ 第{idx}章《{ch.get('title','')}》：写作…")
        target_words = int(self.cfg.get("target_words", 3000))
        chunk_cb = (
            (lambda delta, _idx=idx: self.on_chapter_chunk(_idx, delta))
            if self.on_chapter_chunk
            else None
        )
        draft = self.writer.write_chapter(self.bible, ch, rolling_last_n=rolling_n, target_words=target_words, on_chunk=chunk_cb)
        drafts = [draft]  # 初稿入档：与终稿构成 DPO 偏好对

        rounds = 0
        rm_log: list[dict] = []
        review = self.critic.review(self.bible, ch, draft, rolling_last_n=rolling_n)
        issues = review.get("issues", [])
        while self.critic.has_major_issues(review) and rounds < max_rounds:
            rounds += 1
            self.on_progress(f"  ↻ 第{idx}章：发现 {len(issues)} 个问题，第 {rounds} 轮修订…")
            revised = self.reviser.revise(self.bible, ch, draft, review["issues"])
            if self.judge is not None:
                # 验收门：RM 判定修订稿未改进则拒收，保留上一稿
                try:
                    verdict = self.judge.compare(self.bible, ch, draft, revised, rolling_last_n=rolling_n)
                    rm_log.append({
                        "round": rounds,
                        "draft_total": verdict.draft_total,
                        "revised_total": verdict.revised_total,
                        "margin": verdict.margin,
                        "improved": verdict.improved,
                        "reason": verdict.reason,
                        "draft_scores": verdict.draft_scores,
                        "revised_scores": verdict.revised_scores,
                    })
                    if verdict.improved:
                        draft = revised
                    else:
                        self.on_progress(
                            f"  ⊘ 第{idx}章：RM 判定修订未改进（{verdict.draft_total}→{verdict.revised_total}），保留上一稿"
                        )
                except Exception as e:  # Judge 不可用时不阻断生产
                    logger.warning("RM judge failed, accept revision as-is: %s", e)
                    draft = revised
            else:
                draft = revised
            drafts.append(draft)
            review = self.critic.review(self.bible, ch, draft, rolling_last_n=rolling_n)
            issues = review.get("issues", [])

        summary = review.get("chapter_summary") or self.summarizer.summarize(ch, draft)
        self.bible.ingest_chapter(
            index=idx,
            title=ch.get("title", ""),
            text=draft,
            summary=summary,
            fact_updates=review.get("fact_updates", {}),
            issues=issues,
            revise_rounds=rounds,
            drafts=drafts,
            rm_log=rm_log or None,
        )
        self.on_progress(f"  ✓ 第{idx}章完成（审校问题 {len(issues)} 个，修订 {rounds} 轮）")
        if self.on_chapter_done:
            try:
                self.on_chapter_done(idx, dict(self.bible.data["chapters"][-1]))
            except Exception:
                logger.exception("on_chapter_done callback failed (ignored)")
