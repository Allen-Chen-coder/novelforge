/** 主流模型服务商预设：选择后自动填入 API 地址与推荐模型，用户只需填自己的 Key。 */
export interface ProviderPreset {
  key: string;
  name: string;
  base_url: string;
  model: string;
  /** 获取 API Key 的入口提示 */
  key_hint: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "kimi",
    name: "Kimi（月之暗面）",
    base_url: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    key_hint: "platform.moonshot.cn 控制台 → API Key 管理",
  },
  {
    key: "deepseek",
    name: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    key_hint: "platform.deepseek.com → API Keys",
  },
  {
    key: "qwen",
    name: "通义千问（阿里云）",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3-max",
    key_hint: "dashscope.console.aliyun.com → API-KEY 管理",
  },
  {
    key: "openai",
    name: "OpenAI",
    base_url: "https://api.openai.com/v1",
    model: "gpt-5",
    key_hint: "platform.openai.com → API keys",
  },
  {
    key: "glm",
    name: "智谱 GLM",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5",
    key_hint: "open.bigmodel.cn → API Keys",
  },
  {
    key: "doubao",
    name: "豆包（火山引擎）",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6-lite-251015",
    key_hint: "console.volcengine.com/ark → API Key 管理",
  },
  {
    key: "minimax",
    name: "MiniMax",
    base_url: "https://api.minimaxi.com/v1",
    model: "MiniMax-M2",
    key_hint: "platform.minimaxi.com → 接口密钥",
  },
  {
    key: "hunyuan",
    name: "腾讯混元",
    base_url: "https://api.hunyuan.cloud.tencent.com/v1",
    model: "hunyuan-turbo",
    key_hint: "console.cloud.tencent.com/hunyuan → API 密钥",
  },
  {
    key: "spark",
    name: "讯飞星火",
    base_url: "https://spark-api-open.xf-yun.com/v1",
    model: "generalv3.5",
    key_hint: "xinghuo.xfyun.cn → Spark Max 模型接口",
  },
  {
    key: "astraflow",
    name: "UCloud 星图 AstraFlow",
    base_url: "https://api.modelverse.cn/v1",
    model: "kimi-k3",
    key_hint: "astraflow.ucloud.cn → 认证鉴权/API Key",
  },
  {
    key: "siliconflow",
    name: "硅基流动 SiliconFlow",
    base_url: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    key_hint: "cloud.siliconflow.cn → API 密钥",
  },
  {
    key: "vectrust",
    name: "Vectrust（多模型聚合）",
    base_url: "https://api.openai-next.com/v1",
    model: "gpt-5.5",
    key_hint: "openai-next.com → 控制台生成 API Key（一个 Key 调用 800+ 模型）",
  },
  {
    key: "openrouter",
    name: "OpenRouter（海外模型聚合）",
    base_url: "https://openrouter.ai/api/v1",
    model: "openai/gpt-5",
    key_hint: "openrouter.ai/keys",
  },
];

export const CUSTOM_PRESET_KEY = "custom";

/** 按 base_url 反查预设（用于回显当前选择）；匹配不到返回 custom。 */
export function presetKeyForBaseUrl(baseUrl: string): string {
  const hit = PROVIDER_PRESETS.find((p) => p.base_url === (baseUrl || "").trim());
  return hit ? hit.key : CUSTOM_PRESET_KEY;
}
