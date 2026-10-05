import { useRef } from "react";
import type { ReactNode, MouseEvent, CSSProperties } from "react";

/**
 * taste: Spotlight Border Card —— 卡片边框随光标位置泛起微光。
 * 只写 CSS 变量 + transform/opacity，不触发 React 重渲染（性能护栏）。
 */
export default function SpotlightCard({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
    el.style.setProperty("--spot", "1");
  };
  const onLeave = () => ref.current?.style.setProperty("--spot", "0");

  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} className={`spotlight-card ${className}`} style={style}>
      {children}
    </div>
  );
}
