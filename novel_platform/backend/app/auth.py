"""认证：PBKDF2 密码散列 + Token 会话。管理员账号首次启动时自动创建。"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
from typing import Optional

from fastapi import Depends, Header, HTTPException

from . import db

ADMIN_USERNAME = os.environ.get("NOVEL_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("NOVEL_ADMIN_PASSWORD", "admin123")
DEFAULT_USER_QUOTA = int(os.environ.get("NOVEL_DEFAULT_QUOTA", "100"))


# --------------------------------------------------------------------- #
def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return salt.hex() + "$" + dk.hex()


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$")
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 120_000)
    return hmac.compare_digest(dk.hex(), dk_hex)


# --------------------------------------------------------------------- #
def create_user(username: str, password: str, is_admin: bool = False) -> int:
    if not (3 <= len(username) <= 32):
        raise HTTPException(400, "用户名长度需 3-32 位")
    if len(password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    try:
        uid = db.execute(
            "INSERT INTO users(username,password_hash,is_admin,quota_chapters) VALUES(?,?,?,?)",
            (username, hash_password(password), int(is_admin), DEFAULT_USER_QUOTA),
        )
        settle_plan_cycle(uid, None)  # free 套餐：20 章/月，下月重置
        return uid
    except sqlite3.IntegrityError:
        raise HTTPException(409, "用户名已存在")


def login(username: str, password: str) -> str:
    row = db.q_one("SELECT * FROM users WHERE username=?", (username,))
    if not row or not verify_password(password, row["password_hash"]):
        raise HTTPException(401, "用户名或密码错误")
    if not row["enabled"]:
        raise HTTPException(403, "账号已被停用，请联系管理员")
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions(token,user_id) VALUES(?,?)", (token, row["id"]))
    return token


def seed_admin() -> None:
    if not db.q_one("SELECT id FROM users WHERE is_admin=1 LIMIT 1"):
        create_user(ADMIN_USERNAME, ADMIN_PASSWORD, is_admin=True)
        print(f"[init] 管理员账号已创建: {ADMIN_USERNAME}（请尽快登录修改/妥善保管）")


# --------------------------------------------------------------------- #
class CurrentUser(dict):
    @property
    def is_admin(self) -> bool:
        return bool(self.get("is_admin"))


# --------------------------------------------------------------------- #
def _add_months(day: str, n: int) -> str:
    y, m, d = int(day[:4]), int(day[5:7]), int(day[8:10])
    m += n
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    import calendar
    d = min(d, calendar.monthrange(y, m)[1])
    return f"{y:04d}-{m:02d}-{d:02d}"


def settle_plan_cycle(user_id: int, reset_at: Optional[str]) -> None:
    """订阅额度按月重置：到 reset_at 当天清零 used_chapters 并顺延一个计费月。"""
    today = db.q_one("SELECT date('now','localtime') AS d")["d"]
    if not reset_at:
        db.execute(
            "UPDATE users SET plan_reset_at=? WHERE id=?",
            (_add_months(today, 1), user_id),
        )
        return
    while today >= reset_at:
        next_reset = _add_months(reset_at, 1)
        db.execute(
            "UPDATE users SET used_chapters=0, plan_reset_at=? WHERE id=?",
            (next_reset, user_id),
        )
        reset_at = next_reset


def get_current_user(authorization: str = Header(default="")) -> CurrentUser:
    token = authorization.removeprefix("Bearer ").strip()
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
    settle_plan_cycle(row["id"], row["plan_reset_at"])
    row = db.q_one("SELECT * FROM users WHERE id=?", (row["id"],))
    return CurrentUser(dict(row))


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(403, "需要管理员权限")
    return user
