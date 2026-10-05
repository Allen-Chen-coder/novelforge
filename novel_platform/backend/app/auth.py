"""认证：PBKDF2 密码散列 + Token 会话。管理员账号首次启动时自动创建。

登录账号体系：手机号 / 邮箱 / 兼容旧用户名。
注册走「手机号 + 短信验证码 + 内测码 + 密码」，邮箱选填——保证邮箱登录必绑手机号。
内测码为唯一 6 位数字，注册成功后一次性核销（注册失败不占码）。
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
from typing import Optional

from fastapi import Depends, Header, HTTPException

from . import db, sms

ADMIN_USERNAME = os.environ.get("NOVEL_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("NOVEL_ADMIN_PASSWORD", "admin123")
DEFAULT_USER_QUOTA = int(os.environ.get("NOVEL_DEFAULT_QUOTA", "100"))

PHONE_RE = re.compile(r"^1[3-9]\d{9}$")
INVITE_RE = re.compile(r"^\d{6}$")


def is_phone(s: str) -> bool:
    return bool(PHONE_RE.match(s.strip()))


def is_email(s: str) -> bool:
    return "@" in s and "." in s.split("@")[-1]


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
def create_user(username: str, password: str, is_admin: bool = False,
                phone: Optional[str] = None, email: Optional[str] = None) -> int:
    if not (3 <= len(username) <= 32):
        raise HTTPException(400, "用户名长度需 3-32 位")
    if len(password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    if phone and not is_phone(phone):
        raise HTTPException(400, "手机号格式不正确")
    if phone and db.q_one("SELECT id FROM users WHERE phone=?", (phone,)):
        raise HTTPException(409, "该手机号已注册，请直接登录")
    if email and db.q_one("SELECT id FROM users WHERE email=?", (email.strip().lower(),)):
        raise HTTPException(409, "该邮箱已注册，请直接登录")
    try:
        uid = db.execute(
            "INSERT INTO users(username,password_hash,is_admin,quota_chapters,phone,email) VALUES(?,?,?,?,?,?)",
            (username, hash_password(password), int(is_admin), DEFAULT_USER_QUOTA, phone,
             email.strip().lower() if email else None),
        )
        settle_plan_cycle(uid, None)  # free 套餐：20 章/月，下月重置
        return uid
    except sqlite3.IntegrityError:
        raise HTTPException(409, "用户名已存在")


# --------------------------------------------------------------------- #
# 短信验证码校验（register / bind 场景）
# --------------------------------------------------------------------- #
def verify_sms_code(phone: str, scene: str, code: str) -> None:
    """校验验证码：过期/错误/超次均拒绝，成功后作废。"""
    row = db.q_one(
        """SELECT * FROM sms_codes WHERE phone=? AND scene=? AND used=0
           ORDER BY id DESC LIMIT 1""",
        (phone, scene),
    )
    if not row:
        raise HTTPException(400, "请先获取验证码")
    if row["expires_at"] < db.q_one("SELECT datetime('now','localtime') AS t")["t"]:
        raise HTTPException(400, "验证码已过期，请重新获取")
    if row["attempts"] >= sms.MAX_ATTEMPTS:
        db.execute("UPDATE sms_codes SET used=1 WHERE id=?", (row["id"],))
        raise HTTPException(400, "验证码错误次数过多，请重新获取")
    if row["code_hash"] != sms.code_hash(code.strip()):
        db.execute("UPDATE sms_codes SET attempts=attempts+1 WHERE id=?", (row["id"],))
        raise HTTPException(400, "验证码不正确")
    db.execute("UPDATE sms_codes SET used=1 WHERE id=?", (row["id"],))


def register_with_phone(phone: str, code: str, password: str,
                        email: Optional[str] = None, penname: Optional[str] = None) -> int:
    """手机号 + 短信验证码注册。邮箱选填但一经填写即绑定（邮箱登录的前提）。"""
    if not is_phone(phone):
        raise HTTPException(400, "手机号格式不正确")
    if len(password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    verify_sms_code(phone, "register", code)
    username = (penname or "").strip() or f"读者{phone[-4:]}"
    return create_user(username, password, phone=phone, email=email)


def bind_phone(user_id: int, phone: str, code: str) -> None:
    """存量账号补绑手机号（邮箱登录的前提）。"""
    if not is_phone(phone):
        raise HTTPException(400, "手机号格式不正确")
    if db.q_one("SELECT id FROM users WHERE phone=? AND id!=?", (phone, user_id)):
        raise HTTPException(409, "该手机号已被其他账号绑定")
    verify_sms_code(phone, "bind", code)
    db.execute("UPDATE users SET phone=? WHERE id=?", (phone, user_id))


def login(account: str, password: str) -> str:
    """账号 = 手机号 / 邮箱 /（兼容）用户名。邮箱登录要求已绑定手机号。"""
    account = account.strip()
    if is_phone(account):
        row = db.q_one("SELECT * FROM users WHERE phone=?", (account,))
    elif "@" in account:
        row = db.q_one("SELECT * FROM users WHERE email=?", (account.lower(),))
        if row and not row["phone"]:
            raise HTTPException(400, "该邮箱尚未绑定手机号，请先用手机号登录后在设置中绑定")
    else:
        row = db.q_one("SELECT * FROM users WHERE username=?", (account,))
    if not row or not verify_password(password, row["password_hash"]):
        raise HTTPException(401, "账号或密码错误")
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


# --------------------------------------------------------------------- #
# 内测码：注册门槛，唯一 6 位数字，一次性
# --------------------------------------------------------------------- #
def validate_invite(code: str) -> str:
    """注册前校验内测码存在（不核销，注册成功后才核销）。"""
    code = (code or "").strip()
    if not INVITE_RE.match(code):
        raise HTTPException(400, "内测码为 6 位数字")
    if not db.q_one("SELECT code FROM invite_codes WHERE code=?", (code,)):
        raise HTTPException(400, "内测码不正确")
    return code


def consume_invite(code: str, user_id: int) -> None:
    """注册成功后核销内测码。条件更新保证并发下只核销一次。"""
    n = db.execute_rowcount(
        "UPDATE invite_codes SET used_by=?, used_at=datetime('now','localtime') "
        "WHERE code=? AND used_by IS NULL",
        (user_id, code.strip()),
    )
    if n == 0:
        raise HTTPException(400, "内测码已被使用")
