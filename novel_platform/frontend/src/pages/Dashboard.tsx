import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { estimateProjectTokens, estimateBreakdown, formatTokens } from "@/lib/estimate";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SpotlightCard from "@/components/SpotlightCard";
import { StatusDot, ProgressStream } from "@/components/LiveMotion";
import UpgradeNudge from "@/components/UpgradeNudge";
import QuotaGateDialog, { type GateInfo } from "@/components/QuotaGateDialog";
import PastimeDock from "@/components/PastimeDock";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BookOpenText, Plus, Settings, LogOut, Loader2, CheckCircle2, XCircle, Coins, PenLine, Sparkles,
} from "lucide-react";

interface Project {
  id: number;
  name: string;
  idea: string;
  genre: string;
  target_chapters: number;
  status: "queued" | "running" | "done" | "failed";
  progress_msg: string;
  chapters_done: number;
  error: string | null;
  created_at: string;
}

const GENRES = ["男频都市爽文", "女频言情", "玄幻修真", "科幻末世", "悬疑推理", "历史架空", "武侠江湖", "短篇脑洞"];

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 12) return "早上好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export default function Dashboard() {
  const { user, logout, refresh } = useAuth();
  const nav = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null); // null = 加载中（骨架屏）
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", idea: "", genre: GENRES[0], target_chapters: 10, target_words: 3000 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 额度不足拦截弹窗（最短付费路径：加油包 / 升级套餐）
  const [gate, setGate] = useState<GateInfo | null>(null);

  const load = useCallback(async () => {
    setProjects(await api<Project[]>("GET", "/api/projects"));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 4000); // 轮询进度
    return () => clearInterval(timer);
  }, [load]);

  const create = async () => {
    setError("");
    // 前端预检：额度不足直接弹付费引导，不发请求
    if (user && !user.byok && Number(form.target_chapters) > available) {
      setOpen(false);
      setGate({ needed: Number(form.target_chapters), remaining: available });
      return;
    }
    setBusy(true);
    try {
      await api("POST", "/api/projects", { ...form, target_chapters: Number(form.target_chapters), target_words: Number(form.target_words) });
      setOpen(false);
      await refresh();
      await load();
    } catch (e: any) {
      if (typeof e.message === "string" && e.message.includes("额度不足")) {
        setOpen(false);
        setGate({ needed: Number(form.target_chapters), remaining: available });
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (p: Project) => {
    if (p.status === "done") return <Badge className="bg-emerald-600/90 hover:bg-emerald-600 text-emerald-50">已完成</Badge>;
    if (p.status === "failed") return <Badge variant="destructive">失败</Badge>;
    if (p.status === "running")
      return (
        <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 gap-1.5">
          <StatusDot status="running" />生成中
        </Badge>
      );
    return <Badge variant="secondary" className="gap-1.5"><StatusDot status="queued" />排队中</Badge>;
  };

  const monthLeft = user ? Math.max(0, user.plan_chapters - user.used_chapters) : 0;
  // 可用额度 = 本月剩余 + 加油包；BYOK 用户不限额度
  const available = user ? monthLeft + user.extra_chapters : 0;
  const shortfall = user && !user.byok ? Number(form.target_chapters) - available : 0;
  // 本次生成的 token 预估：章数 × 每章字数 × 逻辑含量（灵感长度 + 题材）
  const estimate = estimateProjectTokens(Number(form.target_chapters), {
    targetWords: Number(form.target_words),
    ideaChars: form.idea.length,
    genre: form.genre,
  });

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100 ink-bg">
      <div className="ink-grain" aria-hidden />

      {/* 顶栏：液态玻璃悬浮 */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-zinc-950/75 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 animate-rise" style={{ "--i": 0 } as React.CSSProperties}>
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400">
              <BookOpenText className="w-4 h-4" strokeWidth={1.75} />
            </span>
            <span className="font-bold tracking-[0.2em]">墨卷</span>
            <span className="hidden sm:inline text-xs tnum tracking-[0.25em] text-zinc-600 uppercase">NovelForge</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-sm animate-rise" style={{ "--i": 1 } as React.CSSProperties}>
            <span className="hidden md:inline text-xs text-zinc-500 mr-1">
              {user?.byok ? (
                <span className="text-emerald-400">自有 API · 不限额度</span>
              ) : (
                <>
                  {user?.plan_name} · 本月剩余 <span className="tnum text-zinc-300">{monthLeft}</span> 章
                  {user && user.extra_chapters > 0 && <span className="tnum"> + 加油包 {user.extra_chapters}</span>}
                </>
              )}
            </span>
            <Button variant="outline" size="sm" onClick={() => nav("/billing")}
              className="border-zinc-800 bg-white/[0.03] hover:bg-white/[0.07] hover:border-amber-500/40 active:scale-[0.97] transition-all duration-300 ease-fluid">
              <Coins className="w-4 h-4 mr-1 text-amber-400" /> 额度中心
            </Button>
            {user?.is_admin && (
              <Button variant="outline" size="sm" onClick={() => nav("/admin")}
                className="border-zinc-800 bg-white/[0.03] hover:bg-white/[0.07] active:scale-[0.97] transition-all duration-300 ease-fluid">
                <Settings className="w-4 h-4 mr-1" /> 后台
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={logout} className="text-zinc-500 hover:text-zinc-200">
              <LogOut className="w-4 h-4 mr-1" /> 退出
            </Button>
          </div>
        </div>
      </header>

      {/* 升级引导条：额度告急时浮出，一键直达收银台（液态玻璃，可关闭） */}
      <UpgradeNudge />

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* 非对称头排：左侧标题 + 右侧玻璃额度面板（taste Rule 3） */}
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6 items-end mb-10">
          <div className="animate-rise" style={{ "--i": 1 } as React.CSSProperties}>
            <p className="text-xs tnum tracking-[0.3em] text-amber-500/80 uppercase mb-3 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" /> Studio
            </p>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
              {greeting()}，{user?.username}
            </h1>
            <p className="text-sm text-zinc-500 mt-3 max-w-[52ch] leading-relaxed">
              今天想写一个什么样的故事？一句灵感，剩下的交给流水线。
            </p>
          </div>

          {/* 移动端可见的额度面板 */}
          <div className="lg:hidden animate-rise" style={{ "--i": 2 } as React.CSSProperties}>
            <div className="rounded-xl glass-edge bg-zinc-900/60 px-4 py-3 text-xs text-zinc-400">
              {user?.byok ? <span className="text-emerald-400">自有 API · 不限额度</span> : (
                <><span className="tnum text-zinc-200">{monthLeft}</span> / {user?.plan_chapters} 章本月剩余{user && user.extra_chapters > 0 && <> · 加油包 <span className="tnum">{user.extra_chapters}</span></>}</>
              )}
            </div>
          </div>

          <div className="hidden lg:flex justify-end animate-rise" style={{ "--i": 2 } as React.CSSProperties}>
            <div className="rounded-2xl glass-edge bg-zinc-900/60 backdrop-blur px-6 py-4 flex items-center gap-6">
              <div>
                <p className="text-[11px] tracking-wider text-zinc-500 uppercase">本月剩余</p>
                <p className="text-2xl font-semibold tnum text-amber-300 mt-0.5">{monthLeft}<span className="text-sm font-normal text-zinc-500"> / {user?.plan_chapters ?? "—"}</span></p>
              </div>
              <div className="w-px h-9 bg-white/[0.07]" />
              <div>
                <p className="text-[11px] tracking-wider text-zinc-500 uppercase">加油包</p>
                <p className="text-2xl font-semibold tnum text-zinc-200 mt-0.5">{user?.extra_chapters ?? 0}<span className="text-sm font-normal text-zinc-500"> 章</span></p>
              </div>
              <div className="w-px h-9 bg-white/[0.07]" />
              <div>
                <p className="text-[11px] tracking-wider text-zinc-500 uppercase">作品</p>
                <p className="text-2xl font-semibold tnum text-zinc-200 mt-0.5">{projects?.length ?? "—"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 作品区标题 + 新建 */}
        <div className="flex items-center justify-between mb-5 animate-rise" style={{ "--i": 3 } as React.CSSProperties}>
          <h2 className="text-sm font-medium tracking-wider text-zinc-400 uppercase flex items-center gap-2">
            <PenLine className="w-4 h-4 text-zinc-600" /> 我的作品
          </h2>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold">
                <Plus className="w-4 h-4 mr-1" /> 新建作品
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-lg rounded-2xl">
              <DialogHeader>
                <DialogTitle>新建 AI 小说工程</DialogTitle>
                <DialogDescription className="text-zinc-500">
                  输入一句灵感，AI 将自动完成整书策划、逐章写作、审校修订。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>书名</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-zinc-950/80 border-zinc-800 focus-visible:ring-amber-500/40" placeholder="我的第一本书" />
                </div>
                <div className="space-y-2">
                  <Label>创作灵感（核心脑洞、主线、想要的爽点）</Label>
                  <Textarea rows={4} value={form.idea} onChange={(e) => setForm({ ...form, idea: e.target.value })} className="bg-zinc-950/80 border-zinc-800 focus-visible:ring-amber-500/40 leading-relaxed" placeholder="例：废土上最后一个快递员，发现包裹里装的是他自己…" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label>题材</Label>
                    <Select value={form.genre} onValueChange={(v) => setForm({ ...form, genre: v })}>
                      <SelectTrigger className="bg-zinc-950/80 border-zinc-800"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-800">
                        {GENRES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>章节数（消耗额度）</Label>
                    <Input type="number" min={1} max={200} value={form.target_chapters} onChange={(e) => setForm({ ...form, target_chapters: Number(e.target.value) })} className="bg-zinc-950/80 border-zinc-800 tnum focus-visible:ring-amber-500/40" />
                  </div>
                  <div className="space-y-2">
                    <Label>每章字数</Label>
                    <div className="flex gap-1.5">
                      {[2000, 3000, 5000].map((w) => (
                        <button key={w} type="button"
                          onClick={() => setForm({ ...form, target_words: w })}
                          className={`flex-1 h-9 rounded-lg border text-xs tnum transition-all duration-300 ease-fluid ${
                            form.target_words === w
                              ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                              : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                          }`}>
                          {w}
                        </button>
                      ))}
                      <Input type="number" min={500} max={20000} value={form.target_words}
                        onChange={(e) => setForm({ ...form, target_words: Number(e.target.value) })}
                        className="w-20 h-9 bg-zinc-950/80 border-zinc-800 tnum focus-visible:ring-amber-500/40" />
                    </div>
                  </div>
                </div>
                {error && (
                  <p className="text-sm text-red-400 border border-red-900/50 bg-red-950/40 rounded-lg px-3 py-2">{error}</p>
                )}
                {shortfall > 0 && (
                  <p className="text-sm text-amber-200/90 border border-amber-500/30 bg-amber-500/[0.08] rounded-lg px-3 py-2 flex items-start gap-1.5">
                    <Coins className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
                    本工程需要 <span className="tnum">{form.target_chapters}</span> 章，当前剩余 <span className="tnum">{available}</span> 章，还差 <span className="tnum">{shortfall}</span> 章
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
                <Button className={shortfall > 0
                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold"
                    : "bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold"}
                  disabled={busy} onClick={create}
                  title={shortfall > 0 ? undefined : estimateBreakdown(estimate)}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  {busy ? "创建中…" : shortfall > 0 ? "额度不足 · 去升级" : <>开始生成<span className="tnum opacity-75">（预估 {formatTokens(estimate.total)} tokens）</span></>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 骨架屏加载（taste Rule 5：Loading 贴合布局） */}
        {projects === null && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-5 space-y-4">
                <div className="skeleton h-5 w-2/3" />
                <div className="skeleton h-4 w-full" />
                <div className="skeleton h-4 w-4/5" />
                <div className="skeleton h-2 w-full !rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* 空状态（taste Rule 5：Empty State 构图） */}
        {projects !== null && projects.length === 0 && (
          <div className="animate-rise rounded-3xl border border-dashed border-zinc-800 bg-zinc-900/30 py-20 flex flex-col items-center text-center" style={{ "--i": 4 } as React.CSSProperties}>
            <span className="grid place-items-center w-16 h-16 rounded-2xl bg-amber-500/[0.07] border border-amber-500/20 text-amber-400/80 mb-5">
              <BookOpenText className="w-7 h-7" strokeWidth={1.5} />
            </span>
            <p className="text-lg font-medium text-zinc-200">还没有作品</p>
            <p className="text-sm text-zinc-500 mt-2 max-w-[40ch] leading-relaxed">
              点击右上角「新建作品」，用一句灵感开启你的第一部 AI 长篇小说。
            </p>
          </div>
        )}

        {/* 作品网格：首个作品跨两列，非对称（taste Rule 3/7: 禁三均分卡片） */}
        {projects !== null && projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p, i) => (
              <Link
                key={p.id}
                to={`/project/${p.id}`}
                className={`block animate-rise ${i === 0 && projects.length > 1 ? "md:col-span-2" : ""}`}
                style={{ "--i": 4 + i } as React.CSSProperties}
              >
                <SpotlightCard className="rounded-2xl border border-white/[0.06] bg-zinc-900/60 p-5 h-full transition-all duration-300 ease-fluid hover:border-amber-500/30 hover:-translate-y-0.5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-semibold text-lg tracking-tight line-clamp-1">{p.name}</h3>
                    {statusBadge(p)}
                  </div>
                  <p className="text-sm text-zinc-500 line-clamp-2 mb-5 leading-relaxed">{p.idea}</p>
                  {(p.status === "running" || p.status === "queued") ? (
                    <ProgressStream
                      msg={p.progress_msg}
                      done={p.chapters_done}
                      target={p.target_chapters}
                      status={p.status}
                    />
                  ) : (
                    <p className="text-xs text-zinc-600 tnum">
                      {p.genre} ｜ {p.chapters_done}/{p.target_chapters} 章 ｜ {p.created_at.slice(0, 10)}
                    </p>
                  )}
                  {p.status === "failed" && p.error && (
                    <p className="text-xs text-red-400/90 mt-3 border border-red-900/40 bg-red-950/30 rounded-lg px-3 py-2 flex items-start gap-1.5">
                      <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{p.error}
                    </p>
                  )}
                  {p.status === "done" && (
                    <p className="text-xs text-emerald-500/80 mt-3 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 已完本，可导出 Markdown
                    </p>
                  )}
                </SpotlightCard>
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* 额度不足拦截弹窗：最短付费路径 */}
      <QuotaGateDialog open={!!gate} onOpenChange={(v) => { if (!v) setGate(null); }} info={gate} />

      {/* 摸鱼坞：生成等得无聊时随时打开，本地小游戏不耗额度 */}
      <PastimeDock />
    </div>
  );
}
