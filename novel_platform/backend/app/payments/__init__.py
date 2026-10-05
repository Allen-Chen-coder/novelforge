"""支付通道抽象：收银台下单（checkout）+ 异步回调验签（verify_notify）。

通道由环境变量 PAY_CHANNEL 选择：mock（默认，本地演示）/ wechat（微信支付 V3）/ alipay（支付宝）。
真实通道未配置商户参数时，checkout 抛出 PaymentError，接口层返回 400 并说明缺什么。
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


class PaymentError(Exception):
    """配置缺失或第三方支付返回错误。"""


@dataclass
class CheckoutResult:
    type: str                     # 'mock' | 'redirect' | 'qrcode'
    url: Optional[str] = None     # redirect 通道的跳转地址
    code_url: Optional[str] = None  # qrcode 通道的二维码内容


@dataclass
class NotifyResult:
    order_id: int
    channel_trade_no: str         # 第三方支付单号（对账用）
    amount_cents: int             # 回调声称的金额，必须与订单一致（防篡改）


CHANNEL = os.environ.get("PAY_CHANNEL", "mock").lower()


def get_channel():
    if CHANNEL == "wechat":
        from . import wechat
        return wechat
    if CHANNEL == "alipay":
        from . import alipay
        return alipay
    raise PaymentError(f"支付通道未配置：PAY_CHANNEL={CHANNEL!r}（可选 wechat / alipay，模拟支付已下线）")
