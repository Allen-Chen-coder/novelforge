# novel_agent —— 自动生成小说的多智能体工程

一句话灵感 → 整书策划 → 逐章写作 → 审校/修订 → 记忆回灌 → 导出成书 → 沉淀微调数据。
生成侧接入第三方大模型 API（默认 Kimi 开放平台，OpenAI 兼容，可换 DeepSeek/通义等）；
微调侧提供两条路：云端微调 API 客户端 + 本地开源权重 LoRA 配置。

## 架构

```
                    ┌────────────────────────────────────────────┐
  一句灵感  ──►  Planner（整书策划：世界观/角色/伏笔/分卷章纲）
                    │
                    ▼  逐章生产（断点可续）
        Writer ──► Critic ──► Reviser ──►(major issue? 回环, ≤2轮)
                    │
                    ▼
        StoryBible 记忆回灌（角色状态/伏笔台账/滚动摘要/事实库）
                    │
                    ▼
        Export（full_novel.md / .txt / .docx）
                    │
                    ▼
        FineTune 数据沉淀（sft_messages.jsonl + raw_corpus.txt）
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
  云端微调 API               本地 LoRA（LLaMA-Factory）
  （OpenAI 兼容服务）         （Qwen / Kimi-K2 开源权重）
```

## 快速开始

```bash
pip install -r requirements.txt

# 1) 配置密钥（任选其一 provider，默认 Kimi）
cp .env.example .env   # Windows: 手动 setx MOONSHOT_API_KEY "sk-xxx"

# 2) 生成一本小说
python scripts/run_novel.py --idea "废土上最后一个快递员发现包裹里装的是自己" --genre 科幻末世 --chapters 12 --name mybook

# 3) 断点续跑
python scripts/run_novel.py --resume --name mybook

# 4) 无需 Key 的离线验证
python scripts/run_novel.py --idea "test" --chapters 3 --mock --name demo
```

产物在 `projects/<name>/`：`full_novel.md/.txt/.docx`、`plan.json`、`story_bible.json`。

## 接入第三方模型 API

`config.yaml` 的 provider 段是标准 OpenAI 兼容配置，换厂商只需改两行：

| 厂商 | base_url |
|---|---|
| Kimi（默认） | https://api.moonshot.cn/v1 |
| DeepSeek | https://api.deepseek.com/v1 |
| 阿里通义 | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| SiliconFlow | https://api.siliconflow.cn/v1 |

写长篇建议选长上下文模型（kimi-k3 / deepseek-chat 等），配合
`pipeline.rolling_summary_chapters` 控制每章携带的滚动摘要长度。

## 微调（模型专业微调的两条路）

**路线 A：云端微调 API**（适用于暴露 OpenAI 兼容微调接口的服务：OpenAI 官方、
阿里云百炼、SiliconFlow、火山方舟等。注意：Kimi K3 官方 API 不开放云端微调。）

```bash
python scripts/build_finetune_data.py --project projects/mybook
export FINE_TUNE_API_KEY=sk-xxx
export FINE_TUNE_BASE_URL=https://api.openai.com/v1
python scripts/cloud_finetune.py upload --file projects/mybook/finetune_data/sft_messages.jsonl
python scripts/cloud_finetune.py create --file file-xxx --model gpt-4o-mini --suffix my-novel-style
python scripts/cloud_finetune.py wait --job ftjob-xxx   # 完成后得到微调模型名
# 把 config.yaml 的 provider.model 改成该模型名即可
```

**路线 B：本地 LoRA 微调开源权重**（Kimi-K2 / Qwen2.5 等）

```bash
python scripts/build_finetune_data.py --project projects/mybook
# 按 train_lora/llamafactory_qwen25_7b_lora.yaml 头部注释注册数据并训练
llamafactory-cli train train_lora/llamafactory_qwen25_7b_lora.yaml
# 部署后用 vLLM/SGLang 起 OpenAI 兼容服务，把 config.yaml 的 base_url 指向它
```

微调数据说明：SFT 样本是「写作提示词 + 章节任务卡 + 当时的角色账本/伏笔台账」→
「审校修订后的终稿正文」，与线上推理同分布；`raw_corpus.txt` 是纯文本语料，
适合继续做风格 LoRA 或增量预训练。建议人工精选 2~3 本质量最好的工程产出做训练集，
并在样本量较大时混入少量通用对话数据防止灾难性遗忘。

## 目录

```
novel_agent/
├── config.yaml                  # provider + pipeline 配置
├── novel_agent/
│   ├── llm.py                   # OpenAI 兼容客户端（重试/JSON 模式/mock）
│   ├── prompts.py               # 策划/写作/审校/修订/摘要提示词资产
│   ├── memory.py                # StoryBible：角色账本/伏笔台账/滚动摘要
│   ├── agents.py                # Planner/Writer/Critic/Reviser/Summarizer
│   ├── pipeline.py              # 主编排（断点续跑）
│   ├── export.py                # md/txt/docx 导出
│   └── finetune/                # 数据集构建 + 云端微调客户端
├── scripts/                     # run_novel / build_finetune_data / cloud_finetune
└── train_lora/                  # LLaMA-Factory LoRA 配置
```
