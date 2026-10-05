"""短信验证码通道：provider 抽象 + 频控。

通道由环境变量 SMS_PROVIDER 选择：
  mock（默认，开发模式：验证码打到服务日志，并在接口响应里回显，方便联调）
  aliyun（阿里云短信，需 SMS_ALIYUN_* 系列环境变量）

频控：同号 60 秒重发间隔、验证码 5 分钟有效、错 5 次作废、每号每天上限 10 条。
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import random
import string
import threading
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta

log = logging.getLogger("sms")

PROVIDER = os.environ.get("SMS_PROVIDER", "mock").lower()
CODE_TTL_SECONDS = 300          # 验证码有效期
RESEND_COOLDOWN = 60            # 重发间隔
MAX_ATTEMPTS = 5                # 校验失败次数上限
DAILY_LIMIT_PER_PHONE = 10      # 单号日发送上限


class SmsError(Exception):
    """短信通道配置缺失或发送失败。"""


def _cfg(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        raise SmsError(f"短信通道未配置：缺少环境变量 {name}")
    return v


# --------------------------------------------------------------------- #
# 真实通道：阿里云短信（dysms RPC V1，HMAC-SHA1 签名）
# --------------------------------------------------------------------- #
def _send_aliyun(phone: str, code: str) -> None:
    access_key = _cfg("SMS_ALIYUN_ACCESS_KEY")
    access_secret = _cfg("SMS_ALIYUN_ACCESS_SECRET")
    sign_name = _cfg("SMS_ALIYUN_SIGN")
    template_code = _cfg("SMS_ALIYUN_TEMPLATE")

    params = {
        "AccessKeyId": access_key,
        "Action": "SendSms",
        "Format": "JSON",
        "PhoneNumbers": phone,
        "RegionId": "cn-hangzhou",
        "SignName": sign_name,
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": uuid.uuid4().hex,
        "SignatureVersion": "1.0",
        "TemplateCode": template_code,
        "TemplateParam": json.dumps({"code": code}),
        "Timestamp": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Version": "2017-05-25",
    }
    query = urllib.parse.urlencode(sorted(params.items()))
    string_to_sign = "GET&%2F&" + urllib.parse.quote(query, safe="")
    signature = base64_hmac_sha1(access_secret + "&", string_to_sign)
    url = "https://dysmsapi.aliyuncs.com/?Signature=" + urllib.parse.quote(signature) + "&" + query
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        raise SmsError(f"阿里云短信调用失败：{e}")
    if data.get("Code") != "OK":
        raise SmsError(f"阿里云短信返回错误：{data.get('Code')} {data.get('Message')}")


def base64_hmac_sha1(key: str, msg: str) -> str:
    import base64

    digest = hmac.new(key.encode(), msg.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


# --------------------------------------------------------------------- #
# 发送入口（含频控）
# --------------------------------------------------------------------- #
_lock = threading.Lock()
_last_sent: dict[str, float] = {}     # phone -> 上次发送时间戳
_daily_count: dict[str, list] = {}    # phone -> [日期, 当日计数]


def check_send_allowed(phone: str) -> None:
    """频控检查，不允许时抛 SmsError。"""
    with _lock:
        now = time.time()
        last = _last_sent.get(phone, 0)
        if now - last < RESEND_COOLDOWN:
            raise SmsError(f"发送太频繁，请 {int(RESEND_COOLDOWN - (now - last))} 秒后再试")
        today = datetime.now().strftime("%Y-%m-%d")
        entry = _daily_count.get(phone)
        if not entry or entry[0] != today:
            entry = [today, 0]
            _daily_count[phone] = entry
        if entry[1] >= DAILY_LIMIT_PER_PHONE:
            raise SmsError("该手机号今日验证码已达上限，请明天再试")


def mark_sent(phone: str) -> None:
    with _lock:
        _last_sent[phone] = time.time()
        entry = _daily_count.setdefault(phone, [datetime.now().strftime("%Y-%m-%d"), 0])
        if entry[0] != datetime.now().strftime("%Y-%m-%d"):
            entry = [datetime.now().strftime("%Y-%m-%d"), 0]
            _daily_count[phone] = entry
        entry[1] += 1


def send_code(phone: str, code: str) -> None:
    """按配置的 provider 发送验证码。"""
    if PROVIDER == "aliyun":
        _send_aliyun(phone, code)
        return
    if PROVIDER != "mock":
        raise SmsError(f"未知短信通道 SMS_PROVIDER={PROVIDER!r}（可选 mock / aliyun）")
    # mock：仅打日志，接口层负责回显
    log.warning("[SMS MOCK] 向 %s 发送验证码：%s（生产环境请设置 SMS_PROVIDER=aliyun 并配置商户参数）", phone, code)


def generate_code() -> str:
    return "".join(random.choice(string.digits) for _ in range(6))


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()
