# 墨卷 NovelForge —— AI 长篇小说自动生成平台（商业化版）

前后端分离的全栈产品：用户在前端输入一句灵感，平台自动完成整书策划、逐章写作、
审校修订并导出成书；你（站长）在管理后台配置自己的第三方模型 API Key，
按「章」给用户配额，并监控每个用户的 Token 消耗。

## 架构

```
novel_platform/
├── frontend/                # React 19 + TypeScript + Vite + Tailwind + shadcn/ui
│   ├── src/pages/           # Login / Dashboard(创作台) / ProjectDetail(阅读器) / Billing(额度中心) / Admin(后台)
│   ├── src/lib/api.ts       # API 客户端（Token 注入）
│   └── scripts/dev.mjs      # npm run dev 一键拉起 后端(8787)+前端(3000)
│
├── backend/                 # FastAPI + SQLite（零外部依赖，开箱即用）
│   ├── app/
│   │   ├── db.py            # SQLite（users/sessions/provider_config/user_provider/projects/chapters/usage_logs/orders）
│   │   ├── auth.py          # PBKDF2 密码散列 + Token 会话 + 管理员种子 + 套餐月度重置
│   │   ├── catalog.py       # 订阅套餐与加油包目录（定价唯一维护点）
│   │   ├── security.py      # API Key 的 Fernet 加密存储（机器本地密钥 data/secret.key）
│   │   ├── llm_shim.py      # 平台默认配置 or 用户 BYOK 构建 novel_agent 的 LLMClient
│   │   ├── runner.py        # 串行后台执行器（进度回写、章节入库、额度结算、用量计量）
│   │   ├── routers.py       # /api/auth/* /api/projects/* /api/catalog /api/orders /api/my-provider /api/admin/*
│   │   └── main.py
│   └── data/                # platform.db / secret.key / runs/<project_id>/（自动创建）
│
└── ../novel_agent/          # 生成引擎（流水线 + 提示词 + StoryBible），被 backend 复用
```

## 启动

```bash
cd novel_platform/frontend
npm install          # 首次
npm run dev          # 同时启动后端 :8787 和前端 :3000
```

打开 http://localhost:3000 。Kimi Work 预览卡会自动映射端口。

## 商业化要点

**1. 你的 API Key 由你掌控（后台配置）**
- 管理员登录 → 管理后台 →「服务商配置」：填 Base URL（Kimi/DeepSeek/通义/SiliconFlow，
  任何 OpenAI 兼容接口）、API Key、模型名。
- Key 用 Fernet 加密存在服务端（`backend/data/secret.key` 为机器本地密钥），
  前端只回显掩码（`skxx****xxxx`），任何接口都不返回明文。
- 所有用户的生成请求共用你的 Key 出账，你向模型商按 Token 付费、向用户按章收费。

**2. 商业化：订阅套餐 + 加油包 + 自带 API（BYOK）**

订阅套餐（按「章」计费，每月自动重置，目录在 `backend/app/catalog.py` 一处维护）：

| 套餐 | 价格 | 每月额度 | 折合 |
|---|---|---|---|
| 免费版 | ¥0 | 20 章 | — |
| 标准版 | ¥49/月 | 120 章（约 12 万字） | ¥0.41/章 |
| 专业版 | ¥99/月 | 320 章（约 32 万字） | ¥0.31/章 |
| 旗舰版 | ¥199/月 | 1200 章（约 120 万字） | ¥0.17/章 |

加油包（叠加到账户、永不过期、不限购买次数）：轻量包 ¥9/30 章（¥0.30/章）、
标准包 ¥29/120 章（¥0.24/章）、巨量包 ¥79/400 章（¥0.20/章）。
定价依据：DeepSeek V4.1 Flash 约 ¥1/¥2 每百万 token、Kimi K3 约 $3/$15、
Claude Sonnet 5 $2/$10、豆包 2.1 Pro ¥6/¥30；单章成本约 ¥0.1-2.5，
竞品蛙蛙写作字数包 1 万字 ¥9.9 起、Kimi 会员 ¥49 起——平台按章定价留有毛利。

- 扣减顺序：先用当月订阅额度，再自动抵扣加油包余额。
- 用户端「额度中心」（/billing）：余额总览、套餐对比订阅、加油包购买、订单记录。
- 收银台支持三通道（`backend/app/payments/`）：模拟支付（本地演示即时到账）、
  微信支付 V3（扫码二维码，商户 RSA 签名 + 回调平台证书验签 + AES-GCM 解密）、
  支付宝（跳转收银台，RSA2 签名 + 异步通知验签）。回调统一做**金额核对**与**幂等到账**
  （重复回调/重复点击只发放一次额度）；商户参数全部走环境变量，未配置时支付明确报错，
  接入步骤见 [DEPLOY.md](DEPLOY.md)。
- 管理后台「订单管理」：查看/取消全部用户订单；「用户管理」可手动调整加油包余额
  （线下收款赠送场景）。

**3. 用户自带 API Key（BYOK）**
- 用户在「额度中心 → 自有 API」填入自己的 OpenAI 兼容接口（Kimi/DeepSeek/通义/OpenAI…）。
- 启用后该用户的生成全部走自己的 Key：**不消耗平台任何额度**（仅保留同时 2 个工程的
  并发限制），Token 用量照常记录；停用后自动回退平台默认模型。
- Key 同样 Fernet 加密存储、只回显掩码；可随时整体移除。

**4. 用量监控**
- 每次模型调用的 prompt/completion tokens 落库（`usage_logs`）。
- 管理后台「用量监控」：总览卡片、近 30 天每日消耗柱状图、按用户明细——
  直接对应你给模型商的真实账单，可核算每个用户的模型成本与毛利。

**5. 管理员账号**
- 首次启动自动创建 `admin / admin123`（可用环境变量 `NOVEL_ADMIN_USER` / `NOVEL_ADMIN_PASSWORD` 覆盖）。
- **上线前务必修改**，并妥善保管 `backend/data/secret.key`（丢失则已存 Key 无法解密）。

## API 一览（供二次开发）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/register · /login | 注册 / 登录（返回 Bearer Token） |
| GET | /api/auth/me | 当前用户（含配额余量） |
| GET/POST | /api/projects | 我的工程列表 / 新建（触发后台生成） |
| GET | /api/projects/{id} | 工程详情 + 章节清单（前端轮询进度） |
| GET | /api/projects/{id}/chapters/{idx} | 章节正文 + 审校记录 |
| GET | /api/projects/{id}/export | 导出全书 Markdown |
| GET/PUT/DELETE | /api/my-provider | 用户自带 API（GET 只回掩码；启用后生成不消耗额度） |
| GET | /api/catalog | 套餐/加油包目录 + 我的余额 |
| GET/POST | /api/orders · POST /api/orders/{id}/checkout | 下单 / 收银台（mock 即时到账、wechat 二维码、alipay 跳转） |
| GET | /api/orders/{id} | 收银台轮询到账状态 |
| POST | /api/pay/wechat/notify · /api/pay/alipay/notify | 支付网关异步回调（验签+金额核对+幂等） |
| GET | /api/admin/orders · POST /api/admin/orders/{id}/cancel | 订单管理 |
| GET/PUT | /api/admin/provider | 平台默认服务商配置（GET 只回掩码） |
| GET/PATCH | /api/admin/users[/{id}] | 用户列表 / 停用 / 调加油包余额 |
| GET | /api/admin/usage | 总量、按用户、近 30 天明细 |

## 上线前 Roadmap（当前 MVP 已可用，建议按序补齐）

1. **改管理员默认密码** + 备份 `data/` 目录（db + secret.key）。
2. HTTPS 反向代理（Caddy/nginx），收紧 CORS 白名单（`app/main.py` 中配置）。
3. 支付对接：把 `pay_order` 的模拟支付替换为微信/支付宝收银台 + 异步回调验签
   （回调内核对金额后调用 `_apply_order` 发放额度）。
4. 生成质量：用 novel_agent 的微调管线（`novel_agent/scripts/`）蒸馏风格模型，
   在服务商配置里把 model 换成你的微调模型名即可。
5. 多机部署时把 SQLite 换成 PostgreSQL/MySQL（db.py 是唯一数据访问层，改动面小）。
