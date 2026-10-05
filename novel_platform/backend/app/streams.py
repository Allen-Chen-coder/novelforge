"""生成直播流的进程内发布订阅。

runner（工作线程）发布章节流式事件；SSE 端点（请求线程）订阅并推给浏览器。
- start(pid)：新一次运行前重置该工程的流状态（续写复用同一 pid）。
- publish(pid, event)：事件进入快照缓冲（晚加入的客户端先收到快照再收实时事件）。
- subscribe/unsubscribe：SSE 端点用 queue.Queue 订阅。

事件类型：
    status       {"type","status","msg"}            运行状态变化
    chapter_start{"type","index","title"}           开始写某一章
    chunk        {"type","index","text"}            本章正文增量
    chapter_done {"type","index","title","summary"} 本章定稿（已入库）
    done         {"type"}                           全部完成
    failed       {"type","error"}                   运行失败
"""
from __future__ import annotations

import queue
import threading
from typing import Any, Optional

_lock = threading.Lock()
# pid -> {"subs": set[Queue], "events": deque(最近事件), "texts": {index: 累积正文}}
_broker: dict[int, dict[str, Any]] = {}
_BUFFER = 200  # 快照保留的最近事件数（chunk 除外，正文走 texts 全量）


def start(pid: int) -> None:
    """（重）置某工程的流状态，返回发布句柄用的状态字典。"""
    with _lock:
        _broker[pid] = {"subs": set(), "events": [], "texts": {}}


def publish(pid: int, event: dict) -> None:
    with _lock:
        st = _broker.get(pid)
        if st is None:
            return
        et = event.get("type")
        if et == "chunk":
            st["texts"][event["index"]] = st["texts"].get(event["index"], "") + event["text"]
        elif et == "chapter_start":
            st["texts"][event["index"]] = ""
        if et != "chunk":  # chunk 高频，只留正文快照；其余事件全量留档
            st["events"].append(event)
            del st["events"][:-_BUFFER]
        subs = list(st["subs"])
    for q in subs:
        try:
            q.put_nowait(event)
        except queue.Full:
            pass  # 慢消费者丢帧，不拖垮生成


def snapshot(pid: int) -> Optional[dict]:
    """给晚加入客户端的初始快照：已发生事件 + 各章当前累积正文。"""
    with _lock:
        st = _broker.get(pid)
        if st is None:
            return None
        return {"events": list(st["events"]), "texts": dict(st["texts"])}


def subscribe(pid: int, q: "queue.Queue") -> bool:
    with _lock:
        st = _broker.get(pid)
        if st is None:
            return False
        st["subs"].add(q)
        return True


def unsubscribe(pid: int, q: "queue.Queue") -> None:
    with _lock:
        st = _broker.get(pid)
        if st:
            st["subs"].discard(q)
