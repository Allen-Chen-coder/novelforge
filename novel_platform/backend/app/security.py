"""API Key 的服务端加密存储（Fernet + 机器本地密钥文件）。

密钥文件 data/secret.key 只存在服务端机器上；前端/普通用户永远拿不到明文。
"""
from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet

KEY_PATH = Path(__file__).resolve().parents[1] / "data" / "secret.key"


def _fernet() -> Fernet:
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not KEY_PATH.exists():
        KEY_PATH.write_bytes(Fernet.generate_key())
        try:
            os.chmod(KEY_PATH, 0o600)
        except OSError:
            pass
    return Fernet(KEY_PATH.read_bytes())


def encrypt(text: str) -> str:
    return _fernet().encrypt(text.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    return _fernet().decrypt(token.encode("ascii")).decode("utf-8")


def mask_key(key: str) -> str:
    if len(key) <= 8:
        return "****"
    return key[:4] + "****" + key[-4:]
