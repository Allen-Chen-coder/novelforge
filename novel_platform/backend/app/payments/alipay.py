"""支付宝（电脑网站支付 alipay.trade.page.pay + 异步 notify 验签）。

- 下单：拼接跳转 URL，商户 RSA2 私钥签名（用户浏览器跳转到支付宝收银台）。
- 回调：用支付宝公钥 RSA2 验签 notify 参数，核对 app_id、金额、卖家账号后置单 paid。

所需环境变量：
  ALIPAY_APP_ID             开放平台应用 AppID
  ALIPAY_PRIVATE_KEY        应用私钥 PEM/PKCS8 文本（或 ALIPAY_PRIVATE_KEY_PATH）
  ALIPAY_PUBLIC_KEY         支付宝公钥文本（或 ALIPAY_PUBLIC_KEY_PATH）
  ALIPAY_NOTIFY_URL         公网可达的异步回调，如 https://your-domain.com/api/pay/alipay/notify
  ALIPAY_RETURN_URL         支付完成后的同步跳转页（可选，如 https://your-domain.com/billing）
  ALIPAY_SANDBOX            设为 1 时使用沙箱网关
"""
from __future__ import annotations

import base64
import os
import time
import urllib.parse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from . import CheckoutResult, NotifyResult, PaymentError

_APP_ID = os.environ.get("ALIPAY_APP_ID", "")
_NOTIFY = os.environ.get("ALIPAY_NOTIFY_URL", "")
_RETURN = os.environ.get("ALIPAY_RETURN_URL", "")
_GATEWAY = (
    "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
    if os.environ.get("ALIPAY_SANDBOX") == "1"
    else "https://openapi.alipay.com/gateway.do"
)


def _load_key(env_text: str, env_path: str, what: str, private: bool):
    pem = os.environ.get(env_text, "")
    path = os.environ.get(env_path, "")
    if not pem and path and os.path.exists(path):
        pem = open(path, encoding="utf-8").read()
    if not pem:
        raise PaymentError(f"支付宝未配置：请设置 {env_text} 或 {env_path}")
    try:
        if private:
            return serialization.load_pem_private_key(pem.encode(), password=None)
        return serialization.load_pem_public_key(pem.encode())
    except ValueError:
        # 支付宝控制台给的是裸 base64（无 PEM 头），这里自动包一层
        head = "-----BEGIN RSA PRIVATE KEY-----" if private else "-----BEGIN PUBLIC KEY-----"
        tail = "-----END RSA PRIVATE KEY-----" if private else "-----END PUBLIC KEY-----"
        body = "\n".join(pem.strip().split("-----")[0].strip()[i:i + 64]
                         for i in range(0, len(pem.strip()), 64))
        wrapped = f"{head}\n{body}\n{tail}\n"
        if private:
            return serialization.load_pem_private_key(wrapped.encode(), password=None)
        return serialization.load_pem_public_key(wrapped.encode())


def _private_key():
    return _load_key("ALIPAY_PRIVATE_KEY", "ALIPAY_PRIVATE_KEY_PATH", "应用私钥", True)


def _public_key():
    return _load_key("ALIPAY_PUBLIC_KEY", "ALIPAY_PUBLIC_KEY_PATH", "支付宝公钥", False)


def _rsa2_sign(content: str) -> str:
    key = _private_key()
    sig = key.sign(content.encode(), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(sig).decode()


def _verify_sign(params: dict) -> None:
    sign = params.pop("sign", "")
    params.pop("sign_type", None)
    content = "&".join(f"{k}={params[k]}" for k in sorted(params))
    try:
        _public_key().verify(
            base64.b64decode(sign), content.encode(),
            padding.PKCS1v15(), hashes.SHA256(),
        )
    except Exception:
        raise PaymentError("支付宝回调验签失败")


def checkout(order: dict, user: dict) -> CheckoutResult:
    if not _APP_ID or not _NOTIFY:
        raise PaymentError("支付宝未配置，请设置 ALIPAY_APP_ID 与 ALIPAY_NOTIFY_URL")
    biz = {
        "out_trade_no": f"NF{order['id']}T{int(time.time())}",
        "total_amount": f"{order['amount_cents'] / 100:.2f}",
        "subject": f"墨卷NovelForge-{order['title']}",
        "product_code": "FAST_INSTANT_TRADE_PAY",
        "passback_params": urllib.parse.quote(json_dumps({"order_id": order["id"]})),
    }
    common = {
        "app_id": _APP_ID,
        "method": "alipay.trade.page.pay",
        "charset": "utf-8",
        "sign_type": "RSA2",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "version": "1.0",
        "notify_url": _NOTIFY,
        "biz_content": json_dumps(biz),
    }
    if _RETURN:
        common["return_url"] = _RETURN
    content = "&".join(f"{k}={common[k]}" for k in sorted(common))
    common["sign"] = _rsa2_sign(content)
    url = _GATEWAY + "?" + urllib.parse.urlencode(common)
    return CheckoutResult(type="redirect", url=url)


def json_dumps(obj) -> str:
    import json
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def verify_notify(form: dict) -> NotifyResult:
    if form.get("app_id") != _APP_ID:
        raise PaymentError("支付宝回调 app_id 不匹配")
    _verify_sign(dict(form))
    if form.get("trade_status") not in ("TRADE_SUCCESS", "TRADE_FINISHED"):
        raise PaymentError("支付宝交易未成功：" + str(form.get("trade_status")))
    import json
    passback = json.loads(urllib.parse.unquote(form.get("passback_params", "{}")))
    return NotifyResult(
        order_id=int(passback["order_id"]),
        channel_trade_no=form.get("trade_no", ""),
        amount_cents=int(round(float(form.get("total_amount", "0")) * 100)),
    )
