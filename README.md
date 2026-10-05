# 墨卷 NovelForge

AI 长篇小说自动生成平台：一句灵感 → 整书策划 → 逐章流式写作 → 审校修订 → 个人书库续写，前后端分离，可商业运营（订阅额度 + token 加油包 + BYOK 自有 API）。

## 仓库结构

| 目录 | 说明 |
| --- | --- |
| `novel_agent/` | 生成引擎：Planner / Writer / Critic / Reviser / Summarizer / Judge(RM) 六角色流水线，支持流式输出与断点续跑 |
| `novel_platform/` | 商业化平台：FastAPI 后端（用户、额度、订单、用量计量、SSE 直播流）+ React 前端（Dashboard、项目详情、管理后台、额度中心） |

## 快速开始

```bash
cd novel_platform/frontend
npm install
npm run dev          # 前端 http://localhost:3000 + 后端 http://localhost:8787
```

默认账号 `admin / admin123`（首次登录后请立即修改）。接入真实模型：管理后台配置服务商 API Key，或用户自带 Key（BYOK）。

详细部署说明见 [novel_platform/DEPLOY.md](novel_platform/DEPLOY.md)。

## 核心特性

- **流式直播看台**：生成过程逐字推送（SSE），弹幕式事件时间线呈现策划→写作→审校→定稿全链路
- **个人书库**：滚动摘要 + 伏笔台账，续写严格承接前文，不另起炉灶
- **摸鱼坞**：码字挑战 / 金句盲盒 / 剧情骰子，生成等待不无聊
- **商业化**：套餐订阅 + 加油包 + token 预估与实际计量对比
