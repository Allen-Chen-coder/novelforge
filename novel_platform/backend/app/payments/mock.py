"""模拟支付通道（本地演示/联调默认）：checkout 即表示用户已确认付款。"""
from __future__ import annotations

from . import CheckoutResult


def checkout(order: dict, user: dict) -> CheckoutResult:
    return CheckoutResult(type="mock")
