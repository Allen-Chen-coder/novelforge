import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Crown, Coins, Receipt, KeyRound, Zap, CheckCircle2, Loader2, Trash2, Save,
  Smartphone, MonitorSmartphone,
} from "lucide-react";
import SpotlightCard from "@/components/SpotlightCard";
import { ProviderPresetSelect } from "@/components/ProviderPresetSelect";
import { PROVIDER_PRESETS, presetKeyForBaseUrl } from "@/lib/providers";

interface CatalogItem {
  code: string; name: string; price_cents: number; chapters: number;
  tagline: string; features: string[]; months?: number;
}
interface Catalog {
  plans: CatalogItem[]; packs: CatalogItem[];
  balance: {
    plan: string; plan_name: string; plan_chapters: number; used_chapters: number;
    plan_reset_at: string | null; extra_chapters: number; remaining_chapters: number; byok: boolean;
  };
}
interface Order {
  id: number; kind: string; product_code: string; title: string;
  amount_cents: number; status: string; chapters: number; created_at: string; paid_at: string | null;
}
interface MyProvider {
  configured: boolean;
  base_url?: string; model?: string; temperature?: number; max_tokens?: number;
  enabled?: boolean; updated_at?: string; key_preview?: string;
}

const fmt = (cents: number) => (cents === 0 ? "¥0" : `¥${(cents / 100).toFixed(0)}`);
const fmtDate = (d: string | null) => (d ? d.slice(0, 10) : "—");

export default function Billing() {
  const { user, refresh } = useAuth();
  const [searchParams] = useSearchParams();
  // 支持 ?tab=packs|plans|orders|byok 深链（额度不足引导、加油包入口直达）
  const tabParam = searchParams.get("tab") || "";
  const defaultTab = ["plans", "packs", "orders", "byok"].includes(tabParam) ? tabParam : "plans";
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [confirmItem, setConfirmItem] = useState<CatalogItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // 收银台状态
  const [cashierOrder, setCashierOrder] = useState<Order | null>(null); // 已创建、待支付的订单
  const [channel, setChannel] = useState<"wechat" | "alipay">("wechat");
  const [qr, setQr] = useState<string | null>(null);      // 微信二维码 data URL
  const [payError, setPayError] = useState("");
  const [paidFlash, setPaidFlash] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // BYOK 表单
  const [provider, setProvider] = useState<MyProvider | null>(null);
  const [pf, setPf] = useState({ base_url: "https://api.moonshot.cn/v1", api_key: "", model: "kimi-k3", temperature: 0.8, max_tokens: 8192, enabled: true });
  const [pfMsg, setPfMsg] = useState("");
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  const load = async () => {
    setCatalog(await api<Catalog>("GET", "/api/catalog"));
    setOrders(await api<Order[]>("GET", "/api/orders"));
  };
  const loadProvider = async () => {
    const p = await api<MyProvider>("GET", "/api/my-provider");
    setProvider(p);
    if (p.configured) {
      setPf((f) => ({
        ...f, base_url: p.base_url!, model: p.model!,
        temperature: p.temperature!, max_tokens: p.max_tokens!, enabled: p.enabled!,
      }));
    }
  };
  useEffect(() => { load(); loadProvider(); }, []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };
  useEffect(() => () => stopPolling(), []);

  const resetCashier = () => {
    stopPolling();
    setCashierOrder(null); setQr(null); setPayError(""); setChannel("wechat");
  };

  const onPaid = async () => {
    stopPolling();
    setPaidFlash(true);
    setTimeout(() => setPaidFlash(false), 3000);
    resetCashier();
    setConfirmItem(null);
    await Promise.all([load(), refresh()]);
  };

  /** 创建订单并发起收银台支付 */
  const buy = async () => {
    if (!confirmItem) return;
    setBusy(true); setMsg(""); setPayError("");
    try {
      const order = await api<Order>("POST", "/api/orders", { product_code: confirmItem.code });
      await startCheckout(order);
    } catch (e: any) {
      setPayError(e.message);
    } finally {
      setBusy(false);
    }
  };

  /** 对已有待支付订单发起收银台支付 */
  const payOrder = async (o: Order) => {
    setBusy(true); setPayError("");
    try {
      await startCheckout(o);
    } catch (e: any) {
      setPayError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startCheckout = async (order: Order) => {
    setCashierOrder(order);
    const r = await api<{ type: string; url?: string; code_url?: string }>(
      "POST", `/api/orders/${order.id}/checkout`, { channel });
    if (r.type === "paid") return onPaid();
    if (r.type === "qrcode_static" && r.code_url) {
      // 站长个人收款码：直接展示静态图片，无需生成
      setQr(r.code_url);
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const cur = await api<Order>("GET", `/api/orders/${order.id}`);
          if (cur.status === "paid") await onPaid();
          if (cur.status === "cancelled") { stopPolling(); setPayError("订单已取消"); setQr(null); }
        } catch { /* 网络抖动忽略，下一轮再查 */ }
      }, 2500);
    }
  };

  /** 保存前测试 Key 可用性：用表单当前值（Key 留空则沿用已保存的） */
  const testProvider = async () => {
    setTestMsg(null);
    setTestBusy(true);
    try {
      const r = await api<{ ok: boolean; latency_ms: number }>("POST", "/api/my-provider/test", {
        base_url: pf.base_url || undefined,
        api_key: pf.api_key || undefined,
        model: pf.model || undefined,
      });
      setTestMsg({ ok: true, text: `连接成功 · 延迟 ${r.latency_ms}ms` });
    } catch (e: any) {
      setTestMsg({ ok: false, text: e.message });
    } finally {
      setTestBusy(false);
    }
  };

  // 输入后自动检测：Key / 地址 / 模型任一变化，防抖 900ms 自动验证一次
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoState, setAutoState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [autoText, setAutoText] = useState("");
  useEffect(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    const key = pf.api_key.trim();
    if (key.length < 8 || !pf.base_url.trim()) { setAutoState("idle"); setAutoText(""); return; }
    autoTimer.current = setTimeout(async () => {
      setAutoState("testing");
      setAutoText("正在自动检测 Key 可用性…");
      try {
        const r = await api<{ ok: boolean; latency_ms: number }>("POST", "/api/my-provider/test", {
          base_url: pf.base_url || undefined,
          api_key: pf.api_key || undefined,
          model: pf.model || undefined,
        });
        setAutoState("ok");
        setAutoText(`Key 可用 · 延迟 ${r.latency_ms}ms`);
      } catch (e: any) {
        setAutoState("fail");
        setAutoText(e.message);
      }
    }, 900);
    return () => { if (autoTimer.current) clearTimeout(autoTimer.current); };
  }, [pf.api_key, pf.base_url, pf.model]);

  const saveProvider = async () => {
    setPfMsg("");
    try {
      await api("PUT", "/api/my-provider", {
        base_url: pf.base_url,
        api_key: pf.api_key || undefined,
        model: pf.model,
        temperature: Number(pf.temperature),
        max_tokens: Number(pf.max_tokens),
        enabled: pf.enabled,
      });
      setPf((f) => ({ ...f, api_key: "" }));
      setPfMsg("已保存。Key 加密存储在服务端，页面不回显明文。");
      await Promise.all([loadProvider(), load(), refresh()]);
    } catch (e: any) {
      setPfMsg(e.message);
    }
  };

  const removeProvider = async () => {
    await api("DELETE", "/api/my-provider");
    setPf((f) => ({ ...f, api_key: "" }));
    setPfMsg("已移除自有 API 配置。");
    await Promise.all([loadProvider(), load(), refresh()]);
  };

  const b = catalog?.balance;
  const statusBadge = (s: string) =>
    s === "paid" ? <Badge className="bg-emerald-600">已支付</Badge>
    : s === "cancelled" ? <Badge variant="secondary">已取消</Badge>
    : <Badge className="bg-amber-600">待支付</Badge>;

  const planCard = (p: CatalogItem, i: number) => {
    const isCurrent = b?.plan === p.code;
    const per = p.chapters > 0 && p.price_cents > 0 ? `折合 ¥${(p.price_cents / 100 / p.chapters).toFixed(2)}/章` : "";
    return (
      <SpotlightCard key={p.code}
        className={`rounded-2xl border bg-zinc-900/60 flex flex-col h-full transition-all duration-300 ease-fluid hover:-translate-y-0.5 animate-rise ${
          isCurrent ? "border-amber-500/50" : "border-white/[0.06] hover:border-amber-500/25"
        }`} style={{ "--i": i } as React.CSSProperties}>
        <div className="p-6 flex flex-col flex-1">
          <div className="flex items-center justify-between mb-1">
            <p className="flex items-center gap-2 font-semibold tracking-tight">
              {p.code === "free" ? <Zap className="w-4 h-4 text-zinc-500" strokeWidth={1.75} /> : <Crown className="w-4 h-4 text-amber-400" strokeWidth={1.75} />}
              {p.name}
            </p>
            {isCurrent && <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20">当前套餐</Badge>}
          </div>
          <p className="text-xs text-zinc-500 mb-5">{p.tagline}</p>
          <p className="text-3xl font-semibold tnum tracking-tight text-amber-300 mb-1">
            {fmt(p.price_cents)}<span className="text-sm font-normal text-zinc-500"> /月</span>
          </p>
          <p className="text-xs text-zinc-500 mb-5 tnum">每月 {p.chapters} 章{per && <span> · {per}</span>}</p>
          <ul className="space-y-2.5 text-sm text-zinc-300 flex-1">
            {p.features.map((f) => (
              <li key={f} className="flex gap-2.5 leading-relaxed"><CheckCircle2 className="w-4 h-4 text-emerald-500/80 shrink-0 mt-0.5" strokeWidth={1.75} />{f}</li>
            ))}
          </ul>
          <Button
            className={isCurrent
              ? "bg-zinc-800/80 text-zinc-400 mt-5 pointer-events-none"
              : "bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold mt-5"}
            disabled={isCurrent || busy}
            onClick={() => setConfirmItem(p)}
          >
            {isCurrent ? "当前套餐" : p.price_cents === 0 ? "切换到免费版" : `订阅 ${fmt(p.price_cents)}/月`}
          </Button>
        </div>
      </SpotlightCard>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100 ink-bg">
      <div className="ink-grain" aria-hidden />
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-zinc-950/75 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-4">
          <Link to="/"><Button variant="ghost" size="sm" className="text-zinc-500 hover:text-zinc-200"><ArrowLeft className="w-4 h-4 mr-1" />返回</Button></Link>
          <h1 className="font-bold tracking-[0.15em]">额度中心</h1>
          <span className="text-sm text-zinc-600">{user?.username}</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* 余额总览：液态玻璃面板（taste: Liquid Glass） */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "当前套餐", value: <span className="text-amber-300">{b?.plan_name ?? "—"}</span>, sub: b?.plan_reset_at ? `${fmtDate(b.plan_reset_at)} 重置` : "" },
            { label: "本月额度", value: <><span className="tnum">{b ? Math.max(0, b.plan_chapters - b.used_chapters) : "—"}</span> <span className="text-sm font-normal text-zinc-500">/ {b?.plan_chapters ?? "—"} 章</span></>, sub: `已用 ${b?.used_chapters ?? 0} 章` },
            { label: "加油包余额", value: <span className="tnum">{b?.extra_chapters ?? 0}</span>, sub: "永久有效，套餐用完后自动抵扣" },
            { label: "自有 API（BYOK）", value: b?.byok ? <span className="text-emerald-400">已启用</span> : <span className="text-zinc-500">未配置</span>, sub: b?.byok ? "生成不消耗章节额度" : "配置后生成走自己的 Key" },
          ].map((c, i) => (
            <div key={c.label} className="rounded-2xl glass-edge bg-zinc-900/60 backdrop-blur px-5 py-4 animate-rise" style={{ "--i": i } as React.CSSProperties}>
              <p className="text-[11px] tracking-wider text-zinc-500 uppercase">{c.label}</p>
              <p className="text-xl font-semibold tnum tracking-tight mt-1.5">{c.value}</p>
              <p className="text-xs text-zinc-600 mt-1">{c.sub}</p>
            </div>
          ))}
        </div>

        {msg && <p className="text-sm text-red-400">{msg}</p>}

        <Tabs defaultValue={defaultTab} key={defaultTab}>
          <TabsList className="bg-zinc-900 border border-zinc-800">
            <TabsTrigger value="plans"><Crown className="w-4 h-4 mr-1" />订阅套餐</TabsTrigger>
            <TabsTrigger value="packs"><Coins className="w-4 h-4 mr-1" />加油包</TabsTrigger>
            <TabsTrigger value="orders"><Receipt className="w-4 h-4 mr-1" />我的订单</TabsTrigger>
            <TabsTrigger value="byok"><KeyRound className="w-4 h-4 mr-1" />自有 API</TabsTrigger>
          </TabsList>

          {/* ---------- 订阅套餐 ---------- */}
          <TabsContent value="plans" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {catalog?.plans.map((p, i) => planCard(p, i))}
            </div>
            <p className="text-xs text-zinc-500 mt-4">
              订阅额度当月有效、每月按订阅日自动重置；加油包额度永久有效，套餐额度用完后自动抵扣加油包。
            </p>
          </TabsContent>

          {/* ---------- 加油包 ---------- */}
          <TabsContent value="packs" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {catalog?.packs.map((p, i) => (
                <SpotlightCard key={p.code}
                  className="rounded-2xl border border-white/[0.06] bg-zinc-900/60 h-full transition-all duration-300 ease-fluid hover:-translate-y-0.5 hover:border-amber-500/25 animate-rise"
                  style={{ "--i": i } as React.CSSProperties}>
                  <div className="p-6 flex flex-col h-full">
                    <p className="flex items-center gap-2 font-semibold tracking-tight mb-1">
                      <Coins className="w-4 h-4 text-amber-400" strokeWidth={1.75} />{p.name}
                    </p>
                    <p className="text-xs text-zinc-500 mb-5">{p.tagline}</p>
                    <p className="text-3xl font-semibold tnum tracking-tight text-amber-300 mb-1">{fmt(p.price_cents)}</p>
                    <p className="text-xs text-zinc-500 flex-1 tnum">{p.chapters} 章额度 · 永久有效 · 不限购买次数</p>
                    <Button className="bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-[0.97] transition-all duration-300 ease-fluid font-semibold mt-5" disabled={busy} onClick={() => setConfirmItem(p)}>
                      购买
                    </Button>
                  </div>
                </SpotlightCard>
              ))}
            </div>
          </TabsContent>

          {/* ---------- 我的订单 ---------- */}
          <TabsContent value="orders" className="mt-6">
            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardContent className="pt-6">
                {orders.length === 0 ? (
                  <p className="text-sm text-zinc-500">暂无订单</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800">
                        <TableHead>订单号</TableHead><TableHead>商品</TableHead><TableHead>金额</TableHead>
                        <TableHead>额度</TableHead><TableHead>状态</TableHead><TableHead>创建时间</TableHead><TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((o) => (
                        <TableRow key={o.id} className="border-zinc-800">
                          <TableCell className="text-zinc-500">#{o.id}</TableCell>
                          <TableCell className="font-medium">{o.title}</TableCell>
                          <TableCell>{fmt(o.amount_cents)}</TableCell>
                          <TableCell>{o.kind === "plan" ? `订阅 · ${o.chapters} 章/月` : `+${o.chapters} 章`}</TableCell>
                          <TableCell>{statusBadge(o.status)}</TableCell>
                          <TableCell className="text-zinc-500 text-sm">{o.created_at}</TableCell>
                          <TableCell>
                            {o.status === "pending" && (
                              <Button size="sm" variant="outline" className="border-amber-600 text-amber-400 hover:bg-amber-600/10" disabled={busy} onClick={() => payOrder(o)}>
                                去支付
                              </Button>
                            )}
                            {o.status === "paid" && o.paid_at && <span className="text-xs text-zinc-500">{o.paid_at}</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------- 自有 API（BYOK） ---------- */}
          <TabsContent value="byok" className="mt-6">
            <Card className="bg-zinc-900/60 border-zinc-800 max-w-3xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  自带模型 API Key
                  {provider?.configured
                    ? <Badge className={provider.enabled ? "bg-emerald-600" : "bg-zinc-600"}>{provider.enabled ? "已启用" : "已停用"}</Badge>
                    : <Badge variant="secondary">未配置</Badge>}
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  填入你自己的 OpenAI 兼容接口（Kimi / DeepSeek / 通义 / OpenAI 等），生成将走你的 Key——
                  <span className="text-amber-300">不消耗平台章节额度</span>，仅保留同时 2 个工程的并发限制；用量照常记录便于你核对。
                  {provider?.configured && <> 当前 Key：<code className="text-amber-300">{provider.key_preview}</code>（掩码），更新于 {provider.updated_at}</>}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label>选择服务商（自动填入接口地址与推荐模型）</Label>
                    <ProviderPresetSelect
                      baseUrl={pf.base_url}
                      onPick={(preset) =>
                        setPf((f) => ({ ...f, base_url: preset.base_url, model: preset.model }))
                      }
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>API Base URL</Label>
                    <Input value={pf.base_url} onChange={(e) => setPf({ ...pf, base_url: e.target.value })} className="bg-zinc-950 border-zinc-700" />
                    <p className="text-xs text-zinc-500">以上选择服务商后自动填入；自定义或微调可直接修改</p>
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>API Key{provider?.configured && "（留空则保持原 Key 不变）"}</Label>
                    <Input type="password" placeholder={provider?.configured ? "已保存，输入以更换" : "sk-xxxxxxxx"} value={pf.api_key} onChange={(e) => setPf({ ...pf, api_key: e.target.value })} className="bg-zinc-950 border-zinc-700" />
                    {autoState !== "idle" && (
                      <p className={`text-xs flex items-center gap-1.5 ${
                        autoState === "testing" ? "text-zinc-400"
                        : autoState === "ok" ? "text-emerald-400"
                        : "text-red-400"}`}>
                        {autoState === "testing" && <Loader2 className="w-3 h-3 animate-spin" />}
                        {autoState === "ok" && <span>✓</span>}
                        {autoState === "fail" && <span>✕</span>}
                        {autoState === "testing" ? "自动检测中…" : autoText}
                      </p>
                    )}
                    {presetKeyForBaseUrl(pf.base_url) !== "custom" && (
                      <p className="text-xs text-zinc-500">
                        Key 获取位置：{PROVIDER_PRESETS.find((p) => p.base_url === pf.base_url.trim())?.key_hint}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>模型</Label>
                    <Input value={pf.model} onChange={(e) => setPf({ ...pf, model: e.target.value })} className="bg-zinc-950 border-zinc-700" placeholder="kimi-k3" />
                  </div>
                  <div className="space-y-2">
                    <Label>max_tokens</Label>
                    <Input type="number" value={pf.max_tokens} onChange={(e) => setPf({ ...pf, max_tokens: Number(e.target.value) })} className="bg-zinc-950 border-zinc-700" />
                  </div>
                  <div className="space-y-2">
                    <Label>temperature</Label>
                    <Input type="number" step="0.1" value={pf.temperature} onChange={(e) => setPf({ ...pf, temperature: Number(e.target.value) })} className="bg-zinc-950 border-zinc-700" />
                  </div>
                  <div className="space-y-2 flex items-end pb-2">
                    <div className="flex items-center gap-2">
                      <Switch checked={pf.enabled} onCheckedChange={(v) => setPf({ ...pf, enabled: v })} />
                      <span className="text-sm text-zinc-400">启用（关闭则回退到平台默认模型）</span>
                    </div>
                  </div>
                </div>
                {pfMsg && <p className="text-sm text-amber-300">{pfMsg}</p>}
                {testMsg && (
                  <p className={`text-sm border rounded-lg px-3 py-2 ${testMsg.ok
                    ? "text-emerald-300 border-emerald-800/60 bg-emerald-950/30"
                    : "text-red-400 border-red-900/50 bg-red-950/40"}`}>
                    {testMsg.ok ? "✅ " : "❌ "}{testMsg.text}
                  </p>
                )}
                <div className="flex gap-3">
                  <Button className="bg-amber-500 text-zinc-950 hover:bg-amber-400" onClick={saveProvider}>
                    <Save className="w-4 h-4 mr-1" />保存配置
                  </Button>
                  <Button
                    variant="outline"
                    className="border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100"
                    disabled={testBusy}
                    onClick={testProvider}
                    title="用当前填写的配置发起一次最小调用，验证 Key 真实可用"
                  >
                    {testBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Zap className="w-4 h-4 mr-1" />}
                    {testBusy ? "测试中…" : "测试连接"}
                  </Button>
                  {provider?.configured && (
                    <Button variant="outline" className="border-red-800 text-red-400 hover:bg-red-900/20" onClick={removeProvider}>
                      <Trash2 className="w-4 h-4 mr-1" />移除配置
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* 收银台弹窗：订单确认 → 通道选择 → 二维码/跳转 */}
      <Dialog
        open={!!confirmItem || !!cashierOrder}
        onOpenChange={(v) => { if (!v) { setConfirmItem(null); resetCashier(); } }}
      >
        <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{qr ? "扫码支付" : "确认订单"}</DialogTitle>
            <DialogDescription className="text-zinc-400">
              {confirmItem && !cashierOrder && (
                <>
                  {confirmItem.name} — {fmt(confirmItem.price_cents)}
                  {confirmItem.months ? ` / ${confirmItem.months} 个月` : ""}
                  ，含 {confirmItem.chapters} 章{confirmItem.months ? "/月" : ""} 生成额度。
                </>
              )}
              {cashierOrder && `订单 #${cashierOrder.id} ｜ ${cashierOrder.title} ｜ ${fmt(cashierOrder.amount_cents)}`}
            </DialogDescription>
          </DialogHeader>

          {qr ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <img src={qr} alt="收款二维码" className="rounded-lg bg-white p-2 w-60" />
              <p className="text-sm text-zinc-300">
                请使用{channel === "wechat" ? "微信" : "支付宝"}「扫一扫」支付
                <span className="text-amber-400 font-medium"> {cashierOrder ? fmt(cashierOrder.amount_cents) : ""}</span>
              </p>
              <p className="text-xs text-zinc-500">
                付款时备注订单号 #{cashierOrder?.id}，付款完成后管理员核实即自动到账
              </p>
              <p className="text-xs text-zinc-500 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> 等待到账确认，本页会自动刷新…
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>支付方式</Label>
                {([
                  { key: "wechat", icon: <Smartphone className="w-4 h-4" />, name: "微信支付", desc: "展示站长收款二维码，微信扫码付款" },
                  { key: "alipay", icon: <MonitorSmartphone className="w-4 h-4" />, name: "支付宝", desc: "展示站长收款二维码，支付宝扫码付款" },
                ] as const).map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setChannel(c.key)}
                    className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                      channel === c.key ? "border-amber-500 bg-amber-500/10" : "border-zinc-700 hover:border-zinc-500"
                    }`}
                  >
                    <span className={channel === c.key ? "text-amber-400" : "text-zinc-500"}>{c.icon}</span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{c.name}</span>
                      <span className="block text-xs text-zinc-500">{c.desc}</span>
                    </span>
                    {channel === c.key && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-500">
                扫码付款后由管理员核实到账并发放额度，通常几分钟内完成；如需加急请联系站长。
              </p>
              {payError && <p className="text-sm text-red-400">{payError}</p>}
            </>
          )}

          <DialogFooter>
            {!qr && (
              <>
                <Button variant="ghost" onClick={() => { setConfirmItem(null); resetCashier(); }}>取消</Button>
                <Button className="bg-amber-500 text-zinc-950 hover:bg-amber-400" disabled={busy} onClick={buy}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  去支付
                </Button>
              </>
            )}
            {qr && (
              <Button variant="ghost" onClick={() => { resetCashier(); setConfirmItem(null); }}>取消支付</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {paidFlash && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-emerald-700 bg-emerald-900/90 px-4 py-3 text-sm flex items-center gap-2 shadow-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> 支付成功，额度已到账
        </div>
      )}
    </div>
  );
}
