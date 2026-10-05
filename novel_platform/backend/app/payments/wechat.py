"""微信支付 V3（Native 扫码支付）。

- 下单：POST /v3/pay/transactions/native，商户 RSA-SHA256 签名（Wechatpay-* 头）
- 回调：验签 Wechatpay-Signature（平台证书），AES-256-GCM 解密 resource，
  核对金额与订单一致后置单 paid。

所需环境变量：
  WXPAY_APPID          公众号/应用 AppID
  WXPAY_MCHID          商户号
  WXPAY_SERIAL         商户证书序列号
  WXPAY_PRIVATE_KEY    商户私钥 PEM 文本（或 WXPAY_PRIVATE_KEY_PATH 文件路径）
  WXPAY_APIV3_KEY      APIv3 密钥（回调资源解密）
  WXPAY_NOTIFY_URL     公网可达的回调地址，如 https://your-domain.com/api/pay/wechat/notify
"""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.request
import uuid

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from . import CheckoutResult, NotifyResult, PaymentError

BASE = "https://api.mch.weixin.qq.com"
GATEWAY = "https://gateway.woa.com"  # 境外商户按需替换

_APPID = os.environ.get("WXPAY_APPID", "")
_MCHID = os.environ.get("WXPAY_MCHID", "")
_SERIAL = os.environ.get("WXPAY_SERIAL", "")
_APIV3 = os.environ.get("WXPAY_APIV3_KEY", "")
_NOTIFY = os.environ.get("WXPAY_NOTIFY_URL", "")


def _private_key():
    pem = os.environ.get("WXPAY_PRIVATE_KEY", "")
    path = os.environ.get("WXPAY_PRIVATE_KEY_PATH", "")
    if not pem and path and os.path.exists(path):
        pem = open(path, encoding="utf-8").read()
    if not pem:
        raise PaymentError("微信支付未配置：请设置 WXPAY_PRIVATE_KEY 或 WXPAY_PRIVATE_KEY_PATH")
    return serialization.load_pem_private_key(pem.encode(), password=None)


def _sign(message: str) -> str:
    key = _private_key()
    sig = key.sign(message.encode(), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(sig).decode()


def _auth_header(method: str, url_path: str, body: str) -> str:
    ts = str(int(time.time()))
    nonce = uuid.uuid4().hex
    message = f"{method}\n{url_path}\n{ts}\n{nonce}\n{body}\n"
    token = _sign(message)
    return (
        f'WECHATPAY2-SHA256-RSA2048 mchid="{_MCHID}",nonce_str="{nonce}",'
        f'signature="{token}",timestamp="{ts}",serial_no="{_SERIAL}"'
    )


def _post_json(url_path: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False)
    req = urllib.request.Request(
        BASE + url_path, data=body.encode("utf-8"), method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": _auth_header("POST", url_path, body),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        raise PaymentError(f"微信支付下单失败：{e}")


def _require_config():
    missing = [
        name for name, val in [
            ("WXPAY_APPID", _APPID), ("WXPAY_MCHID", _MCHID),
            ("WXPAY_SERIAL", _SERIAL), ("WXPAY_APIV3_KEY", _APIV3),
            ("WXPAY_NOTIFY_URL", _NOTIFY),
        ] if not val
    ]
    if missing:
        raise PaymentError("微信支付未配置，缺少环境变量：" + ", ".join(missing))
    _private_key()


def checkout(order: dict, user: dict) -> CheckoutResult:
    _require_config()
    url_path = "/v3/pay/transactions/native"
    payload = {
        "appid": _APPID,
        "mchid": _MCHID,
        "description": f"墨卷NovelForge-{order['title']}",
        "out_trade_no": f"NF{order['id']}T{int(time.time())}",
        "notify_url": _NOTIFY,
        "amount": {"total": order["amount_cents"], "currency": "CNY"},
        "attach": json.dumps({"order_id": order["id"]}),
    }
    r = _post_json(url_path, payload)
    if not r.get("code_url"):
        raise PaymentError(f"微信支付未返回二维码：{r}")
    return CheckoutResult(type="qrcode", code_url=r["code_url"])


def _verify_signature(headers: dict, body: str) -> None:
    """用平台证书验签回调（证书可通过 GET /v3/certificates 自动轮换，此处静态配置）。"""
    cert_pem = os.environ.get("WXPAY_PLATFORM_CERT", "")
    if not cert_pem:
        # 平台证书可调用 /v3/certificates 拉取并 AES-GCM 解密后缓存；
        # 为简化部署，生产建议把证书串放在 WXPAY_PLATFORM_CERT。
        raise PaymentError("微信支付回调验签未配置：请设置 WXPAY_PLATFORM_CERT（平台证书）")
    from cryptography import x509
    cert = x509.load_pem_x509_certificate(cert_pem.encode())
    ts = headers.get("wechatpay-timestamp", "")
    nonce = headers.get("wechatpay-nonce", "")
    sign = headers.get("wechatpay-signature", "")
    message = f"{ts}\n{nonce}\n{body}\n"
    try:
        cert.public_key().verify(
            base64.b64decode(sign), message.encode(),
            padding.PKCS1v15(), hashes.SHA256(),
        )
    except Exception:
        raise PaymentError("微信支付回调验签失败")


def _decrypt_resource(resource: dict) -> dict:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = base64.b64decode(_APIV3)
    nonce = base64.b64decode(resource["nonce"])
    data = base64.b64decode(resource["ciphertext"])
    plain = AESGCM(key).decrypt(nonce, data, resource["associated_data"].encode())
    return json.loads(plain.decode("utf-8"))


def verify_notify(headers: dict, body: str) -> NotifyResult:
    _require_config()
    _verify_signature(headers, body)
    data = json.loads(body)
    if data.get("event_type") != "TRANSACTION.SUCCESS":
        raise PaymentError("微信支付回调状态异常：" + body[:200])
    detail = _decrypt_resource(data["resource"])
    if detail.get("trade_state") != "SUCCESS":
        raise PaymentError("微信支付未成功：" + body[:200])
    attach = json.loads(detail.get("attach") or "{}")
    return NotifyResult(
        order_id=int(attach["order_id"]),
        channel_trade_no=detail.get("transaction_id", ""),
        amount_cents=int(detail["amount"]["total"]),
    )
