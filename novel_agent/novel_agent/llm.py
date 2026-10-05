"""统一的 LLM 客户端：OpenAI 兼容协议 + 重试 + JSON 模式 + 离线 Mock。"""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import yaml


@dataclass
class ProviderConfig:
    base_url: str = "https://api.moonshot.cn/v1"
    api_key_env: str = "MOONSHOT_API_KEY"
    model: str = "kimi-k3"
    temperature: float = 0.8
    max_tokens: int = 8192
    request_timeout: int = 300
    max_retries: int = 4
    api_key: str = field(default="", repr=False)


def load_config(path: str) -> tuple[ProviderConfig, dict]:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    p = dict(raw.get("provider") or {})
    p["api_key"] = os.environ.get(p.get("api_key_env", "MOONSHOT_API_KEY"), "")
    provider = ProviderConfig(**{k: v for k, v in p.items() if k in ProviderConfig.__dataclass_fields__})
    return provider, raw


class LLMClient:
    """OpenAI 兼容 Chat Completions 封装。model='mock' 时离线运行，供本地验证。"""

    def __init__(self, cfg: ProviderConfig):
        self.cfg = cfg
        self._client = None
        # 用量计量回调：后端平台层注入，签名为 fn(model, prompt_tokens, completion_tokens)
        self.usage_callback: Optional[Callable[[str, int, int], None]] = None
        if cfg.model != "mock":
            if not cfg.api_key:
                raise RuntimeError(
                    f"缺少 API Key：请设置环境变量 {cfg.api_key_env}（参考 .env.example）"
                )
            from openai import OpenAI

            self._client = OpenAI(
                api_key=cfg.api_key, base_url=cfg.base_url, timeout=cfg.request_timeout
            )

    # ------------------------------------------------------------------ #
    def chat(
        self,
        system: str,
        user: str,
        *,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        json_mode: bool = False,
        retries: Optional[int] = None,
    ) -> str:
        if self._client is None:
            return self._mock_chat(system, user, json_mode=json_mode)
        last_err: Optional[Exception] = None
        for attempt in range(retries if retries is not None else self.cfg.max_retries):
            try:
                kwargs: dict[str, Any] = {
                    "model": self.cfg.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": temperature if temperature is not None else self.cfg.temperature,
                    "max_tokens": max_tokens or self.cfg.max_tokens,
                }
                if json_mode:
                    kwargs["response_format"] = {"type": "json_object"}
                resp = self._client.chat.completions.create(**kwargs)
                self._report_usage(resp)
                return resp.choices[0].message.content or ""
            except Exception as e:  # 网络抖动/限流统一退避重试
                last_err = e
                wait = min(2 ** attempt * 2, 30)
                time.sleep(wait)
        raise RuntimeError(f"LLM 调用失败（重试 {self.cfg.max_retries} 次）: {last_err}")

    def _report_usage(self, resp: Any) -> None:
        if not self.usage_callback:
            return
        try:
            usage = getattr(resp, "usage", None)
            if usage is None:
                return
            self.usage_callback(
                self.cfg.model,
                int(getattr(usage, "prompt_tokens", 0) or 0),
                int(getattr(usage, "completion_tokens", 0) or 0),
            )
        except Exception:
            pass  # 计量失败不阻断生成

    def chat_json(self, system: str, user: str, **kw: Any) -> Any:
        """要求模型输出 JSON，并容错提取（容忍 ```json 代码块包裹）。"""
        text = self.chat(system, user, json_mode=True, **kw)
        return extract_json(text)

    # ------------------------------------------------------------------ #
    def chat_stream(
        self,
        system: str,
        user: str,
        *,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        retries: Optional[int] = None,
    ):
        """流式正文生成：逐 chunk yield 文本。用量在流结束后统一计量。

        Mock 模式下把整段回复切成小片并 sleep，模拟真实打字节奏，供离线验证。
        """
        if self._client is None:
            yield from self._mock_chat_stream(system, user)
            return
        last_err: Optional[Exception] = None
        for attempt in range(retries if retries is not None else self.cfg.max_retries):
            try:
                resp = self._client.chat.completions.create(
                    model=self.cfg.model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    temperature=temperature if temperature is not None else self.cfg.temperature,
                    max_tokens=max_tokens or self.cfg.max_tokens,
                    stream=True,
                    stream_options={"include_usage": True},
                )
                usage_reported = False
                for chunk in resp:
                    if getattr(chunk, "usage", None) and not usage_reported:
                        self._report_usage(chunk)
                        usage_reported = True
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        yield delta
                return
            except Exception as e:  # 网络抖动/限流统一退避重试
                last_err = e
                wait = min(2 ** attempt * 2, 30)
                time.sleep(wait)
        raise RuntimeError(f"LLM 流式调用失败（重试 {self.cfg.max_retries} 次）: {last_err}")

    def _mock_chat_stream(self, system: str, user: str):
        text = self._mock_chat(system, user, json_mode=False)
        # 按短句/标点切片，间隔可调（NOVEL_MOCK_STREAM_MS，默认 20ms），模拟真实生成节奏
        import re as _re
        import os as _os

        interval = float(_os.environ.get("NOVEL_MOCK_STREAM_MS", "20")) / 1000.0
        pieces = _re.split(r"(?<=[，。！？；\n])", text)
        for p in pieces:
            if p:
                yield p
                time.sleep(interval)

    # ------------------------------------------------------------------ #
    def _mock_chat(self, system: str, user: str, json_mode: bool = False) -> str:
        """离线 Mock：返回确定性内容，让流水线可端到端验证。"""
        if json_mode:
            if "续写" in user and "个人书库" in user:
                import re

                m_start = re.search(r"从第\s*(\d+)\s*章", user)
                m_n = re.search(r"续写\s*(\d+)\s*章", user)
                start = int(m_start.group(1)) if m_start else 4
                n = int(m_n.group(1)) if m_n else 2
                return json.dumps(
                    {
                        "volume_title": "续卷 新章",
                        "arc": "回收旧伤疤伏笔，主线推进到真相边缘",
                        "chapters": [
                            {
                                "index": start + i,
                                "title": f"续章 {start + i}",
                                "goal": "承接前章结尾，推进主线",
                                "conflict": "新出现的阻碍",
                                "turn": "付出代价，局势变化",
                                "hook": "新的悬念",
                                "payoff": "林默腕上的旧伤疤" if i == 0 else "",
                            }
                            for i in range(n)
                        ],
                    },
                    ensure_ascii=False,
                )
            if "世界观" in user or "story_bible" in system:
                import re

                m_target = re.search(r"目标章节数：\s*(\d+)", user)
                n = max(1, int(m_target.group(1))) if m_target else 3
                titles = ["醒来", "旧友", "线索", "暗涌", "反击", "真相", "抉择", "告别", "新生", "归途"]
                hooks = ["窗外传来自己的名字", "照片里多出不认识的人", "追兵首领喊出主角真名",
                         "旧伤疤开始发烫", "苏离失踪了", "档案里没有主角的记录",
                         "午夜来电只有呼吸声", "门缝里塞进来一张旧船票", "镜子里的人没有跟着动", "天台上的第二串脚印"]
                chapter_list = [
                    {
                        "index": i + 1,
                        "title": titles[i % len(titles)],
                        "goal": f"推进主线至第{i + 1}个情节点",
                        "conflict": "本章核心阻碍",
                        "hook": hooks[i % len(hooks)],
                    }
                    for i in range(n)
                ]
                return json.dumps(
                    {
                        "title": "Mock 之书",
                        "logline": "一个用于验证流水线的 mock 故事。",
                        "world_setting": "mock 世界，规则自洽。",
                        "characters": [
                            {"name": "林默", "role": "主角", "goal": "找回记忆", "traits": "冷静、克制"},
                            {"name": "苏离", "role": "盟友", "goal": "揭开真相", "traits": "机敏、多疑"},
                        ],
                        "foreshadowing": [{"setup": "林默腕上的旧伤疤", "planned_payoff": "第8章揭示来历"}],
                        "volumes": [{"volume_title": "第一卷 迷雾", "chapters": chapter_list}],
                    },
                    ensure_ascii=False,
                )
            if "评审" in system or "reward model" in system.lower():
                return json.dumps(
                    {
                        "draft_scores": {"hook": 6, "conflict": 6, "consistency": 7, "imagery": 6, "prose": 5},
                        "revised_scores": {"hook": 7, "conflict": 7, "consistency": 7, "imagery": 7, "prose": 7},
                        "improved": True,
                        "reason": "mock：修订稿各维度均不弱于当前稿且总分提升",
                    },
                    ensure_ascii=False,
                )
            if "审校" in system or "review" in system.lower():
                return json.dumps(
                    {
                        "issues": [
                            {"severity": "minor", "category": "节奏", "description": "中段信息密度略低", "suggestion": "压缩过渡段落"}
                        ],
                        "chapter_summary": "本章完成既定剧情目标，结尾钩子成立。",
                        "fact_updates": {"characters": [], "new_foreshadowing": [], "resolved_foreshadowing": []},
                    },
                    ensure_ascii=False,
                )
            return json.dumps({"result": "mock"}, ensure_ascii=False)
        # 非 JSON 输出：正文 / 修订
        if "续写" in user or "章节任务" in user or "任务卡" in user:
            return (
                "林默是在一阵消毒水味里醒来的。\n\n"
                "天花板白得刺眼，他抬手去挡，却看见腕上一道旧伤疤——他不记得自己受过这样的伤。\n\n"
                "窗外忽然有人喊他的名字。那声音很熟悉，熟悉得让他心口发紧。\n\n"
                "（mock 正文，用于验证流水线，接入真实 API 后此处为模型生成内容。）"
            )
        if "修订" in system or "改写" in user:
            return "（mock 修订稿）" + user[:80] + "……"
        return "mock"


def extract_json(text: str) -> Any:
    """从模型输出中稳健提取第一个 JSON 对象/数组。"""
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 退化策略：找第一个 { 到最后一个 }
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return json.loads(text[start : end + 1])
    start, end = text.find("["), text.rfind("]")
    if start != -1 and end > start:
        return json.loads(text[start : end + 1])
    raise ValueError(f"无法从模型输出中提取 JSON: {text[:200]}")
