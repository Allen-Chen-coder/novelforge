import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { BookOpenText, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100 ink-bg flex flex-col">
      <div className="ink-grain" aria-hidden />
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="text-center animate-rise">
          <span className="inline-grid place-items-center w-16 h-16 rounded-2xl bg-amber-500/[0.07] border border-amber-500/20 text-amber-400/80 mb-6">
            <BookOpenText className="w-7 h-7" strokeWidth={1.5} />
          </span>
          {/* 404 用等宽数字，压住跳跃感 */}
          <p className="text-6xl font-semibold tnum tracking-tight text-amber-300/90">404</p>
          <h1 className="text-xl font-semibold tracking-tight mt-4">这一页还没有写成</h1>
          <p className="text-sm text-zinc-500 mt-2 max-w-[40ch] leading-relaxed mx-auto">
            你要找的章节不存在，或者已被移动。回到创作台继续你的故事。
          </p>
          <Link to="/" className="inline-block mt-8">
            <Button className="bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold">
              <ArrowLeft className="w-4 h-4 mr-1" /> 返回创作台
            </Button>
          </Link>
        </div>
      </main>
      <footer className="py-6 text-center text-xs text-zinc-600 tnum">
        NovelForge · AI 长篇小说自动生成平台
      </footer>
    </div>
  );
}
