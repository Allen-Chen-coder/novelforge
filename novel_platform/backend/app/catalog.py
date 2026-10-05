"""商业化商品目录：订阅套餐 + 加油包。

定价依据（2026 年市场参考）：
- 模型 API 牌价：DeepSeek V4.1 Flash 约 ¥1/百万输入 token、¥2/百万输出；Kimi K3 约 $3/$15 每百万；
  Claude Sonnet 5 $2/$10；GPT-5.6 Luna $0.20/$1.20；豆包 2.1 Pro ¥6/¥30。
- 单章成本：每章约 25k-80k 输入 + 5k-10k 输出 token，
  DeepSeek 级模型约 ¥0.1-0.3/章，旗舰级模型约 ¥1-2.5/章。
- 竞品写作产品：蛙蛙写作字数包 1 万字 ¥9.9 / 10 万字 ¥14.9 / 50 万字 ¥68.9，
  无限卡 3 天 ¥29 / 7 天 ¥59；Kimi 会员 ¥49/99/199/699 四档。

因此平台按「章」计价：订阅折合 ¥0.17-0.41/章，加油包 ¥0.2-0.3/章，
保证旗舰模型成本占比 < 40%，留有毛利空间。
"""

# 订阅套餐：按月发放 plan_chapters 章节额度，每月自动重置
PLANS = {
    "free": {"code": "free", "name": "免费版", "price_cents": 0, "months": 1,
             "chapters": 20, "tagline": "体验 AI 长篇创作", "features": [
                 "每月 20 章生成额度",
                 "全自动大纲 + 逐章写作 + 审校",
                 "Markdown 导出",
             ]},
    "basic": {"code": "basic", "name": "标准版", "price_cents": 4900, "months": 1,
              "chapters": 120, "tagline": "约合 1 本 10 万字网文/月", "features": [
                  "每月 120 章生成额度（约 12 万字）",
                  "全部免费版能力",
                  "额度当月有效、每月自动重置",
              ]},
    "pro": {"code": "pro", "name": "专业版", "price_cents": 9900, "months": 1,
            "chapters": 320, "tagline": "约合 3 本长篇/月，写作工作室首选", "features": [
                "每月 320 章生成额度（约 32 万字）",
                "优先生成队列",
                "额度当月有效、每月自动重置",
            ]},
    "max": {"code": "max", "name": "旗舰版", "price_cents": 19900, "months": 1,
            "chapters": 1200, "tagline": "日更万字不断更", "features": [
                "每月 1200 章生成额度（约 120 万字）",
                "最高优先级队列",
                "额度当月有效、每月自动重置",
            ]},
}

# 加油包：一次性叠加到 extra_chapters，永不过期
PACKS = {
    "pack30": {"code": "pack30", "name": "轻量加油包", "price_cents": 900, "chapters": 30,
               "tagline": "折合 ¥0.30/章"},
    "pack120": {"code": "pack120", "name": "标准加油包", "price_cents": 2900, "chapters": 120,
                "tagline": "折合 ¥0.24/章 · 最受欢迎"},
    "pack400": {"code": "pack400", "name": "巨量加油包", "price_cents": 7900, "chapters": 400,
                "tagline": "折合 ¥0.20/章"},
}

CATALOG = {**PLANS, **PACKS}
