import { useNavigate } from "react-router";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Coins, Crown } from "lucide-react";

export interface GateInfo { needed: number; remaining: number }

// 用户侧按字数展示（内部以章结算，1 章 ≈ 1000 字）
const ch2w = (c: number) =>
  c >= 10 ? `${(c / 10).toFixed(c % 10 === 0 ? 0 : 1)} 万字` : `${c * 1000} 字`;

/**
 * 额度不足拦截弹窗：创建工程超出额度时给出最短的付费路径。
 * 两个直达按钮分别落到收银台的「加油包」「订阅套餐」标签页。
 */
export default function QuotaGateDialog({ open, onOpenChange, info }: {
  open: boolean; onOpenChange: (v: boolean) => void; info: GateInfo | null;
}) {
  const nav = useNavigate();
  if (!info) return null;
  const shortfall = Math.max(0, info.needed - info.remaining);

  const go = (tab: string) => {
    onOpenChange(false);
    nav(`/billing?tab=${tab}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <span className="grid place-items-center w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-300 mb-3">
            <Coins className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <DialogTitle className="text-lg">额度不足，还差 {ch2w(shortfall)}</DialogTitle>
          <DialogDescription className="text-zinc-400 leading-relaxed">
            本工程需要 <span className="tnum text-zinc-200">{ch2w(info.needed)}</span>，
            当前剩余 <span className="tnum text-zinc-200">{ch2w(info.remaining)}</span>
            （本月套餐 + 加油包）。升级套餐每月重置额度，加油包永久有效、随买随用。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-between gap-2 mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-zinc-500 hover:text-zinc-300">
            再想想
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => go("packs")}
              className="border-zinc-700 bg-white/[0.03] hover:bg-white/[0.07] hover:border-amber-500/40 active:scale-[0.97] transition-all duration-300 ease-fluid">
              <Coins className="w-4 h-4 mr-1 text-amber-400" />买加油包
            </Button>
            <Button onClick={() => go("plans")}
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold">
              <Crown className="w-4 h-4 mr-1" />升级套餐
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
