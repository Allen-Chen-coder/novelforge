/** 生成前 token 用量预估。
 *
 * 估算模型与 novel_agent 流水线对齐（中文小说，Kimi/DeepSeek 系分词器约 1.15 token/字），
 * 并纳入三个真实变量：
 *   - 章数：线性驱动全部四个环节
 *   - 每章字数 targetWords：驱动正文输出与所有「通读全文」环节的输入
 *   - 逻辑含量：创作灵感越长、题材越烧脑（悬疑/科幻），人物账本与伏笔台账越厚、
 *     修订轮数期望越高 —— 用 ideaChars 与 genre 折算 prompt 增量和修订期望
 * 真实用量由后端 usage_logs 计量，这里只负责下单前的诚实预期。
 */

export interface EstimateOptions {
  targetWords?: number;  // 每章字数（Writer target_words）
  ideaChars?: number;    // 创作灵感长度（复杂度代理变量）
  genre?: string;        // 题材（悬疑/科幻等逻辑密集型上调修订期望）
}

export interface TokenEstimate {
  chapters: number;
  plan: number;     // 整书策划
  write: number;    // 全部章节写作
  critique: number; // 全部章节一审
  revise: number;   // 修订+复审（期望值折算）
  reviseRounds: number; // 折算后的每章修订期望
  total: number;
}

const TOKENS_PER_CHAR = 1.15;  // 中文正文折算（含标点）

/** 题材修订系数：逻辑密集型改稿更频繁 */
const GENRE_REVISE_FACTOR: [RegExp, number][] = [
  [/悬疑|推理|诡|谜/i, 1.35],
  [/科幻|末世|无限|规则/i, 1.2],
  [/历史|架空|权谋|谍战/i, 1.15],
  [/短篇|脑洞|甜宠|轻松/i, 0.85],
];

export function estimateProjectTokens(chapters: number, opts: EstimateOptions = {}): TokenEstimate {
  const n = Math.max(1, Math.min(200, Math.round(chapters) || 1));
  const targetWords = Math.max(500, Math.min(20000, Math.round(opts.targetWords || 3000)));
  const ideaChars = Math.max(0, opts.ideaChars || 0);
  const genre = opts.genre || "";

  // —— 逻辑含量折算 ——
  // 1) 上下文增厚：灵感越丰富，策划产出的世界观/人物/伏笔越厚，每章携带的台账越重
  const contextExtra = Math.min(ideaChars * 0.35, 900);
  // 2) 修订期望：基础 0.55，灵感每 300 字 +0.08（上限 1.3），题材系数再乘算
  let reviseRounds = 0.55 + Math.min(ideaChars / 300, 1.2) * 0.35;
  for (const [re, f] of GENRE_REVISE_FACTOR) {
    if (re.test(genre)) { reviseRounds *= f; break; }
  }
  reviseRounds = Math.min(1.4, reviseRounds);

  // —— 各环节 ——
  const draft = targetWords * TOKENS_PER_CHAR;           // 每章正文输出
  const writerPrompt = Math.round(1800 + contextExtra);  // 系统提示 + 世界观 + 人物账本 + 伏笔 + 全书梗概 + 滚动摘要 + 任务卡
  const criticFixed = Math.round(700 + contextExtra);    // 审校系统提示 + 台账 + 任务卡
  const criticOut = 600;                                 // 评分 + 问题清单 + 摘要 + 事实更新 JSON
  const reviserFixed = Math.round(4300 + contextExtra);  // 修订系统提示 + 台账 + 问题清单 + 任务卡（含读入全文）

  const plan = Math.round(2600 + ideaChars * 0.6 + n * 90);
  const write = Math.round(n * (writerPrompt + draft));
  const critique = Math.round(n * (criticFixed + draft + criticOut));
  const revise = Math.round(n * reviseRounds * (reviserFixed + draft + criticFixed + draft + criticOut));

  return {
    chapters: n, plan, write, critique, revise,
    reviseRounds: Math.round(reviseRounds * 100) / 100,
    total: plan + write + critique + revise,
  };
}

/** 1 万 以上用「万」，否则用「千」，保持按钮文案紧凑。 */
export function formatTokens(t: number): string {
  if (t >= 10000) return `≈${(t / 10000).toFixed(1)} 万`;
  return `≈${Math.round(t / 100) / 10} 千`;
}

/** 悬浮明细：各环节拆解，一行一项。 */
export function estimateBreakdown(e: TokenEstimate): string {
  return [
    `整书策划：${formatTokens(e.plan)}`,
    `章节写作（${e.chapters} 章）：${formatTokens(e.write)}`,
    `审校：${formatTokens(e.critique)}`,
    `修订（期望 ${e.reviseRounds} 轮/章）：${formatTokens(e.revise)}`,
    `合计：${formatTokens(e.total)} tokens`,
  ].join("\n");
}
