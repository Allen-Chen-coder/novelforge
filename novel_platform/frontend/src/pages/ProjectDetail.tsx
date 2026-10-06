import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router";
import { api, getToken, apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import PastimeDock from "@/components/PastimeDock";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import UpgradeNudge from "@/components/UpgradeNudge";
import QuotaGateDialog, { type GateInfo } from "@/components/QuotaGateDialog";
import { estimateProjectTokens, estimateBreakdown, formatTokens } from "@/lib/estimate";
import { ArrowLeft, Download, Loader2, Activity, BookPlus, RotateCcw } from "lucide-react";

interface ChapterMeta { idx: number; title: string; summary: string; revise_rounds: number }
interface Detail {
  id: number; name: string; status: string; progress_msg: string;
  target_chapters: number; target_words: number; genre: string;
  chapters_done: number; error: string | null;
  chapters: ChapterMeta[];
  usage: { calls: number; prompt_tokens: number; completion_tokens: number };
  trial?: boolean;
}
interface Chapter extends ChapterMeta { text: string; issues: any[] }

/** 直播事件：kind 决定弹幕配色，lane 决定飘过的行 */
interface FeedItem { id: number; kind: "plan" | "write" | "review" | "revise" | "done" | "fail"; text: string; lane: number }

/** 从流水线进度文案归类事件，用于弹幕配色 */
function classifyProgress(msg: string): FeedItem["kind"] {
  if (/审校|问题/.test(msg)) return "review";
  if (/修订/.test(msg)) return "revise";
  if (/策划/.test(msg)) return "plan";
  if (/写作|生产|开笔/.test(msg)) return "write";
  return "done";
}

const FEED_STYLE: Record<FeedItem["kind"], string> = {
  plan: "border-sky-500/25 bg-sky-500/[0.08] text-sky-300",
  write: "border-amber-500/30 bg-amber-500/[0.1] text-amber-200",
  review: "border-violet-500/25 bg-violet-500/[0.08] text-violet-300",
  revise: "border-orange-500/25 bg-orange-500/[0.08] text-orange-300",
  done: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300",
  fail: "border-red-500/30 bg-red-500/[0.1] text-red-300",
};

const FEED_DOT: Record<FeedItem["kind"], string> = {
  plan: "bg-sky-400",
  write: "bg-amber-400",
  review: "bg-violet-400",
  revise: "bg-orange-400",
  done: "bg-emerald-400",
  fail: "bg-red-400",
};

/** 进度原文压缩成弹幕短句 */
function shorten(msg: string): string {
  const clean = msg.replace(/\s+/g, " ").trim();
  return clean.length > 26 ? clean.slice(0, 26) + "…" : clean;
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { user, refresh } = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [current, setCurrent] = useState<Chapter | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendChapters, setExtendChapters] = useState(10);
  const [extendBusy, setExtendBusy] = useState(false);
  const [gate, setGate] = useState<GateInfo | null>(null);
  const [extendError, setExtendError] = useState("");
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartMsg, setRestartMsg] = useState("");
  const pollRef = useRef<number | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const settledRef = useRef(false); // 工程结算后只刷新一次额度
  const esRef = useRef<EventSource | null>(null);
  // 直播看台：SSE 逐字推送的章节正文与标题（running 期间主阅读区优先展示）
  const [liveTexts, setLiveTexts] = useState<Record<number, string>>({});
  const [liveTitles, setLiveTitles] = useState<Record<number, string>>({});
  const [liveIdx, setLiveIdx] = useState<number | null>(null);
  // 弹幕时间线：策划/写作/审校/修订/定稿事件，飘过直播区顶部
  const [liveFeed, setLiveFeed] = useState<FeedItem[]>([]);
  const feedIdRef = useRef(0);

  const pushFeed = useCallback((kind: FeedItem["kind"], text: string) => {
    feedIdRef.current += 1;
    const item: FeedItem = { id: feedIdRef.current, kind, text, lane: feedIdRef.current % 4 };
    setLiveFeed((f) => [...f.slice(-11), item]);
  }, []);

  const load = useCallback(async () => {
    const d = await api<Detail>("GET", `/api/projects/${id}`);
    setDetail(d);
    // 额度在工程完成时结算：完成后刷新一次用户信息，让剩余量与引导条同步
    if (d.status === "done" && !settledRef.current) {
      settledRef.current = true;
      refresh();
    }
    if (d.status === "running" || d.status === "queued") {
      pollRef.current = window.setTimeout(load, 3000);
    }
  }, [id]);

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [load]);

  // 直播看台：工程进入生成态时订阅 SSE，逐字渲染当前写作章节
  const status = detail?.status;
  useEffect(() => {
    const active = status === "running" || status === "queued";
    if (!active || !id) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    const es = new EventSource(`${apiUrl(`/api/projects/${id}/stream`)}?token=${encodeURIComponent(getToken())}`);
    esRef.current = es;
    es.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "snapshot") {
        setLiveTexts(msg.texts || {});
        // 断线重连：用缓冲事件回填弹幕时间线
        for (const e of msg.events || []) {
          if (e.type === "progress") pushFeed(classifyProgress(e.msg), shorten(e.msg));
          else if (e.type === "chapter_start") pushFeed("write", `第 ${e.index} 章开笔`);
          else if (e.type === "chapter_done") pushFeed("done", `第 ${e.index} 章《${e.title}》定稿`);
        }
      } else if (msg.type === "progress") {
        pushFeed(classifyProgress(msg.msg), shorten(msg.msg));
      } else if (msg.type === "chapter_start") {
        setLiveIdx(msg.index);
        setLiveTexts((t) => ({ ...t, [msg.index]: t[msg.index] ?? "" }));
        pushFeed("write", `第 ${msg.index} 章开笔`);
      } else if (msg.type === "chunk") {
        setLiveIdx(msg.index);
        setLiveTexts((t) => ({ ...t, [msg.index]: (t[msg.index] || "") + msg.text }));
      } else if (msg.type === "chapter_done") {
        // 终稿入库：清掉直播文本，让主阅读区改读正式版，同时刷新章节列表
        setLiveTexts((t) => {
          const next = { ...t };
          delete next[msg.index];
          return next;
        });
        if (msg.title) setLiveTitles((s) => ({ ...s, [msg.index]: msg.title }));
        pushFeed("done", `第 ${msg.index} 章《${msg.title}》定稿`);
        load();
      } else if (msg.type === "done" || msg.type === "failed") {
        pushFeed(msg.type === "done" ? "done" : "fail",
          msg.type === "done" ? "全书完成，正在归档…" : `生成中断：${shorten(msg.error || "")}`);
        es.close();
        load(); // 立即拉取终态，不等下一轮轮询
      }
    };
    es.onerror = () => { es.close(); };
    return () => { es.close(); };
  }, [status, id, load, pushFeed]);

  // 直播自动跟随滚动：用户停留在底部附近时，新段落冒出即跟随
  const liveLen = liveIdx !== null ? (liveTexts[liveIdx] || "").length : 0;
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [liveLen]);

  // 失败工程重新开始：断点续跑（已完成章节不重复生成/结算）
  const restart = async () => {
    setRestartMsg("");
    setRestartBusy(true);
    try {
      await api("POST", `/api/projects/${id}/restart`);
      settledRef.current = false;
      setLiveFeed([]);
      setLiveTexts({});
      setLiveTitles({});
      load(); // 状态已变 queued，重新进入轮询与 SSE
    } catch (e: any) {
      setRestartMsg(e.message);
    } finally {
      setRestartBusy(false);
    }
  };

  // 续写：追加 N 章，个人书库保证与前文连贯；完成后自动重新轮询
  const extend = async () => {
    setExtendError("");
    const available = user ? Math.max(0, user.plan_chapters - user.used_chapters) + user.extra_chapters : 0;
    if (user && !user.byok && extendChapters > available) {
      setExtendOpen(false);
      setGate({ needed: extendChapters, remaining: available });
      return;
    }
    setExtendBusy(true);
    try {
      await api("POST", `/api/projects/${id}/extend`, { chapters: extendChapters });
      setExtendOpen(false);
      settledRef.current = false;
      load(); // 状态已变 queued，重新进入轮询
    } catch (e: any) {
      if (typeof e.message === "string" && e.message.includes("额度不足")) {
        setExtendOpen(false);
        setGate({ needed: extendChapters, remaining: available });
      } else {
        setExtendError(e.message);
      }
    } finally {
      setExtendBusy(false);
    }
  };

  const openChapter = async (idx: number) => {
    if (current?.idx === idx) return;
    setChapterLoading(true);
    try {
      // 章节正文滑入前先把阅读区带回顶部（平滑滚动，与 slide-in 同时进行）
      mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      setCurrent(await api<Chapter>("GET", `/api/projects/${id}/chapters/${idx}`));
    } finally {
      setChapterLoading(false);
    }
  };

  // 工程生成完毕、尚无选中章节时，自动打开第一章
  useEffect(() => {
    if (detail && detail.chapters.length > 0 && !current && !chapterLoading) {
      openChapter(detail.chapters[0].idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const exportMd = async () => {
    const text = await api<string>("GET", `/api/projects/${id}/export`);
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${detail?.name || "novel"}.md`;
    a.click();
  };

  /** 二进制格式（PDF/Word）：带鉴权下载后交给浏览器保存 */
  const exportFile = async (url: string, filename: string) => {
    const resp = await fetch(apiUrl(url), {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    });
    if (!resp.ok) {
      let msg = `导出失败（${resp.status}）`;
      try { msg = (await resp.json())?.detail || msg; } catch { /* 忽略 */ }
      throw new Error(msg);
    }
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // 导出署名：选 PDF/Word 时先询问笔名；默认取服务器作者资料，本机输入作为覆盖
  const [exportFmt, setExportFmt] = useState<"pdf" | "docx" | null>(null);
  const [authorName, setAuthorName] = useState(() => localStorage.getItem("nvf_author") || "");

  useEffect(() => {
    api<{ pen_name: string; bio: string }>("GET", "/api/me/profile")
      .then((p) => {
        if (p.pen_name) setAuthorName(p.pen_name);
        else if (p.pen_name === "" && !localStorage.getItem("nvf_author")) setAuthorName("");
      })
      .catch(() => { /* 未登录忽略 */ });
  }, []);

  const confirmExport = async () => {
    if (!exportFmt) return;
    const author = authorName.trim();
    localStorage.setItem("nvf_author", author);
    const fmt = exportFmt;
    setExportFmt(null);
    await exportFile(
      `/api/projects/${id}/export.${fmt}?author=${encodeURIComponent(author)}`,
      `${detail?.name || "novel"}.${fmt}`
    ).catch((e) => alert(e.message));
  };

  if (!detail)
    return (
      <div className="min-h-[100dvh] bg-zinc-950 ink-bg flex items-center justify-center">
        <div className="space-y-3 w-64">
          <div className="skeleton h-5 w-1/2" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-3/4" />
        </div>
      </div>
    );

  const running = detail.status === "running" || detail.status === "queued";
  // 直播看台：正在逐字生成的章节正文优先于已归档章节展示
  const liveText = liveIdx !== null ? (liveTexts[liveIdx] || "") : "";
  const showLive = running && liveIdx !== null && liveText.length > 0;

  // 额度：生成期间尚未结算，按「本工程将占用 target_chapters 章」预估结算后剩余
  const monthLeft = user ? Math.max(0, user.plan_chapters - user.used_chapters) : 0;
  const projLeft = user ? Math.max(0, monthLeft + user.extra_chapters - (running ? detail.target_chapters : 0)) : 0;

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100 ink-bg flex flex-col">
      <div className="ink-grain" aria-hidden />
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-zinc-950/75 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-4">
          <Link to="/"><Button variant="ghost" size="sm" className="text-zinc-500 hover:text-zinc-200"><ArrowLeft className="w-4 h-4 mr-1" />返回</Button></Link>
          <h1 className="font-bold tracking-tight line-clamp-1">{detail.name}</h1>
          {running && (
            <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 tnum">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />生成中 {detail.chapters_done}/{detail.target_chapters}
            </Badge>
          )}
          {detail.status === "done" && <Badge className="bg-emerald-600/90 hover:bg-emerald-600 text-emerald-50">已更新至第 {detail.chapters_done} 章 · 连载中</Badge>}
          {detail.status === "failed" && (
            <>
              <Badge variant="destructive">失败</Badge>
              <Button
                size="sm"
                className="bg-amber-500 text-zinc-950 hover:bg-amber-400 h-7"
                disabled={restartBusy}
                onClick={restart}
                title="断点续跑：已完成章节不重复生成"
              >
                {restartBusy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
                {restartBusy ? "排队中…" : "重新开始写作"}
              </Button>
            </>
          )}
          <div className="flex-1" />
          {user && (
            <span className="hidden md:inline text-xs text-zinc-500 mr-1 whitespace-nowrap">
              {user.byok ? (
                <span className="text-emerald-400">自有 API · 不限额度</span>
              ) : running ? (
                <>本月剩余 <span className="tnum text-zinc-300">{monthLeft + user.extra_chapters}</span> 章 · 完成后预计剩 <span className={`tnum ${projLeft <= 3 ? "text-amber-400" : "text-zinc-300"}`}>{projLeft}</span> 章</>
              ) : (
                <>本月剩余 <span className="tnum text-zinc-300">{monthLeft + user.extra_chapters}</span> 章</>
              )}
            </span>
          )}
          {detail.chapters.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline"
                  className="border-zinc-800 bg-white/[0.03] hover:bg-white/[0.07] hover:border-amber-500/40 active:scale-[0.97] transition-all duration-300 ease-fluid">
                  <Download className="w-4 h-4 mr-1" />导出全书
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 text-zinc-100">
                <DropdownMenuLabel className="text-zinc-500">选择导出格式</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-zinc-800" />
                <DropdownMenuItem className="focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer" onSelect={exportMd}>
                  <Download className="w-4 h-4 mr-2 text-zinc-500" />
                  <div>
                    <div>Markdown</div>
                    <div className="text-xs text-zinc-500">纯文本，适合继续编辑</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer"
                  onSelect={() => setExportFmt("pdf")}
                >
                  <Download className="w-4 h-4 mr-2 text-amber-500/70" />
                  <div>
                    <div>PDF（排版精修）</div>
                    <div className="text-xs text-zinc-500">封面 + 页码 + 精排段落，适合分享阅读</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer"
                  onSelect={() => setExportFmt("docx")}
                >
                  <Download className="w-4 h-4 mr-2 text-sky-500/70" />
                  <div>
                    <div>Word（.docx）</div>
                    <div className="text-xs text-zinc-500">宋体小四、1.5 倍行距，适合投稿打印</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {detail.status === "done" && (
            <Button size="sm" onClick={() => setExtendOpen(true)}
              title="像日更作者一样追加章节：一次 1 章也行，书库保证承接前文"
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold">
              <BookPlus className="w-4 h-4 mr-1" />继续更新
            </Button>
          )}
        </div>
        {running && (
          <div className="max-w-7xl mx-auto px-6 pb-3">
            <Progress value={(detail.chapters_done / detail.target_chapters) * 100} className="h-1 bg-zinc-800" />
            <p className="text-xs text-zinc-500 mt-1.5">{detail.progress_msg}</p>
          </div>
        )}
        {/* 实际 vs 预估：生成中实时计量，完成后结算对比；预估经校准只高不低，结算展示节省量 */}
        {detail.usage.calls > 0 && (() => {
          const actual = detail.usage.prompt_tokens + detail.usage.completion_tokens;
          const est = estimateProjectTokens(detail.target_chapters, {
            targetWords: detail.target_words,
            genre: detail.genre,
          }).total;
          const pct = Math.min(999, Math.round((actual / est) * 100));
          const done = detail.status === "done";
          const saved = est - actual;
          return (
            <div className="max-w-7xl mx-auto px-6 pb-3 flex items-center gap-2 text-xs text-zinc-500 tnum">
              <Activity className="w-3.5 h-3.5 text-amber-500/70" />
              <span>本次已用 <span className="text-zinc-300">{actual.toLocaleString()}</span> tokens（预估 {formatTokens(est)}）</span>
              {done && saved >= 0 ? (
                <span className="text-emerald-500/80">
                  已为您节省 {saved.toLocaleString()} tokens（低于预估 {100 - pct}%）
                </span>
              ) : done ? (
                <span className="text-zinc-500">实际 {actual.toLocaleString()} · 预估 {est.toLocaleString()}</span>
              ) : (
                <span className="text-zinc-600">进行中 {Math.min(99, pct)}%</span>
              )}
            </div>
          );
        })()}
        {detail.status === "failed" && (detail.error || restartMsg) && (
          <div className="max-w-7xl mx-auto px-6 pb-3 space-y-1">
            {detail.error && <p className="text-sm text-red-400">{detail.error}</p>}
            {restartMsg && <p className="text-sm text-amber-300">{restartMsg}</p>}
            {detail.error && detail.error.includes("模型配置") && (
              <p className="text-xs text-zinc-500">提示：到「额度中心 → 自有 API」修正 API Key 后，点上方「重新开始写作」即可断点续跑，已完成章节不会重复生成。</p>
            )}
          </div>
        )}
      </header>

      {/* 升级引导条：按结算后剩余预估告急，生成中也能随时掌握额度 */}
      <UpgradeNudge pending={running ? detail.target_chapters : 0} />

      <div className="flex-1 max-w-7xl w-full mx-auto flex overflow-hidden relative">
        {/* 弹幕时间线：创作事件从右向左飘过直播区顶部（仅生成中显示） */}
        {running && liveFeed.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-30 h-40 overflow-hidden" aria-hidden>
            {liveFeed.map((it) => (
              <span
                key={it.id}
                onAnimationEnd={() => setLiveFeed((f) => f.filter((x) => x.id !== it.id))}
                className={`nvf-danmaku rounded-full border px-3.5 py-1.5 text-xs backdrop-blur-md shadow-lg ${FEED_STYLE[it.kind]}`}
                style={{ top: 6 + it.lane * 36 }}
              >
                {it.text}
              </span>
            ))}
          </div>
        )}
        <aside className="w-64 border-r border-white/[0.06] shrink-0 hidden md:block">
          <ScrollArea className="h-full">
            <div className="p-3 space-y-1">
              {detail.chapters.length === 0 && (
                <p className="text-sm text-zinc-600 p-3">章节生成后在此列出</p>
              )}
              {detail.chapters.map((c) => {
                const active = current?.idx === c.idx;
                return (
                  <button
                    key={c.idx}
                    onClick={() => openChapter(c.idx)}
                    className={`relative w-full text-left rounded-xl px-3 py-2.5 pl-4 text-sm transition-all duration-300 ease-fluid ${
                      active
                        ? "bg-amber-500/[0.12] text-amber-200 border border-amber-500/25"
                        : "hover:bg-white/[0.04] text-zinc-300 border border-transparent"
                    }`}
                  >
                    {/* 共享元素指示条：随选中章节弹性生长 */}
                    {active && (
                      <span className="absolute left-1.5 top-2 bottom-2 w-[3px] rounded-full bg-amber-400 animate-grow-bar" aria-hidden />
                    )}
                    <div className="font-medium line-clamp-1"><span className="tnum text-zinc-500 mr-1.5">{String(c.idx).padStart(2, "0")}</span>{c.title}</div>
                    {c.summary && <div className="text-xs text-zinc-600 line-clamp-2 mt-1 leading-relaxed">{c.summary}</div>}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </aside>

        <main ref={mainRef} className="flex-1 overflow-y-auto h-full">
          {showLive ? (
            /* 直播看台：SSE 逐字推送，看着本章一点一点长出来 */
            <article key={`live-${liveIdx}`} className="max-w-2xl mx-auto px-8 py-12 animate-slide-in">
              <p className="text-xs tnum tracking-[0.3em] text-amber-500/70 uppercase mb-3 flex items-center gap-2.5">
                Chapter {String(liveIdx).padStart(2, "0")} · 直播写作中
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
                </span>
              </p>
              <h2 className="text-2xl md:text-[1.7rem] font-semibold tracking-tight mb-10 leading-snug">
                {liveTitles[liveIdx ?? -1] || "正在构思本章标题…"}
              </h2>
              {(() => {
                const paras = liveText.split("\n");
                let lastIdx = -1;
                paras.forEach((p, i) => { if (p.trim()) lastIdx = i; });
                return paras.map((para, i) =>
                  para.trim() ? (
                    <p key={i} className="mb-6 leading-[1.9] text-zinc-300 indent-8 text-justify">
                      {para}
                      {i === lastIdx && (
                        <span className="inline-block w-[0.55em] text-amber-400 animate-pulse select-none" aria-hidden>▍</span>
                      )}
                    </p>
                  ) : null
                );
              })()}
              <p className="mt-4 text-xs text-zinc-600 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500/60" />
                本章逐字生成中，完成后自动归档；等得无聊可以去右下角「摸鱼一下」
              </p>
              {/* 最近创作动态：弹幕消失后仍留有痕迹， newest first */}
              {liveFeed.length > 0 && (
                <div className="mt-10 rounded-2xl glass-edge bg-zinc-900/60 p-5">
                  <p className="text-xs tracking-[0.25em] text-amber-500/70 uppercase mb-3">创作动态</p>
                  <div className="space-y-2">
                    {[...liveFeed].reverse().slice(0, 5).map((it) => (
                      <p key={it.id} className="text-xs text-zinc-400 flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${FEED_DOT[it.kind]}`} />
                        {it.text}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ) : current && !chapterLoading ? (
            /* key=idx：换章时重挂载触发滑入过渡 */
            <article key={current.idx} className="max-w-2xl mx-auto px-8 py-12 animate-slide-in">
              <p className="text-xs tnum tracking-[0.3em] text-amber-500/70 uppercase mb-3">Chapter {String(current.idx).padStart(2, "0")}</p>
              <h2 className="text-2xl md:text-[1.7rem] font-semibold tracking-tight mb-10 leading-snug">{current.title}</h2>
              {detail.trial && (
                <p className="mb-10 text-xs text-amber-200/90 border border-amber-500/30 bg-amber-500/[0.08] rounded-lg px-3.5 py-2.5 leading-relaxed">
                  免费体验版仅生成每章前 1000 字。到「额度中心 → 自有 API」接入自己的 Key（免费、不限额度），或升级套餐解锁完整章节。
                </p>
              )}
              {current.text.split("\n").map((para, i) =>
                para.trim() ? <p key={i} className="mb-6 leading-[1.9] text-zinc-300 indent-8 text-justify">{para}</p> : null
              )}
              {current.issues?.length > 0 && (
                <div className="mt-12 rounded-2xl glass-edge bg-zinc-900/60 p-5">
                  <p className="text-sm font-medium text-zinc-400 mb-2.5">审校记录（{current.revise_rounds} 轮修订后遗留 {current.issues.length} 条提示）</p>
                  {current.issues.map((it: any, i: number) => (
                    <p key={i} className="text-xs text-zinc-500 leading-relaxed">· [{it.category}] {it.description}</p>
                  ))}
                </div>
              )}
            </article>
          ) : chapterLoading ? (
            /* 换章骨架屏：贴合正文书排（taste Rule 5） */
            <div className="max-w-2xl mx-auto px-8 py-12 animate-slide-in">
              <div className="skeleton h-3 w-28 mb-4" />
              <div className="skeleton h-8 w-2/3 mb-10" />
              <div className="space-y-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-4" style={{ width: `${92 - (i % 3) * 8}%` }} />
                ))}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-3">
              {running ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin text-amber-500/60" />
                  <p className="text-sm">AI 正在创作中，章节完成后点击左侧阅读…</p>
                </>
              ) : (
                <p className="text-sm">从左侧选择章节开始阅读</p>
              )}
            </div>
          )}
        </main>
      </div>

      {/* 继续更新对话框：追加章节，个人书库保证与前文连贯 */}
      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>继续更新《{detail.name}》</DialogTitle>
            <DialogDescription className="text-zinc-400 leading-relaxed">
              作品处于连载中：基于个人书库（全书梗概、人物状态、未回收伏笔）规划后续卷，
              新章节直接承接第 {detail.chapters_done} 章。今天更新 1 章，还是一口气更 5 章，都可以。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>本次更新章节数（消耗额度）</Label>
              <Input type="number" min={1} max={200} value={extendChapters}
                onChange={(e) => setExtendChapters(Number(e.target.value))}
                className="bg-zinc-950/80 border-zinc-800 tnum focus-visible:ring-amber-500/40" />
            </div>
            <p className="text-xs text-zinc-500 tnum">
              预估 {formatTokens(estimateProjectTokens(extendChapters, { targetWords: detail.target_words, genre: detail.genre }).total)} tokens
              <span className="text-zinc-600">（悬浮查看明细）</span>
            </p>
            {extendError && (
              <p className="text-sm text-red-400 border border-red-900/50 bg-red-950/40 rounded-lg px-3 py-2">{extendError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExtendOpen(false)} className="text-zinc-500 hover:text-zinc-300">取消</Button>
            <Button onClick={extend} disabled={extendBusy}
              title={estimateBreakdown(estimateProjectTokens(extendChapters, { targetWords: detail.target_words, genre: detail.genre }))}
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold">
              {extendBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <BookPlus className="w-4 h-4 mr-1" />}
              {extendBusy ? "规划中…" : "开始更新"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导出署名对话框：PDF/Word 封面落款 */}
      <Dialog open={exportFmt !== null} onOpenChange={(v) => { if (!v) setExportFmt(null); }}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>导出《{detail.name}》</DialogTitle>
            <DialogDescription className="text-zinc-400 leading-relaxed">
              已自动填入你的作者资料，可为本书临时改署名；留空则不显示。填写「内容简介」请到首页「作者资料」。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>作者笔名</Label>
            <Input value={authorName} maxLength={30}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="例如：青衫烟雨"
              className="bg-zinc-950/80 border-zinc-800 focus-visible:ring-amber-500/40"
              onKeyDown={(e) => { if (e.key === "Enter") confirmExport(); }} />
            <p className="text-xs text-zinc-500">笔名仅用于本次导出，保存在本机，下次自动填入。</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExportFmt(null)} className="text-zinc-500 hover:text-zinc-300">取消</Button>
            <Button onClick={confirmExport}
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold">
              <Download className="w-4 h-4 mr-1" />确认导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 额度不足拦截 */}
      <QuotaGateDialog open={!!gate} onOpenChange={(v) => { if (!v) setGate(null); }} info={gate} />

      {/* 摸鱼坞：生成期间也能打开，本地小游戏不耗额度 */}
      <PastimeDock />
    </div>
  );
}
