"""后台执行器：串行队列跑小说流水线。

- 每个工程一个独立运行目录 data/runs/<project_id>/（plan.json + story_bible.json）
- 进度实时写回 projects 表；完成后把章节同步进 chapters 表并结算用户配额
- LLM 每次调用的 token 用量经 usage_callback 落 usage_logs 表
"""
from __future__ import annotations

import json
import logging
import os
import queue
import re
import threading
from pathlib import Path

from . import db, security
from . import streams
from .llm_shim import (
    build_role_router,
    get_user_provider_row,
    provider_ready,
)

log = logging.getLogger("runner")
RUNS_DIR = Path(__file__).resolve().parents[1] / "data" / "runs"

_q: queue.Queue[int] = queue.Queue()
_started = False


def submit(project_id: int) -> None:
    _q.put(project_id)


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    t = threading.Thread(target=_loop, name="novel-runner", daemon=True)
    t.start()
    log.info("runner started")


def _loop() -> None:
    while True:
        project_id = _q.get()
        try:
            _run_project(project_id)
        except Exception:
            log.exception("project %s failed", project_id)
        finally:
            _q.task_done()


def _set(project_id: int, **fields) -> None:
    cols = ", ".join(f"{k}=?" for k in fields)
    db.execute(f"UPDATE projects SET {cols} WHERE id=?", (*fields.values(), project_id))


def _progress_updater(project_id: int, user_id: int):
    run_dir = RUNS_DIR / str(project_id)

    def update(msg: str) -> None:
        done = 0
        bible_file = run_dir / "story_bible.json"
        if bible_file.exists():
            try:
                done = len(json.loads(bible_file.read_text(encoding="utf-8")).get("chapters", []))
            except Exception:
                pass
        _set(project_id, progress_msg=msg[:500], chapters_done=done)

    return update


def _run_project(project_id: int) -> None:
    row = db.q_one("SELECT * FROM projects WHERE id=?", (project_id,))
    if not row or row["status"] not in ("queued", "running"):
        return
    user_id = row["user_id"]
    if not provider_ready() and not get_user_provider_row(user_id):
        _set(project_id, status="failed", error="管理员尚未配置模型服务商 API Key，且你未配置自有 API")
        return

    run_dir = RUNS_DIR / str(project_id)
    run_dir.mkdir(parents=True, exist_ok=True)
    streams.start(project_id)  # 重置直播流状态（续写复用同一 pid）
    _set(project_id, status="running", error=None)

    def meter(model: str, ptoks: int, ctoks: int) -> None:
        db.execute(
            "INSERT INTO usage_logs(user_id,project_id,model,prompt_tokens,completion_tokens) VALUES(?,?,?,?,?)",
            (user_id, project_id, model, ptoks, ctoks),
        )

    try:
        llm, role_llms, byok = build_role_router(user_id, meter)
    except Exception as e:
        _set(project_id, status="failed", error=f"模型配置无效：{e}")
        return
    progress_db = _progress_updater(project_id, user_id)

    def progress(msg: str) -> None:
        # 进度双写：落库（轮询兜底）+ 直播流（弹幕时间线）
        streams.publish(project_id, {"type": "progress", "msg": msg[:200]})
        progress_db(msg)

    # 直播流：逐章正文增量 + 定稿事件推给 SSE 订阅者
    streams.publish(project_id, {"type": "status", "status": "running"})
    started: set[int] = set()

    def _chunk(idx: int, delta: str) -> None:
        if idx not in started:  # 该章首个 chunk 先到，补发 chapter_start
            started.add(idx)
            streams.publish(project_id, {"type": "chapter_start", "index": idx})
        streams.publish(project_id, {"type": "chunk", "index": idx, "text": delta})

    from novel_agent.pipeline import NovelPipeline

    pipeline = NovelPipeline(
        llm,
        run_dir,
        {
            "rolling_summary_chapters": 5,
            "max_revise_rounds": 2,
            "target_words": row["target_words"] or 3000,
            # 修订验收门：RM 评审判定修订稿未改进则拒收（可用 NOVEL_REWARD_GATE=off 关闭）
            "reward_gate": os.environ.get("NOVEL_REWARD_GATE", "on").lower() not in ("off", "0", "false"),
        },
        on_progress=progress,
        role_llms=role_llms,
        on_chapter_chunk=_chunk,
        on_chapter_done=lambda idx, rec: streams.publish(
            project_id,
            {"type": "chapter_done", "index": idx, "title": rec.get("title", ""),
             "summary": rec.get("summary", "")},
        ),
    )

    try:
        bible = pipeline.run(
            idea=row["idea"],
            genre=row["genre"] or "",
            target_chapters=row["target_chapters"],
        )
    except Exception as e:
        streams.publish(project_id, {"type": "failed", "error": str(e)[:300]})
        _set(project_id, status="failed", error=str(e)[:300])
        raise

    # 同步章节入库 + 结算配额（续写场景只结算本次新增的章节）
    chapters = bible.data.get("chapters", [])
    preexisting = db.q_one(
        "SELECT COUNT(*) AS c FROM chapters WHERE project_id=?", (project_id,)
    )["c"]
    for rec in chapters:
        db.execute(
            """INSERT INTO chapters(project_id,idx,title,text,summary,revise_rounds,issues_json)
               VALUES(?,?,?,?,?,?,?)
               ON CONFLICT(project_id,idx) DO UPDATE SET
                 title=excluded.title, text=excluded.text, summary=excluded.summary,
                 revise_rounds=excluded.revise_rounds, issues_json=excluded.issues_json""",
            (
                project_id,
                rec["index"],
                rec.get("title", ""),
                rec.get("text", ""),
                rec.get("summary", ""),
                rec.get("revise_rounds", 0),
                json.dumps(rec.get("issues", []), ensure_ascii=False),
            ),
        )
    if not byok:  # BYOK 用户不消耗平台章节额度；续写只结算新增章节
        db.execute(
            "UPDATE users SET used_chapters = used_chapters + ? WHERE id=?",
            (max(0, len(chapters) - preexisting), user_id),
        )
    _set(
        project_id,
        status="done",
        chapters_done=len(chapters),
        progress_msg="全部章节完成" + ("（自有 API）" if byok else ""),
        finished_at=db.q_one("SELECT datetime('now','localtime') AS t")["t"],
    )
    streams.publish(project_id, {"type": "done", "chapters": len(chapters)})
