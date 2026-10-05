"""写作奖励模型（Writing RM）——Writing-Zero 思路的工程落地。

三个组成部分：

1. WritingRMJudge（LLM-as-judge 评审）
   对同一章节任务的两版正文按责编同款的五维 rubric 打分（1-10），
   判定修订稿是否真正改进。可路由到独立（便宜）的模型，与 Critic 解耦。

2. 修订验收门（pipeline 集成）
   修订循环里每轮修订后由 Judge 对比打分：得分不提升则拒收修订稿、保留上一稿，
   防止「越改越差」，同时把 RM 分数落盘进章节记录（后续训练/分析用）。

3. RM 训练数据（scripts/label_rm_scores.py）
   DPO 偏好对与 TRL RewardTrainer 格式天然兼容；标注脚本对每对跑 Judge，
   产出带分数与差值的 rm_pairs.jsonl，并可按最小差值过滤「修订其实没变好」的噪声对。

五维 rubric 与 prompts.CRITIC_SYSTEM 完全对齐：钩子强度 / 冲突与目标 / 人设与逻辑 / 画面感 / 语言新鲜度。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional

from ..llm import LLMClient

DIMENSIONS = ("hook", "conflict", "consistency", "imagery", "prose")

DIMENSION_LABELS = {
    "hook": "钩子强度（开篇进入事件、章末悬念成立）",
    "conflict": "冲突与目标（冲突清晰、主角付出代价）",
    "consistency": "人设与逻辑（言行贴合设定卡与前文、世界观自洽）",
    "imagery": "画面感（场景/动作/对话可直接分镜）",
    "prose": "语言新鲜度（无 AI 味套话、句式不雷同）",
}

MAX_TOTAL = 10 * len(DIMENSIONS)  # 50

RM_SYSTEM = """你是写作质量评审员（Writing Reward Model）。对同一章节任务的两版正文，按以下五个维度分别打分（1-10）：
1. 钩子强度：开篇是否快速进入具体事件，章末悬念是否成立；
2. 冲突与目标：本章冲突是否清晰、主角是否为目标付出了代价；
3. 人设与逻辑：言行是否偏离设定卡与前文事实，世界观是否自洽；
4. 画面感：场景、动作、对话能否直接分镜，有无大段无法视觉化的抽象叙述；
5. 语言新鲜度：有无 AI 味套话、句式雷同、空洞形容词。
评分要苛刻：8 分及以上需要"亮点明确"；6 分是及格线；5 分及以下必须在该维度的 reason 里给出具体问题。
只输出 JSON。"""

RM_PAIR_USER = """【人物设定】
{characters}

【前文滚动摘要】
{rolling_summary}

【本章任务卡】
第{index}章《{chapter_title}》 目标：{goal} 冲突：{conflict} 钩子：{hook}

【版本A：当前稿】
{draft}

【版本B：修订稿】
{revised}

请对两版分别按五维打分，并判定版本B是否真正改进（总分更高，且没有任一维度下降超过1分）。
输出 JSON：
{{
  "draft_scores": {{"hook": 1-10, "conflict": 1-10, "consistency": 1-10, "imagery": 1-10, "prose": 1-10}},
  "revised_scores": {{"hook": 1-10, "conflict": 1-10, "consistency": 1-10, "imagery": 1-10, "prose": 1-10}},
  "improved": true/false,
  "reason": "一句话判定依据"
}}"""


@dataclass
class RMVerdict:
    """一次成对评审的结果。"""

    draft_total: int
    revised_total: int
    improved: bool
    reason: str = ""
    draft_scores: dict = field(default_factory=dict)
    revised_scores: dict = field(default_factory=dict)

    @property
    def margin(self) -> int:
        return self.revised_total - self.draft_total


class WritingRMJudge:
    """写作质量评审客户端。llm 可路由到任意 OpenAI 兼容模型（建议用便宜模型）。"""

    def __init__(self, llm: LLMClient):
        self.llm = llm

    # ------------------------------------------------------------------ #
    def compare(
        self,
        bible,
        chapter: dict,
        draft: str,
        revised: str,
        rolling_last_n: int = 5,
    ) -> RMVerdict:
        """带全书上下文（人物/滚动摘要/任务卡）的成对评审——用于修订验收门。"""
        user = RM_PAIR_USER.format(
            characters=bible.characters_block(),
            rolling_summary=bible.rolling_summary(rolling_last_n),
            index=chapter["index"],
            chapter_title=chapter.get("title", ""),
            goal=chapter.get("goal", ""),
            conflict=chapter.get("conflict", ""),
            hook=chapter.get("hook", ""),
            draft=draft,
            revised=revised,
        )
        return self._parse(self.llm.chat_json(RM_SYSTEM, user))

    def compare_texts(
        self, goal: str, draft: str, revised: str, context: str = ""
    ) -> RMVerdict:
        """轻量成对评审（无圣经上下文）——用于离线标注 DPO 偏好对。"""
        user = RM_PAIR_USER.format(
            characters=context or "（略）",
            rolling_summary="（略）",
            index="?",
            chapter_title="",
            goal=goal or "（见正文）",
            conflict="（见正文）",
            hook="（见正文）",
            draft=draft,
            revised=revised,
        )
        return self._parse(self.llm.chat_json(RM_SYSTEM, user))

    # ------------------------------------------------------------------ #
    @staticmethod
    def _parse(result: Any) -> RMVerdict:
        if not isinstance(result, dict) or "draft_scores" not in result:
            raise ValueError(f"RM 评审输出格式异常: {json.dumps(result, ensure_ascii=False)[:200]}")
        ds = {k: int(result["draft_scores"].get(k, 0)) for k in DIMENSIONS}
        rs = {k: int(result["revised_scores"].get(k, 0)) for k in DIMENSIONS}
        return RMVerdict(
            draft_total=sum(ds.values()),
            revised_total=sum(rs.values()),
            improved=bool(result.get("improved")),
            reason=str(result.get("reason", "")),
            draft_scores=ds,
            revised_scores=rs,
        )


def filter_pairs_by_margin(
    pairs: list[dict], min_margin: int = 1
) -> list[dict]:
    """按 Judge 标注的得分差过滤噪声对：只保留 revised 总分确实更高的对。"""
    kept = []
    for p in pairs:
        rm = p.get("rm") or {}
        if rm.get("margin", 0) >= min_margin and rm.get("improved"):
            kept.append(p)
    return kept
