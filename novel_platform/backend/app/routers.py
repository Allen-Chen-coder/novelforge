"""路由：认证 / 用户作品 / 管理后台。"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

from . import auth, db, security
from .auth import CurrentUser, get_current_user, require_admin
from .catalog import CATALOG, PACKS, PLANS
from .runner import submit
from .schemas import (
    LoginIn,
    ModelRouteIn,
    MyProviderIn,
    OrderCreateIn,
    ProjectCreateIn,
    ProjectExtendIn,
    ProviderIn,
    ROLES,
    RegisterIn,
    UserPatchIn,
)

router = APIRouter(prefix="/api")


# --------------------------------------------------------------------- #
# 认证
# --------------------------------------------------------------------- #
def _has_byok(user_id: int) -> bool:
    return db.q_one(
        "SELECT 1 FROM user_provider WHERE user_id=? AND enabled=1", (user_id,)
    ) is not None


def _public_user(u: CurrentUser) -> dict:
    plan_month = max(0, u["plan_chapters"] - u["used_chapters"])
    return {
        "id": u["id"],
        "username": u["username"],
        "is_admin": bool(u["is_admin"]),
        "quota_chapters": u["quota_chapters"],
        "used_chapters": u["used_chapters"],
        "plan": u["plan"],
        "plan_name": PLANS.get(u["plan"], PLANS["free"])["name"],
        "plan_chapters": u["plan_chapters"],
        "plan_reset_at": u["plan_reset_at"],
        "extra_chapters": u["extra_chapters"],
        "remaining_chapters": plan_month + u["extra_chapters"],
        "byok": _has_byok(u["id"]),
    }


@router.post("/auth/register")
def register(body: RegisterIn):
    uid = auth.create_user(body.username, body.password)
    token = auth.login(body.username, body.password)
    user = CurrentUser(dict(db.q_one("SELECT * FROM users WHERE id=?", (uid,))))
    return {"token": token, "user": _public_user(user)}


@router.post("/auth/login")
def login(body: LoginIn):
    token = auth.login(body.username, body.password)
    row = db.q_one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?",
        (token,),
    )
    return {"token": token, "user": _public_user(CurrentUser(dict(row)))}


@router.get("/auth/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return _public_user(user)


# --------------------------------------------------------------------- #
# 用户作品
# --------------------------------------------------------------------- #
@router.get("/projects")
def list_projects(user: CurrentUser = Depends(get_current_user)):
    rows = db.q(
        "SELECT * FROM projects WHERE user_id=? ORDER BY id DESC", (user["id"],)
    )
    return [_project_brief(dict(r)) for r in rows]


def _project_brief(r: dict) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "idea": r["idea"],
        "genre": r["genre"],
        "target_chapters": r["target_chapters"],
        "target_words": r.get("target_words") or 3000,
        "status": r["status"],
        "progress_msg": r["progress_msg"],
        "chapters_done": r["chapters_done"],
        "error": r["error"],
        "created_at": r["created_at"],
        "finished_at": r["finished_at"],
    }


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreateIn, user: CurrentUser = Depends(get_current_user)):
    running = db.q_one(
        "SELECT COUNT(*) AS c FROM projects WHERE user_id=? AND status IN ('queued','running')",
        (user["id"],),
    )["c"]
    if running >= 2:
        raise HTTPException(429, "同时进行的工程最多 2 个，请等待完成后再新建")
    byok = _has_byok(user["id"])
    if not byok:
        remaining = max(0, user["plan_chapters"] - user["used_chapters"]) + user["extra_chapters"]
        if body.target_chapters > remaining:
            raise HTTPException(
                403, f"额度不足：剩余 {remaining} 章，本工程需要 {body.target_chapters} 章，可到「额度中心」升级套餐或购买加油包"
            )
    pid = db.execute(
        "INSERT INTO projects(user_id,name,idea,genre,target_chapters,target_words) VALUES(?,?,?,?,?,?)",
        (user["id"], body.name, body.idea, body.genre, body.target_chapters, body.target_words),
    )
    submit(pid)
    return _project_brief(
        dict(db.q_one("SELECT * FROM projects WHERE id=?", (pid,)))
    )


@router.post("/projects/{pid}/extend", status_code=201)
def extend_project(pid: int, body: ProjectExtendIn, user: CurrentUser = Depends(get_current_user)):
    """续写：在已完成工程上追加章节，个人书库（story_bible）保证前后批次连贯。"""
    proj = _own_project(pid, user)
    if proj["status"] != "done":
        raise HTTPException(400, "只有已完成的工程才能续写")
    running = db.q_one(
        "SELECT COUNT(*) AS c FROM projects WHERE user_id=? AND status IN ('queued','running')",
        (user["id"],),
    )["c"]
    if running >= 2:
        raise HTTPException(429, "同时进行的工程最多 2 个，请等待完成后再续写")
    byok = _has_byok(user["id"])
    if not byok:
        remaining = max(0, user["plan_chapters"] - user["used_chapters"]) + user["extra_chapters"]
        if body.chapters > remaining:
            raise HTTPException(
                403, f"额度不足：剩余 {remaining} 章，本次续写需要 {body.chapters} 章，可到「额度中心」升级套餐或购买加油包"
            )

    from .runner import RUNS_DIR

    run_dir = RUNS_DIR / str(pid)
    plan_path = run_dir / "plan.json"
    bible_path = run_dir / "story_bible.json"
    if not plan_path.exists() or not bible_path.exists():
        raise HTTPException(400, "工程档案缺失（book library 不存在），无法续写")
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    bible = json.loads(bible_path.read_text(encoding="utf-8"))
    done_chapters = len(bible.get("chapters", []))
    if done_chapters == 0:
        raise HTTPException(400, "工程没有已完成章节，无法续写")

    # 续写策划：基于个人书库生成后续章节任务卡，追加到 plan.json
    from .llm_shim import build_role_router

    default_llm, role_llms, _byok = build_role_router(user["id"], lambda *a: None)
    from novel_agent.agents import Planner
    from novel_agent.memory import StoryBible

    bible_obj = StoryBible(bible_path)
    start_index = done_chapters + 1
    new_volume = Planner(role_llms.get("planner") or default_llm).make_continuation_plan(
        bible_obj, plan, body.chapters, start_index=start_index
    )
    plan.setdefault("volumes", []).append(new_volume)
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")

    db.execute(
        "UPDATE projects SET target_chapters=target_chapters+?, status='queued', progress_msg='', error=NULL, finished_at=NULL WHERE id=?",
        (body.chapters, pid),
    )
    submit(pid)
    return _project_brief(dict(db.q_one("SELECT * FROM projects WHERE id=?", (pid,))))


def _own_project(project_id: int, user: CurrentUser) -> dict:
    row = db.q_one("SELECT * FROM projects WHERE id=?", (project_id,))
    if not row:
        raise HTTPException(404, "工程不存在")
    if row["user_id"] != user["id"] and not user.is_admin:
        raise HTTPException(403, "无权访问该工程")
    return dict(row)


# 常见模型 token 单价（元 / 1M tokens），用于成本看板估算。
# 按子串匹配（小写）；未命中按默认价估算。价格随官方调整，运营时请在此维护。
_MODEL_PRICES = [
    ("deepseek-reasoner", 8.0, 24.0),
    ("deepseek", 2.0, 8.0),
    ("kimi-k3", 8.0, 32.0),
    ("kimi", 4.0, 16.0),
    ("qwen", 4.0, 12.0),
    ("gpt-4o-mini", 1.1, 4.4),
    ("gpt-4o", 18.0, 72.0),
]
_DEFAULT_TOKEN_PRICE = (4.0, 16.0)


def _token_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """按模型单价估算调用成本（元）。"""
    m = (model or "").lower()
    pin, pout = _DEFAULT_TOKEN_PRICE
    for key, i, o in _MODEL_PRICES:
        if key in m:
            pin, pout = i, o
            break
    return prompt_tokens / 1_000_000 * pin + completion_tokens / 1_000_000 * pout


@router.get("/projects/{pid}")
def project_detail(pid: int, user: CurrentUser = Depends(get_current_user)):
    proj = _own_project(pid, user)
    chapters = db.q(
        "SELECT idx,title,summary,revise_rounds FROM chapters WHERE project_id=? ORDER BY idx",
        (pid,),
    )
    usage = db.q_one(
        """SELECT COUNT(*) AS calls,
                  COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
                  COALESCE(SUM(completion_tokens),0) AS completion_tokens
           FROM usage_logs WHERE project_id=?""",
        (pid,),
    )
    return {**_project_brief(proj), "chapters": [dict(c) for c in chapters], "usage": dict(usage)}


@router.get("/projects/{pid}/chapters/{idx}")
def chapter_text(pid: int, idx: int, user: CurrentUser = Depends(get_current_user)):
    _own_project(pid, user)
    row = db.q_one(
        "SELECT * FROM chapters WHERE project_id=? AND idx=?", (pid, idx)
    )
    if not row:
        raise HTTPException(404, "章节尚未生成")
    r = dict(row)
    r["issues"] = json.loads(r.pop("issues_json") or "[]")
    return r


@router.get("/projects/{pid}/export", response_class=PlainTextResponse)
def export_md(pid: int, user: CurrentUser = Depends(get_current_user)):
    _own_project(pid, user)
    rows = db.q(
        "SELECT idx,title,text FROM chapters WHERE project_id=? ORDER BY idx", (pid,)
    )
    if not rows:
        raise HTTPException(400, "还没有可导出的章节")
    proj = db.q_one("SELECT name FROM projects WHERE id=?", (pid,))
    parts = [f"# {proj['name']}", ""]
    for r in rows:
        parts += [f"## 第{r['idx']}章 {r['title']}", "", r["text"], ""]
    return "\n".join(parts)


# --------------------------------------------------------------------- #
# 生成直播流（SSE）：逐章正文增量实时推送。
# EventSource 无法携带请求头，token 走 query（仅限此只读流端点）。
# --------------------------------------------------------------------- #
def _stream_user(token: str) -> CurrentUser:
    if not token:
        raise HTTPException(401, "未登录")
    row = db.q_one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?",
        (token,),
    )
    if not row:
        raise HTTPException(401, "登录已失效")
    if not row["enabled"]:
        raise HTTPException(403, "账号已被停用")
    return CurrentUser(dict(row))


@router.get("/projects/{pid}/stream")
def project_stream(pid: int, token: str = ""):
    import queue as _queue

    from fastapi.responses import StreamingResponse

    from . import streams

    user = _stream_user(token)
    proj = _own_project(pid, user)
    if proj["status"] not in ("queued", "running", "done"):
        raise HTTPException(400, "工程不在可直播状态")

    q: _queue.Queue = _queue.Queue(maxsize=1000)

    def gen():
        snap = streams.snapshot(pid)
        if snap is None:
            yield 'data: {"type": "ended"}\n\n'
            return
        yield f"data: {json.dumps({'type': 'snapshot', 'texts': snap['texts'], 'events': snap['events']}, ensure_ascii=False)}\n\n"
        streams.subscribe(pid, q)
        try:
            while True:
                try:
                    ev = q.get(timeout=15)
                except _queue.Empty:
                    yield ": keep-alive\n\n"
                    continue
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                if ev.get("type") in ("done", "failed"):
                    break
        finally:
            streams.unsubscribe(pid, q)

    return StreamingResponse(gen(), media_type="text/event-stream")


# --------------------------------------------------------------------- #
# 商业化：商品目录 / 订单 / 自有 API（BYOK）
# --------------------------------------------------------------------- #
@router.get("/catalog")
def catalog(user: CurrentUser = Depends(get_current_user)):
    return {
        "plans": list(PLANS.values()),
        "packs": list(PACKS.values()),
        "balance": {
            "plan": user["plan"],
            "plan_name": PLANS.get(user["plan"], PLANS["free"])["name"],
            "plan_chapters": user["plan_chapters"],
            "used_chapters": user["used_chapters"],
            "plan_reset_at": user["plan_reset_at"],
            "extra_chapters": user["extra_chapters"],
            "remaining_chapters": max(0, user["plan_chapters"] - user["used_chapters"]) + user["extra_chapters"],
            "byok": _has_byok(user["id"]),
        },
    }


@router.post("/orders", status_code=201)
def create_order(body: OrderCreateIn, user: CurrentUser = Depends(get_current_user)):
    item = CATALOG.get(body.product_code)
    if not item:
        raise HTTPException(404, "商品不存在")
    oid = db.execute(
        """INSERT INTO orders(user_id,kind,product_code,title,amount_cents,status,months,chapters)
           VALUES(?,?,?,?,?,'pending',?,?)""",
        (
            user["id"],
            "plan" if body.product_code in PLANS else "pack",
            item["code"],
            item["name"],
            item["price_cents"],
            item.get("months", 1),
            item["chapters"],
        ),
    )
    return dict(db.q_one("SELECT * FROM orders WHERE id=?", (oid,)))


def _apply_order(order: dict) -> None:
    """订单生效：订阅写套餐与重置日；加油包叠加额度。"""
    today = db.q_one("SELECT date('now','localtime') AS d")["d"]
    if order["kind"] == "plan":
        item = PLANS[order["product_code"]]
        db.execute(
            "UPDATE users SET plan=?, plan_chapters=?, used_chapters=0, plan_reset_at=? WHERE id=?",
            (item["code"], item["chapters"], auth._add_months(today, 1), order["user_id"]),
        )
    else:
        db.execute(
            "UPDATE users SET extra_chapters = extra_chapters + ? WHERE id=?",
            (order["chapters"], order["user_id"]),
        )


def _mark_paid(oid: int, trade_no: str = "") -> None:
    """幂等到账：pending → paid 并发放额度；重复回调/重复点击安全。"""
    order = db.q_one("SELECT * FROM orders WHERE id=?", (oid,))
    if not order or order["status"] != "pending":
        return
    db.execute(
        """UPDATE orders SET status='paid', trade_no=?, paid_at=datetime('now','localtime')
           WHERE id=? AND status='pending'""",
        (trade_no or None, oid),
    )
    _apply_order(dict(order))


@router.post("/orders/{oid}/pay")
def pay_order(oid: int, user: CurrentUser = Depends(get_current_user)):
    """模拟支付（等价于 checkout 的 mock 通道，兼容旧前端/脚本）。"""
    order = db.q_one("SELECT * FROM orders WHERE id=?", (oid,))
    if not order or order["user_id"] != user["id"]:
        raise HTTPException(404, "订单不存在")
    if order["status"] == "paid":
        return dict(order)
    if order["status"] != "pending":
        raise HTTPException(400, "订单已关闭，无法支付")
    _mark_paid(oid, "mock")
    return dict(db.q_one("SELECT * FROM orders WHERE id=?", (oid,)))


class CheckoutIn(BaseModel):
    channel: str = "mock"   # mock / wechat / alipay


@router.post("/orders/{oid}/checkout")
def checkout_order(oid: int, body: CheckoutIn, user: CurrentUser = Depends(get_current_user)):
    """收银台：按通道创建支付会话。mock 即时到账；wechat 返回二维码内容；alipay 返回跳转地址。"""
    order = db.q_one("SELECT * FROM orders WHERE id=?", (oid,))
    if not order or order["user_id"] != user["id"]:
        raise HTTPException(404, "订单不存在")
    if order["status"] == "paid":
        return {"type": "paid"}
    if order["status"] != "pending":
        raise HTTPException(400, "订单已关闭，无法支付")
    if body.channel not in ("mock", "wechat", "alipay"):
        raise HTTPException(400, "不支持的支付通道")
    db.execute("UPDATE orders SET channel=? WHERE id=?", (body.channel, oid))
    if body.channel == "mock":
        _mark_paid(oid, "mock")
        return {"type": "paid"}
    # 用户显式选择的通道直接调用对应实现（与 PAY_CHANNEL 环境默认无关）
    from .payments import PaymentError
    from .payments import alipay as alipay_channel
    from .payments import wechat as wechat_channel

    try:
        if body.channel == "wechat":
            result = wechat_channel.checkout(dict(order), dict(user))
        else:
            result = alipay_channel.checkout(dict(order), dict(user))
    except PaymentError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"支付通道调用失败：{e}")
    return {"type": result.type, "url": result.url, "code_url": result.code_url}


@router.get("/orders/{oid}")
def order_status(oid: int, user: CurrentUser = Depends(get_current_user)):
    """收银台轮询：二维码/跳转支付时前端每 2-3 秒查询一次到账状态。"""
    order = db.q_one("SELECT * FROM orders WHERE id=?", (oid,))
    if not order or order["user_id"] != user["id"]:
        raise HTTPException(404, "订单不存在")
    return dict(order)


# --------------------------------------------------------------------- #
# 支付网关异步回调（无需登录；验签 + 金额核对 + 幂等）
# --------------------------------------------------------------------- #
@router.post("/pay/wechat/notify")
async def wechat_notify(request: Request):
    from .payments import PaymentError
    from .payments import wechat as wechat_channel

    body = (await request.body()).decode("utf-8")
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        result = wechat_channel.verify_notify(headers, body)
    except PaymentError as e:
        # 按微信 V3 协议返回失败，平台会重推
        return JSONResponse({"code": "FAIL", "message": str(e)[:200]}, status_code=200)
    order = db.q_one("SELECT * FROM orders WHERE id=?", (result.order_id,))
    if not order or result.amount_cents != order["amount_cents"]:
        return JSONResponse({"code": "FAIL", "message": "订单不存在或金额不符"}, status_code=200)
    _mark_paid(result.order_id, result.channel_trade_no)
    return JSONResponse({"code": "SUCCESS", "message": "成功"})


@router.post("/pay/alipay/notify")
async def alipay_notify(request: Request):
    import urllib.parse

    from .payments import PaymentError

    body = (await request.body()).decode("utf-8")
    form = dict(urllib.parse.parse_qsl(body, keep_blank_values=True))
    try:
        from .payments import alipay as alipay_channel
        result = alipay_channel.verify_notify(form)
    except PaymentError:
        return PlainTextResponse("fail", status_code=200)
    order = db.q_one("SELECT * FROM orders WHERE id=?", (result.order_id,))
    if not order:
        return PlainTextResponse("fail", status_code=200)
    # 金额核对：回调金额必须与订单一致，防篡改
    if result.amount_cents != order["amount_cents"]:
        return PlainTextResponse("fail", status_code=200)
    _mark_paid(result.order_id, result.channel_trade_no)
    return PlainTextResponse("success", status_code=200)


@router.get("/orders")
def my_orders(user: CurrentUser = Depends(get_current_user)):
    rows = db.q(
        "SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 100", (user["id"],)
    )
    return [dict(r) for r in rows]


# ----- 用户自带 API Key（BYOK）----- #
@router.get("/my-provider")
def get_my_provider(user: CurrentUser = Depends(get_current_user)):
    row = db.q_one("SELECT * FROM user_provider WHERE user_id=?", (user["id"],))
    if not row:
        return {"configured": False}
    return {
        "configured": True,
        "base_url": row["base_url"],
        "model": row["model"],
        "temperature": row["temperature"],
        "max_tokens": row["max_tokens"],
        "enabled": bool(row["enabled"]),
        "updated_at": row["updated_at"],
        "key_preview": security.mask_key(security.decrypt(row["api_key_enc"])),
    }


@router.put("/my-provider")
def put_my_provider(body: MyProviderIn, user: CurrentUser = Depends(get_current_user)):
    old = db.q_one("SELECT * FROM user_provider WHERE user_id=?", (user["id"],))
    if old and not body.api_key:
        key_enc = old["api_key_enc"]  # 留空保持原 Key
    elif body.api_key:
        key_enc = security.encrypt(body.api_key.strip())
    else:
        raise HTTPException(400, "首次保存必须填写 API Key")
    if not old:
        db.execute(
            """INSERT INTO user_provider(user_id,base_url,api_key_enc,model,temperature,max_tokens,enabled)
               VALUES(?,?,?,?,?,?,?)""",
            (user["id"], body.base_url.strip(), key_enc, body.model.strip(),
             body.temperature, body.max_tokens, int(body.enabled)),
        )
    else:
        db.execute(
            """UPDATE user_provider SET base_url=?,api_key_enc=?,model=?,temperature=?,max_tokens=?,
               enabled=?, updated_at=datetime('now','localtime') WHERE user_id=?""",
            (body.base_url.strip(), key_enc, body.model.strip(),
             body.temperature, body.max_tokens, int(body.enabled), user["id"]),
        )
    return {"ok": True}


@router.delete("/my-provider")
def delete_my_provider(user: CurrentUser = Depends(get_current_user)):
    db.execute("DELETE FROM user_provider WHERE user_id=?", (user["id"],))
    return {"ok": True}


# --------------------------------------------------------------------- #
# 管理后台
# --------------------------------------------------------------------- #
@router.get("/admin/provider")
def get_provider(admin: CurrentUser = Depends(require_admin)):
    row = db.q_one("SELECT * FROM provider_config WHERE id=1")
    if not row:
        return {"configured": False}
    key = security.decrypt(row["api_key_enc"])
    return {
        "configured": True,
        "base_url": row["base_url"],
        "model": row["model"],
        "temperature": row["temperature"],
        "max_tokens": row["max_tokens"],
        "updated_at": row["updated_at"],
        "key_preview": security.mask_key(key),  # 只回显掩码，永不回传明文
    }


@router.put("/admin/provider")
def put_provider(body: ProviderIn, admin: CurrentUser = Depends(require_admin)):
    old = db.q_one("SELECT * FROM provider_config WHERE id=1")
    key_enc = old["api_key_enc"] if (old and not body.api_key) else security.encrypt(body.api_key.strip())
    if not old:
        db.execute(
            """INSERT INTO provider_config(id,base_url,api_key_enc,model,temperature,max_tokens)
               VALUES(1,?,?,?,?,?)""",
            (body.base_url.strip(), key_enc, body.model.strip(), body.temperature, body.max_tokens),
        )
    else:
        db.execute(
            """UPDATE provider_config SET base_url=?,api_key_enc=?,model=?,temperature=?,max_tokens=?,
               updated_at=datetime('now','localtime') WHERE id=1""",
            (body.base_url.strip(), key_enc, body.model.strip(), body.temperature, body.max_tokens),
        )
    return {"ok": True}


# ----- 模型路由（按流水线角色指定模型）----- #
def _route_public(row) -> dict:
    return {
        "role": row["role"],
        "base_url": row["base_url"],
        "model": row["model"],
        "temperature": row["temperature"],
        "max_tokens": row["max_tokens"],
        "enabled": bool(row["enabled"]),
        "updated_at": row["updated_at"],
        "key_preview": security.mask_key(security.decrypt(row["api_key_enc"])),
    }


@router.get("/admin/model-routes")
def get_model_routes(admin: CurrentUser = Depends(require_admin)):
    rows = db.q("SELECT * FROM model_routes ORDER BY role")
    configured = {r["role"]: _route_public(r) for r in rows}
    # 全角色列表：未配置的角色返回 enabled=False 占位，方便前端渲染
    return [
        configured.get(role) or {"role": role, "configured": False, "enabled": False}
        for role in ROLES
    ]


@router.put("/admin/model-routes")
def put_model_route(body: ModelRouteIn, admin: CurrentUser = Depends(require_admin)):
    if body.role not in ROLES:
        raise HTTPException(400, f"非法角色：{body.role}（可选：{'/'.join(ROLES)}）")
    old = db.q_one("SELECT * FROM model_routes WHERE role=?", (body.role,))
    if old and not body.api_key:
        key_enc = old["api_key_enc"]  # 留空保持原 Key
    elif body.api_key:
        key_enc = security.encrypt(body.api_key.strip())
    else:
        raise HTTPException(400, "首次保存必须填写 API Key")
    if not old:
        db.execute(
            """INSERT INTO model_routes(role,base_url,api_key_enc,model,temperature,max_tokens,enabled)
               VALUES(?,?,?,?,?,?,?)""",
            (body.role, body.base_url.strip(), key_enc, body.model.strip(),
             body.temperature, body.max_tokens, int(body.enabled)),
        )
    else:
        db.execute(
            """UPDATE model_routes SET base_url=?,api_key_enc=?,model=?,temperature=?,max_tokens=?,
               enabled=?, updated_at=datetime('now','localtime') WHERE role=?""",
            (body.base_url.strip(), key_enc, body.model.strip(),
             body.temperature, body.max_tokens, int(body.enabled), body.role),
        )
    row = db.q_one("SELECT * FROM model_routes WHERE role=?", (body.role,))
    return _route_public(row)


@router.delete("/admin/model-routes/{role}")
def delete_model_route(role: str, admin: CurrentUser = Depends(require_admin)):
    db.execute("DELETE FROM model_routes WHERE role=?", (role,))
    return {"ok": True}


@router.get("/admin/users")
def list_users(admin: CurrentUser = Depends(require_admin)):
    rows = db.q(
        """SELECT u.*,
             (SELECT COUNT(*) FROM projects p WHERE p.user_id=u.id) AS projects,
             (SELECT COALESCE(SUM(prompt_tokens+completion_tokens),0) FROM usage_logs l WHERE l.user_id=u.id) AS tokens
           FROM users u ORDER BY u.id"""
    )
    return [
        {
            "id": r["id"],
            "username": r["username"],
            "is_admin": bool(r["is_admin"]),
            "enabled": bool(r["enabled"]),
            "quota_chapters": r["quota_chapters"],
            "used_chapters": r["used_chapters"],
            "plan": r["plan"],
            "plan_chapters": r["plan_chapters"],
            "extra_chapters": r["extra_chapters"],
            "projects": r["projects"],
            "tokens": r["tokens"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.patch("/admin/users/{uid}")
def patch_user(uid: int, body: UserPatchIn, admin: CurrentUser = Depends(require_admin)):
    target = db.q_one("SELECT * FROM users WHERE id=?", (uid,))
    if not target:
        raise HTTPException(404, "用户不存在")
    if target["is_admin"] and body.enabled is False:
        raise HTTPException(400, "不能停用管理员账号")
    fields, values = [], []
    if body.enabled is not None:
        fields.append("enabled=?")
        values.append(int(body.enabled))
    if body.quota_chapters is not None:
        fields.append("quota_chapters=?")
        values.append(body.quota_chapters)
    if body.extra_chapters is not None:
        fields.append("extra_chapters=?")
        values.append(body.extra_chapters)
    if fields:
        db.execute(f"UPDATE users SET {', '.join(fields)} WHERE id=?", (*values, uid))
    return {"ok": True}


@router.get("/admin/usage")
def usage_summary(admin: CurrentUser = Depends(require_admin)):
    totals = db.q_one(
        """SELECT
             (SELECT COUNT(*) FROM users WHERE is_admin=0) AS users,
             (SELECT COUNT(*) FROM projects) AS projects,
             (SELECT COUNT(*) FROM chapters) AS chapters,
             (SELECT COALESCE(SUM(prompt_tokens),0) FROM usage_logs) AS prompt_tokens,
             (SELECT COALESCE(SUM(completion_tokens),0) FROM usage_logs) AS completion_tokens,
             (SELECT COUNT(*) FROM usage_logs) AS calls"""
    )
    # 按模型：成本核算粒度
    by_model = db.q(
        """SELECT model,
                  COUNT(*) AS calls,
                  COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
                  COALESCE(SUM(completion_tokens),0) AS completion_tokens
           FROM usage_logs GROUP BY model ORDER BY calls DESC"""
    )
    by_model = [
        {**dict(r), "cost": round(_token_cost(r["model"], r["prompt_tokens"], r["completion_tokens"]), 4)}
        for r in by_model
    ]
    total_cost = round(sum(r["cost"] for r in by_model), 4)

    # 按用户：需要先按 用户×模型 细分才能正确核算混合模型的成本
    per_user_model = db.q(
        """SELECT u.username, l.model,
                  COUNT(l.id) AS calls,
                  COALESCE(SUM(l.prompt_tokens),0) AS prompt_tokens,
                  COALESCE(SUM(l.completion_tokens),0) AS completion_tokens
           FROM usage_logs l JOIN users u ON u.id=l.user_id
           GROUP BY l.user_id, l.model"""
    )
    per_user_map: dict = {}
    for r in per_user_model:
        agg = per_user_map.setdefault(r["username"], {
            "username": r["username"], "calls": 0, "prompt_tokens": 0,
            "completion_tokens": 0, "projects": 0, "cost": 0.0,
        })
        agg["calls"] += r["calls"]
        agg["prompt_tokens"] += r["prompt_tokens"]
        agg["completion_tokens"] += r["completion_tokens"]
        agg["cost"] += _token_cost(r["model"], r["prompt_tokens"], r["completion_tokens"])
    for r in db.q(
        """SELECT u.username, COUNT(DISTINCT l.project_id) AS projects
           FROM usage_logs l JOIN users u ON u.id=l.user_id
           GROUP BY l.user_id"""
    ):
        if r["username"] in per_user_map:
            per_user_map[r["username"]]["projects"] = r["projects"]
    per_user = sorted(
        ({**v, "cost": round(v["cost"], 4)} for v in per_user_map.values()),
        key=lambda x: -x["cost"],
    )

    daily = db.q(
        """SELECT date(created_at) AS day,
                  COUNT(*) AS calls,
                  COALESCE(SUM(prompt_tokens+completion_tokens),0) AS tokens
           FROM usage_logs
           WHERE created_at >= date('now','localtime','-29 days')
           GROUP BY day ORDER BY day"""
    )
    return {
        "totals": {**dict(totals), "cost": total_cost},
        "by_model": by_model,
        "per_user": per_user,
        "daily": [dict(r) for r in daily],
    }


@router.get("/admin/orders")
def admin_orders(admin: CurrentUser = Depends(require_admin)):
    rows = db.q(
        """SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id
           ORDER BY o.id DESC LIMIT 200"""
    )
    return [dict(r) for r in rows]


@router.post("/admin/orders/{oid}/cancel")
def admin_cancel_order(oid: int, admin: CurrentUser = Depends(require_admin)):
    order = db.q_one("SELECT * FROM orders WHERE id=?", (oid,))
    if not order:
        raise HTTPException(404, "订单不存在")
    if order["status"] == "paid":
        raise HTTPException(400, "已支付订单不能取消（如需退款请线下处理并手动调整用户额度）")
    db.execute(
        "UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'", (oid,)
    )
    return {"ok": True}
