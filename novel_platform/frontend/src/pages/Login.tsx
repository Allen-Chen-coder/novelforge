import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpenText, Feather, Workflow, Loader2 } from "lucide-react";

const FEATURES = [
  { icon: Feather, title: "一句灵感，整书成稿", desc: "AI 自动完成世界观、大纲与逐章写作" },
  { icon: Workflow, title: "审校修订流水线", desc: "每章自动质检回修，保持一致性与爽点节奏" },
  { icon: BookOpenText, title: "Markdown 导出", desc: "成书一键导出，直接连载或投稿" },
];

export default function LoginPage() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (mode: "login" | "register") => {
    setError("");
    // 客户端校验（inline error，不用 alert）
    const name = username.trim();
    if (!name) return setError("请输入用户名");
    if (mode === "register" && (name.length < 3 || name.length > 32))
      return setError("用户名需为 3-32 位");
    if (!password) return setError("请输入密码");
    if (mode === "register" && password.length < 6)
      return setError("密码至少 6 位");
    setBusy(true);
    try {
      if (mode === "login") await login(name, password);
      else await register(name, password);
      nav("/");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    /* min-h-[100dvh] 防移动端布局跳动（taste: Viewport Stability） */
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100 ink-bg flex">
      <div className="ink-grain" aria-hidden />

      {/* 品牌面板：DESIGN_VARIANCE 8 —— 5/12 左侧竖排非对称，移动端整体隐藏为顶部条 */}
      <aside className="hidden lg:flex w-[42%] xl:w-[38%] relative flex-col justify-between p-12 xl:p-16 border-r border-white/[0.06]">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 45% at 15% 8%, rgba(245,158,11,0.10), transparent), radial-gradient(ellipse 55% 35% at 85% 95%, rgba(245,158,11,0.06), transparent)",
          }}
          aria-hidden
        />
        <div className="relative animate-rise" style={{ "--i": 0 } as React.CSSProperties}>
          <div className="flex items-center gap-3">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400">
              <BookOpenText className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <span className="text-sm tnum tracking-[0.3em] text-zinc-500 uppercase">NovelForge</span>
          </div>
        </div>

        <div className="relative space-y-10">
          {/* 竖排书名：东方装帧感 */}
          <div className="flex items-start gap-8 animate-rise" style={{ "--i": 1 } as React.CSSProperties}>
            <span
              className="text-6xl xl:text-7xl font-bold tracking-[0.35em] text-amber-100/95 select-none"
              style={{ writingMode: "vertical-rl" }}
              aria-label="墨卷"
            >
              墨卷
            </span>
            <div className="pt-2 space-y-4 max-w-[26ch]">
              <h1 className="text-2xl xl:text-[1.7rem] font-semibold tracking-tight text-zinc-100 leading-snug">
                让 AI 替你写完
                <br />
                那部一直没时间写的长篇
              </h1>
              <p className="text-sm leading-relaxed text-zinc-500">
                输入一句灵感，平台自动策划、逐章写作、审校修订——你只需要决定故事往哪里走。
              </p>
            </div>
          </div>

          <ul className="space-y-5">
            {FEATURES.map((f, i) => (
              <li
                key={f.title}
                className="flex items-start gap-4 animate-rise"
                style={{ "--i": 2 + i } as React.CSSProperties}
              >
                <span className="grid place-items-center w-9 h-9 shrink-0 rounded-lg border border-white/[0.07] bg-white/[0.03] text-amber-400/90">
                  <f.icon className="w-4 h-4" strokeWidth={1.75} />
                </span>
                <div>
                  <p className="text-sm font-medium text-zinc-200">{f.title}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-zinc-600 tnum animate-rise" style={{ "--i": 5 } as React.CSSProperties}>
          NovelForge · AI 长篇小说自动生成平台
        </p>
      </aside>

      {/* 表单面板：左对齐，液态玻璃容器（taste Rule 3: Anti-Center Bias） */}
      <main className="flex-1 flex items-center px-6 sm:px-12 lg:px-16 xl:px-24 py-12">
        <div className="w-full max-w-md animate-rise" style={{ "--i": 1 } as React.CSSProperties}>
          {/* 移动端品牌条 */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400">
              <BookOpenText className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-lg font-bold tracking-[0.25em] text-amber-100">墨卷</p>
              <p className="text-[11px] tnum tracking-[0.3em] text-zinc-500 uppercase">NovelForge</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">进入创作台</h2>
          <p className="text-sm text-zinc-500 mt-2 mb-8">
            登录或注册，开始你的第一本 AI 长篇小说。
          </p>

          <div className="rounded-2xl glass-edge bg-zinc-900/60 backdrop-blur px-6 sm:px-8 py-7">
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2 bg-zinc-950/80 border border-zinc-800 rounded-lg">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-5 mt-6">
                <div className="space-y-2">
                  <Label htmlFor="login-user">用户名</Label>
                  <Input
                    id="login-user"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="bg-zinc-950/80 border-zinc-800 focus-visible:ring-amber-500/40 h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-pass">密码</Label>
                  <Input
                    id="login-pass"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-zinc-950/80 border-zinc-800 focus-visible:ring-amber-500/40 h-11"
                  />
                </div>
                {error && (
                  <p className="text-sm text-red-400 border border-red-900/50 bg-red-950/40 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
                <Button
                  className="w-full h-11 bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.98] transition-all duration-300 ease-fluid font-semibold"
                  disabled={busy}
                  onClick={() => submit("login")}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {busy ? "登录中…" : "登录"}
                </Button>
              </TabsContent>

              <TabsContent value="register" className="space-y-5 mt-6">
                <div className="space-y-2">
                  <Label htmlFor="reg-user">用户名</Label>
                  <Input
                    id="reg-user"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="bg-zinc-950/80 border-zinc-800 focus-visible:ring-amber-500/40 h-11"
                  />
                  <p className="text-xs text-zinc-600">3-32 位，将作为你的笔名显示</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-pass">密码</Label>
                  <Input
                    id="reg-pass"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-zinc-950/80 border-zinc-800 focus-visible:ring-amber-500/40 h-11"
                  />
                  <p className="text-xs text-zinc-600">至少 6 位，建议混合字母与数字</p>
                </div>
                {error && (
                  <p className="text-sm text-red-400 border border-red-900/50 bg-red-950/40 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
                <Button
                  className="w-full h-11 bg-zinc-100 text-zinc-950 hover:bg-white active:scale-[0.98] transition-all duration-300 ease-fluid font-semibold"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => submit("register")}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {busy ? "注册中…" : "注册并登录"}
                </Button>
              </TabsContent>
            </Tabs>
          </div>

          <p className="text-xs text-zinc-600 mt-6">
            注册即表示同意平台服务条款 · 免费版每月 20 章生成额度
          </p>
        </div>
      </main>
    </div>
  );
}
