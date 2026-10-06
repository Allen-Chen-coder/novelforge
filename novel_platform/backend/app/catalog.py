"""商业化商品目录：订阅套餐 + 加油包。

定价依据（2026-10 实测成本校准）：
- 实测一本 5 章书（《猎罪者》，含整书策划 + 逐章写作 + 审校 + 修订全链路）
  共消耗 308,564 tokens —— 即每章综合成本约 6.2 万 token（不是只有正文，
  逻辑计算、架构生成、书库维护全部计入）。
- 按旗舰推理模型市价（约 ¥0.08/千 token）折算，单章成本可达 ¥5；
  按主流国产模型（DeepSeek 级 ¥1-2/百万 token）折算，单章成本约 ¥0.1-0.6。
- 平台按「字数」计价（内部以章配额结算，1 章 ≈ 1000 字），定价保证：主流模型成本占比 ≤ 35%，旗舰模型占比 ≤ 80%，
  并鼓励用户 BYOK（自有 API 走自己的 Key，平台零模型成本）。

免费版为体验装：每月 1000 字，引导转化「自有 API」或「付费套餐」。
"""

# 订阅套餐：按月发放 plan_chapters 章节额度，每月自动重置
PLANS = {
    "free": {"code": "free", "name": "免费版", "price_cents": 0, "months": 1,
             "chapters": 1, "tagline": "零成本体验 AI 长篇创作", "features": [
                 "每月 1000 字免费体验额度",
                 "全自动策划 + 写作 + 审校流水线",
                 "接入自有 API 即解除字数与额度限制",
                 "Markdown / PDF / Word 导出",
             ]},
    "basic": {"code": "basic", "name": "标准版", "price_cents": 4900, "months": 1,
              "chapters": 30, "tagline": "日更三千字，不断更", "features": [
                  "每月 3 万字生成额度",
                  "全部免费版能力，单章字数不设上限",
                  "额度当月有效、每月自动重置",
              ]},
    "pro": {"code": "pro", "name": "专业版", "price_cents": 9900, "months": 1,
            "chapters": 70, "tagline": "约合 1 本长篇/月，签约作者配置", "features": [
                "每月 7 万字生成额度",
                "优先生成队列",
                "额度当月有效、每月自动重置",
            ]},
    "max": {"code": "max", "name": "旗舰版", "price_cents": 19900, "months": 1,
            "chapters": 160, "tagline": "工作室级产能，多书并行", "features": [
                "每月 16 万字生成额度",
                "最高优先级队列",
                "额度当月有效、每月自动重置",
            ]},
}

# 加油包：一次性叠加到 extra_chapters，永不过期
PACKS = {
    "pack5": {"code": "pack5", "name": "轻量加油包", "price_cents": 900, "chapters": 5,
              "tagline": "5000 字额度 · 折合 ¥1.80/千字"},
    "pack18": {"code": "pack18", "name": "标准加油包", "price_cents": 2900, "chapters": 18,
               "tagline": "1.8 万字额度 · 折合 ¥1.61/千字 · 最受欢迎"},
    "pack55": {"code": "pack55", "name": "巨量加油包", "price_cents": 7900, "chapters": 55,
               "tagline": "5.5 万字额度 · 折合 ¥1.44/千字"},
}

CATALOG = {**PLANS, **PACKS}
