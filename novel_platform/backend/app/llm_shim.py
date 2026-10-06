"""桥接 novel_agent 的 LLMClient：平台默认配置 or 用户自带 Key（BYOK）。"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable, Optional

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _find_novel_agent_root() -> Path:
    """定位包含 novel_agent 包的根目录，兼容两种布局：
    - 本地仓库：ws/novel_agent/（backend 的上上级）
    - 服务器：/opt/novelforge/novel_agent/（backend 的同级）
    """
    for cand in (
        BACKEND_ROOT / "novel_agent",            # backend/novel_agent
        BACKEND_ROOT.parent / "novel_agent",     # <部署根>/novel_agent
        BACKEND_ROOT.parents[1] / "novel_agent",  # 本地仓库布局
    ):
        if (cand / "novel_agent" / "llm.py").exists():
            return cand
    return BACKEND_ROOT.parent / "novel_agent"  # 兜底：让 import 报错可定位


NOVEL_AGENT_ROOT = _find_novel_agent_root()
if str(NOVEL_AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(NOVEL_AGENT_ROOT))

from app import db, security  # noqa: E402


def get_provider_row():
    return db.q_one("SELECT * FROM provider_config WHERE id=1")


def get_user_provider_row(user_id: int):
    return db.q_one(
        "SELECT * FROM user_provider WHERE user_id=? AND enabled=1", (user_id,)
    )


def provider_ready() -> bool:
    return get_provider_row() is not None


def _build_from_row(row, meter: Optional[Callable[[str, int, int], None]]):
    """用任意 provider 行（平台配置或用户 BYOK）构造 LLMClient。"""
    from novel_agent.llm import LLMClient, ProviderConfig

    cfg = ProviderConfig(
        base_url=row["base_url"],
        api_key_env="",  # key 直接注入，不走环境变量
        model=row["model"],
        temperature=row["temperature"],
        max_tokens=row["max_tokens"],
        api_key=security.decrypt(row["api_key_enc"]),
    )
    client = LLMClient(cfg)
    client.usage_callback = meter
    return client


def build_llm(meter: Optional[Callable[[str, int, int], None]] = None):
    """平台默认模型（管理员配置）；未配置时抛错。"""
    row = get_provider_row()
    if not row:
        raise RuntimeError("管理员尚未配置模型服务商")
    return _build_from_row(row, meter)


def build_llm_for_user(
    user_id: int, meter: Optional[Callable[[str, int, int], None]] = None
):
    """优先使用用户自带的 API（BYOK）；否则回退平台配置。

    返回 (client, byok: bool)。
    """
    up = get_user_provider_row(user_id)
    if up:
        return _build_from_row(up, meter), True
    return build_llm(meter), False


# --------------------------------------------------------------------- #
# 模型路由：按流水线角色（planner/writer/critic/reviser/summarizer）指定不同模型
# --------------------------------------------------------------------- #
from .schemas import ROLES  # noqa: E402


def get_route_rows() -> list:
    return db.q("SELECT * FROM model_routes WHERE enabled=1")


def build_role_router(
    user_id: int, meter: Optional[Callable[[str, int, int], None]] = None
):
    """构建 (默认 client, {role: client}, byok)。

    默认 client 来自平台配置或用户 BYOK；已启用的角色路由覆盖对应角色。
    """
    default_client, byok = build_llm_for_user(user_id, meter)
    role_llms = {}
    for row in get_route_rows():
        role = row["role"]
        if role in ROLES:
            role_llms[role] = _build_from_row(row, meter)
    return default_client, role_llms, byok


# --------------------------------------------------------------------- #
# API Key 连通性测试：最小代价调用一次（max_tokens=1），用于保存前的自检
# --------------------------------------------------------------------- #
def _friendly_api_error(e: Exception) -> str:
    import openai

    status = getattr(e, "status_code", None) or ""
    if isinstance(e, openai.AuthenticationError) or status == 401:
        return "API Key 无效或已失效（服务商返回 401 鉴权失败）"
    if isinstance(e, openai.NotFoundError) or status == 404:
        return "接口地址或模型名不正确（404）：检查 Base URL 是否含 /v1 后缀、模型 ID 是否存在"
    if isinstance(e, openai.APIConnectionError):
        return f"无法连接接口地址：{e}"
    if isinstance(e, openai.RateLimitError) or status == 429:
        return "Key 有效，但当前触发服务商限流（429），稍后重试即可"
    if isinstance(e, openai.PermissionDeniedError) or status == 403:
        return "Key 有效但无该模型权限（403）：检查服务商控制台是否开通此模型"
    if isinstance(e, openai.BadRequestError) or status == 400:
        return "请求被服务商拒绝（400）：检查模型 ID 是否正确、该模型是否支持当前参数"
    return f"调用失败：{type(e).__name__}: {str(e)[:200]}"


def test_provider(base_url: str, api_key: str, model: str) -> dict:
    """返回 {"ok": True, "latency_ms": n} 或 {"ok": False, "error": 友好描述}。"""
    import time

    import openai

    client = openai.OpenAI(api_key=api_key, base_url=base_url, timeout=60, max_retries=0)
    t0 = time.time()

    def _ping(param_name: str):
        kwargs = {
            "model": model,
            "messages": [{"role": "user", "content": "ping"}],
            param_name: 16,
        }
        return client.chat.completions.create(**kwargs)

    try:
        try:
            _ping("max_tokens")
        except openai.BadRequestError as e1:
            # 只接受 max_completion_tokens 的模型家族（o1/o3/GPT-5 codex 系）：换参重试
            if "max_completion_tokens" not in str(e1):
                raise
            _ping("max_completion_tokens")
    except openai.BadRequestError as e:
        # 部分服务商/推理模型会把「测试消息太短、被 max_tokens 截断」当作 400 报错。
        # 请求已被受理并路由到模型，说明 Key 有效、地址和模型都对——视为成功。
        msg = str(e).lower()
        if any(k in msg for k in ("max_tokens", "output limit", "max tokens")):
            return {"ok": True, "latency_ms": int((time.time() - t0) * 1000)}
        return {"ok": False, "error": _friendly_api_error(e)}
    except Exception as e:
        return {"ok": False, "error": _friendly_api_error(e)}
    return {"ok": True, "latency_ms": int((time.time() - t0) * 1000)}
