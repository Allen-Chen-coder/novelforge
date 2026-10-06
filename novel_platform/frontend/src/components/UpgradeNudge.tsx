import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Coins, X } from "lucide-react";

/**
 * 升级引导条：额度告急时浮出，一键直达收银台（液态玻璃，可关闭）。
 * pending = 进行中工程结算时将占用的章数：生成页传入后按「结算后剩余」预估告急，
 * 让排队等结算的用户提前看到全书交付的额度缺口。BYOK 用户永不打扰。
 */
export default function UpgradeNudge({ pending = 0 }: { pending?: number }) {
  const { user } = useAuth();
  const nav = useNavigate();
  // 用户侧按字数展示（内部以章结算，1 章 ≈ 1000 字）
  const ch2w = (c: number) =>
    c >= 10 ? `${(c / 10).toFixed(c % 10 === 0 ? 0 : 1)} 万字` : `${c * 1000} 字`;
  // 本次登录内可关闭，且在创作台 / 生成页共享同一份标记
  const [off, setOff] = useState(() => sessionStorage.getItem("nvf_nudge_off") === "1");

  if (!user) return null;

  const monthLeft = Math.max(0, user.plan_chapters - user.used_chapters);
  const threshold = Math.max(5, Math.ceil(user.plan_chapters * 0.15));
  const totalLeft = monthLeft + user.extra_chapters;

  // 结算后预估：套餐先扣，透支部分由加油包抵扣
  const projMonth = monthLeft - pending;
  const overflow = Math.max(0, -projMonth);
  const projExtra = Math.max(0, user.extra_chapters - overflow);
  const projTotal = Math.max(0, projMonth) + projExtra;

  if (user.byok || off || projTotal > threshold) return null;

  const dismiss = () => {
    sessionStorage.setItem("nvf_nudge_off", "1");
    setOff(true);
  };

  let headline: string;
  let sub: string;
  if (pending > 0) {
    headline = projTotal <= 0 ? "本工程完成后额度将耗尽" : `本工程完成后额度仅剩 ${ch2w(projTotal)}`;
    sub = `本工程将占用 ${ch2w(pending)}，升级套餐或购买加油包，保证全书顺利交付`;
  } else if (monthLeft <= 0 && user.extra_chapters <= 0) {
    headline = "本月额度已用完";
    sub = "升级套餐或购买加油包，让创作不断更";
  } else if (monthLeft <= 0) {
    headline = "套餐额度已用完，正在抵扣加油包";
    sub = `加油包还剩 ${ch2w(user.extra_chapters)}，升级套餐更划算`;
  } else {
    headline = `本月额度仅剩 ${ch2w(totalLeft)}`;
    sub = "升级套餐或购买加油包，让创作不断更";
  }

  return (
    <div className="max-w-6xl mx-auto px-6 mt-5 animate-rise" style={{ "--i": 2 } as React.CSSProperties}>
      <div className="relative overflow-hidden rounded-2xl glass-edge bg-gradient-to-r from-amber-500/[0.10] via-amber-500/[0.05] to-transparent backdrop-blur px-5 py-4 flex items-center gap-4">
        <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-400 animate-grow-bar" aria-hidden />
        <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300">
          <Coins className="w-4 h-4" strokeWidth={1.75} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-100">{headline}</p>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">{sub}</p>
        </div>
        <Button size="sm" onClick={() => nav("/billing")}
          className="bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold shrink-0">
          去升级
        </Button>
        <button onClick={dismiss} aria-label="关闭提示"
          className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors duration-300 ease-fluid p-1">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
