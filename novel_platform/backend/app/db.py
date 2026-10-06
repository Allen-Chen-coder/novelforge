"""SQLite 持久化层（线程安全）。

表：users / sessions / provider_config / projects / chapters / usage_logs
"""
from __future__ import annotations

import contextlib
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "platform.db"
_lock = threading.RLock()


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    quota_chapters INTEGER NOT NULL DEFAULT 100,   -- 历史遗留字段，新逻辑用 plan/extra_chapters
    used_chapters INTEGER NOT NULL DEFAULT 0,
    plan TEXT NOT NULL DEFAULT 'free',
    plan_chapters INTEGER NOT NULL DEFAULT 20,
    plan_reset_at TEXT,                            -- 下次额度重置日期 YYYY-MM-DD
    extra_chapters INTEGER NOT NULL DEFAULT 0,     -- 加油包/管理员手动叠加，永不过期
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                 -- 'plan' 订阅 / 'pack' 加油包
    product_code TEXT NOT NULL,
    title TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending/paid/cancelled
    months INTEGER NOT NULL DEFAULT 1,
    chapters INTEGER NOT NULL DEFAULT 0,
    channel TEXT NOT NULL DEFAULT 'mock',   -- mock/wechat/alipay
    trade_no TEXT,                          -- 第三方支付单号（对账用）
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    paid_at TEXT
);

CREATE TABLE IF NOT EXISTS user_provider (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    base_url TEXT NOT NULL,
    api_key_enc TEXT NOT NULL,          -- Fernet 加密后的用户自有 Key
    model TEXT NOT NULL,
    temperature REAL NOT NULL DEFAULT 0.8,
    max_tokens INTEGER NOT NULL DEFAULT 8192,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS provider_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    base_url TEXT NOT NULL,
    api_key_enc TEXT NOT NULL,          -- Fernet 加密后的第三方 API Key
    model TEXT NOT NULL,
    temperature REAL NOT NULL DEFAULT 0.8,
    max_tokens INTEGER NOT NULL DEFAULT 8192,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 模型路由：按流水线角色（planner/writer/critic/reviser/summarizer）指定不同模型。
-- 未配置或未启用的角色回退到平台默认（或用户 BYOK）。
CREATE TABLE IF NOT EXISTS model_routes (
    role TEXT PRIMARY KEY,              -- planner/writer/critic/reviser/summarizer
    base_url TEXT NOT NULL,
    api_key_enc TEXT NOT NULL,          -- Fernet 加密
    model TEXT NOT NULL,
    temperature REAL NOT NULL DEFAULT 0.8,
    max_tokens INTEGER NOT NULL DEFAULT 8192,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    idea TEXT NOT NULL,
    genre TEXT NOT NULL DEFAULT '',
    target_chapters INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',  -- queued/running/done/failed
    progress_msg TEXT NOT NULL DEFAULT '',
    chapters_done INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    revise_rounds INTEGER NOT NULL DEFAULT 0,
    issues_json TEXT NOT NULL DEFAULT '[]',
    UNIQUE(project_id, idx)
);

CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

-- 短信验证码（注册/绑号），存哈希不存明文
CREATE TABLE IF NOT EXISTS sms_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    scene TEXT NOT NULL DEFAULT 'register',   -- register / bind
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,                 -- YYYY-MM-DD HH:MM:SS 本地时间
    used INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sms_phone ON sms_codes(phone, scene, created_at);

-- 内测码：注册门槛，唯一 6 位数字，一次性核销
CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    used_by INTEGER,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_invite_used ON invite_codes(used_by);
"""

# 老库兼容：逐列补齐（已存在则忽略）
_ENSURE_COLUMNS = [
    ("users", "plan", "TEXT NOT NULL DEFAULT 'free'"),
    ("users", "plan_chapters", "INTEGER NOT NULL DEFAULT 20"),
    ("users", "plan_reset_at", "TEXT"),
    ("users", "extra_chapters", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "phone", "TEXT"),
    ("users", "email", "TEXT"),
    ("orders", "channel", "TEXT NOT NULL DEFAULT 'mock'"),
    ("orders", "trade_no", "TEXT"),
    ("projects", "target_words", "INTEGER NOT NULL DEFAULT 3000"),
    ("users", "pen_name", "TEXT"),
    ("users", "author_bio", "TEXT"),
]


def _migrate(conn: sqlite3.Connection) -> None:
    for table, col, ddl in _ENSURE_COLUMNS:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
        except sqlite3.OperationalError:
            pass


@contextlib.contextmanager
def _session() -> "contextlib.AbstractContextManager[sqlite3.Connection]":
    """加锁获取连接并在退出时真正关闭。

    sqlite3 连接对象的 with 语句只管理事务、不关闭连接；此前每个查询都泄漏一个
    文件描述符，长跑进程会在数小时内撞 ulimit -n（1024），报
    "unable to open database file"（EMFILE）。
    """
    with _lock:
        conn = get_conn()
        try:
            yield conn
        finally:
            conn.close()


def init_db() -> None:
    with _session() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        # 手机号/邮箱唯一索引必须在补列之后创建（老库 users 表无 phone/email 列）；
        # 存量数据若存在重复值则不建索引，由应用层唯一性校验兜底，避免启动崩溃
        for ddl in (
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL",
        ):
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass
        conn.commit()


def q(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    with _session() as conn:
        return conn.execute(sql, params).fetchall()


def q_one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    rows = q(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: tuple = ()) -> int:
    with _session() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid


def execute_rowcount(sql: str, params: tuple = ()) -> int:
    """返回受影响行数，用于条件更新（如内测码核销）的并发安全判断。"""
    with _session() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.rowcount
