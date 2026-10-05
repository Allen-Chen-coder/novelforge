import { memo, useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";

/**
 * taste Bento 2.0：Motion-Engine 组件（MOTION_INTENSITY 6 → 纯 CSS 动效）。
 * 规则：永续微交互必须 memo 隔离，只在自身内部重渲染，父布局零开销；
 * 只动 transform/opacity，永不触发布局重排。
 * ------------------------------------------------------------------ */

/** 呼吸状态灯：running 呈琥珀色扩散呼吸，queued 为静默灰点 */
export const StatusDot = memo(function StatusDot({
  status,
}: {
  status: "running" | "queued";
}) {
  if (status === "queued") {
    return <span className="inline-flex rounded-full h-1.5 w-1.5 bg-zinc-500" />;
  }
  return (
    <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
      <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60 animate-breathe" />
      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-400" />
    </span>
  );
});

/**
 * 打字机进度流：把后端实时进度消息逐字打出（35ms/字），消息变化时重新打字；
 * 附微光进度条与闪烁光标，让「等待生成」本身成为活的界面。
 */
export const ProgressStream = memo(function ProgressStream({
  msg,
  done,
  target,
  status,
}: {
  msg: string;
  done: number;
  target: number;
  status: "running" | "queued";
}) {
  const full = msg || "排队等待中…";
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setText("");
    if (status === "queued") return;
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      setText(full.slice(0, i));
      if (i >= full.length && timer.current) clearInterval(timer.current);
    }, 35);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [full, status]);

  const pct = target > 0 ? (done / target) * 100 : 0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="tnum text-xs text-amber-400/90">
          {done}<span className="text-zinc-600">/{target}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <StatusDot status={status} />
          {status === "running" ? "实时生成中" : "排队等待"}
        </span>
      </div>

      {/* 微光进度条：轨道 shimmer + 琥珀填充 */}
      <div className="relative">
        <div className="skeleton absolute inset-0 !rounded-full h-1.5" aria-hidden />
        <Progress value={pct} className="relative h-1.5 bg-transparent [&>div]:bg-amber-500/90 transition-all duration-500 ease-fluid" />
      </div>

      {/* 打字机进度流 + 闪烁光标 */}
      <p className="text-xs text-zinc-500 min-h-[1rem] leading-relaxed" aria-live="polite">
        {status === "running" ? (
          <>
            {text}
            <span className="inline-block w-[5px] h-[11px] bg-amber-400/80 ml-1 align-[-1px] animate-blink" aria-hidden />
          </>
        ) : (
          "工程已进入队列，将在当前任务完成后自动开始"
        )}
      </p>
    </div>
  );
});
