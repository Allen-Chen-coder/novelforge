import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, KeyRound, Users, BarChart3, Save, Receipt, Ban, Network, Ticket, CheckCircle2 } from "lucide-react";
import { ProviderPresetSelect } from "@/components/ProviderPresetSelect";

interface ProviderCfg {
  configured: boolean;
  base_url?: string; model?: string; temperature?: number; max_tokens?: number;
  updated_at?: string; key_preview?: string;
}
interface AdminUser {
  id: number; username: string; is_admin: boolean; enabled: boolean;
  quota_chapters: number; used_chapters: number;
  plan: string; plan_chapters: number; extra_chapters: number;
  projects: number; tokens: number; created_at: string;
}
interface AdminOrder {
  id: number; username: string; kind: string; product_code: string; title: string;
  amount_cents: number; status: string; chapters: number; created_at: string; paid_at: string | null;
}
interface Usage {
  totals: { users: number; projects: number; chapters: number; prompt_tokens: number; completion_tokens: number; calls: number; cost: number };
  by_model: { model: string; calls: number; prompt_tokens: number; completion_tokens: number; cost: number }[];
  per_user: { username: string; calls: number; prompt_tokens: number; completion_tokens: number; projects: number; cost: number }[];
  daily: { day: string; calls: number; tokens: number }[];
}
interface ModelRoute {
  role: string;
  configured?: boolean;
  base_url?: string; model?: string; temperature?: number; max_tokens?: number;
  enabled?: boolean; updated_at?: string; key_preview?: string;
}

const ROLE_LABELS: Record<string, string> = {
  planner: "策划（整书/续写大纲）",
  writer: "写作（正文初稿）",
  critic: "审校（评分+问题清单）",
  reviser: "修订（按意见改稿）",
  summarizer: "摘要（章节记忆回灌）",
  judge: "评审 RM（修订验收门）",
};

function RouteRow({ route, onSaved }: { route: ModelRoute; onSaved: () => void }) {
  const [form, setForm] = useState({
    base_url: route.base_url || "https://api.moonshot.cn/v1",
    model: route.model || "",
    api_key: "",
    temperature: route.temperature ?? 0.8,
    max_tokens: route.max_tokens ?? 8192,
  });
  const [enabled, setEnabled] = useState(route.enabled ?? false);
  const [msg, setMsg] = useState("");
  const configured = !!route.configured;

  const save = async () => {
    setMsg("");
    try {
      await api("PUT", "/api/admin/model-routes", {
        role: route.role,
        base_url: form.base_url,
        model: form.model,
        api_key: form.api_key || undefined,  // 留空保持原 Key
        temperature: Number(form.temperature),
        max_tokens: Number(form.max_tokens),
        enabled,
      });
      setForm((f) => ({ ...f, api_key: "" }));
      setMsg("已保存");
      onSaved();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">{ROLE_LABELS[route.role] || route.role}</span>
          <code className="text-xs text-zinc-500">{route.role}</code>
        </div>
        <div className="flex items-center gap-3">
          {configured && <span className="text-xs text-zinc-500">Key <code className="text-amber-300">{route.key_preview}</code> · {route.updated_at}</span>}
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <span className="text-xs text-zinc-500">{enabled ? "已启用" : "未启用"}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="space-y-1 col-span-2 md:col-span-5">
          <Label className="text-xs">选择服务商（自动填入接口地址与推荐模型）</Label>
          <ProviderPresetSelect
            baseUrl={form.base_url}
            onPick={(preset) => setForm((f) => ({ ...f, base_url: preset.base_url, model: preset.model }))}
          />
        </div>
        <div className="space-y-1 col-span-2">
          <Label className="text-xs">API Base URL</Label>
          <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} className="bg-zinc-950 border-zinc-700 h-8" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">模型</Label>
          <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="bg-zinc-950 border-zinc-700 h-8" placeholder="kimi-k3" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">temperature</Label>
          <Input type="number" step="0.1" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })} className="bg-zinc-950 border-zinc-700 h-8" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">max_tokens</Label>
          <Input type="number" value={form.max_tokens} onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })} className="bg-zinc-950 border-zinc-700 h-8" />
        </div>
        <div className="space-y-1 col-span-2">
          <Label className="text-xs">API Key{configured ? "（留空保持不变）" : "（首次必填）"}</Label>
          <Input type="password" placeholder={configured ? "已保存，输入以更换" : "sk-xxxxxxxx"} value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} className="bg-zinc-950 border-zinc-700 h-8" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" className="bg-amber-500 text-zinc-950 hover:bg-amber-400" onClick={save}>
          <Save className="w-3 h-3 mr-1" />保存
        </Button>
        {msg && <span className="text-xs text-amber-300">{msg}</span>}
      </div>
    </div>
  );
}

interface InviteCode {
  code: string;
  used: boolean;
  used_by_name: string | null;
  used_by_phone: string | null;
  used_at: string | null;
  created_at: string;
}

function InvitePanel() {
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [count, setCount] = useState(5);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => setInvites(await api<InviteCode[]>("GET", "/api/admin/invites"));

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const generate = async () => {
    setMsg("");
    setBusy(true);
    try {
      const r = await api<{ codes: string[] }>("POST", "/api/admin/invites", { count });
      setMsg(`已生成 ${r.codes.length} 个内测码：${r.codes.join("  ")}`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
    } catch {
      setMsg("复制失败，请手动选择复制");
    }
  };

  const remove = async (code: string) => {
    setMsg("");
    try {
      await api("DELETE", `/api/admin/invites/${code}`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const unused = invites.filter((i) => !i.used).length;

  return (
    <Card className="bg-zinc-900/60 border-zinc-800">
      <CardHeader>
        <CardTitle>内测码管理</CardTitle>
        <CardDescription className="text-zinc-400">
          内测期注册门槛：用户注册必须持有效 6 位内测码，一码一人、注册即作废。
          共 {invites.length} 个码，未使用 {unused} 个。把码发给受邀用户即可。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="space-y-2">
            <Label>生成数量</Label>
            <Input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              className="w-28 bg-zinc-950 border-zinc-700 h-9"
            />
          </div>
          <Button className="bg-amber-500 text-zinc-950 hover:bg-amber-400" disabled={busy} onClick={generate}>
            <Ticket className="w-4 h-4 mr-1" />{busy ? "生成中…" : "生成内测码"}
          </Button>
        </div>
        {msg && <p className="text-sm text-amber-300">{msg}</p>}
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800">
              <TableHead>内测码</TableHead><TableHead>状态</TableHead><TableHead>使用人</TableHead>
              <TableHead>使用时间</TableHead><TableHead>创建时间</TableHead><TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.map((i) => (
              <TableRow key={i.code} className="border-zinc-800">
                <TableCell>
                  <code className="text-amber-300 tracking-widest">{i.code}</code>
                </TableCell>
                <TableCell>
                  {i.used
                    ? <Badge variant="secondary" className="bg-zinc-700">已使用</Badge>
                    : <Badge className="bg-emerald-600">未使用</Badge>}
                </TableCell>
                <TableCell className="text-zinc-400">
                  {i.used ? `${i.used_by_name || "—"}${i.used_by_phone ? `（${i.used_by_phone}）` : ""}` : "—"}
                </TableCell>
                <TableCell className="text-zinc-500 tnum">{i.used_at || "—"}</TableCell>
                <TableCell className="text-zinc-500 tnum">{i.created_at}</TableCell>
                <TableCell className="text-right space-x-2">
                  {!i.used && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 border-zinc-700 text-zinc-300 hover:bg-zinc-800" onClick={() => copy(i.code)}>
                        {copied === i.code ? "已复制" : "复制"}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 border-red-900/60 text-red-400 hover:bg-red-950/50" onClick={() => remove(i.code)}>
                        <Ban className="w-3 h-3 mr-1" />删除
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {invites.length === 0 && (
              <TableRow className="border-zinc-800">
                <TableCell colSpan={6} className="text-center text-zinc-500 py-8">还没有内测码，点击上方「生成内测码」创建第一批</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const [provider, setProvider] = useState<ProviderCfg | null>(null);
  const [form, setForm] = useState({ base_url: "https://api.moonshot.cn/v1", api_key: "", model: "kimi-k3", temperature: 0.8, max_tokens: 8192 });
  const [msg, setMsg] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [routes, setRoutes] = useState<ModelRoute[]>([]);

  const loadProvider = async () => {
    const p = await api<ProviderCfg>("GET", "/api/admin/provider");
    setProvider(p);
    if (p.configured) {
      setForm((f) => ({ ...f, base_url: p.base_url!, model: p.model!, temperature: p.temperature!, max_tokens: p.max_tokens! }));
    }
  };
  const loadUsers = async () => setUsers(await api<AdminUser[]>("GET", "/api/admin/users"));
  const loadUsage = async () => setUsage(await api<Usage>("GET", "/api/admin/usage"));
  const loadOrders = async () => setOrders(await api<AdminOrder[]>("GET", "/api/admin/orders"));
  const loadRoutes = async () => setRoutes(await api<ModelRoute[]>("GET", "/api/admin/model-routes"));

  useEffect(() => {
    loadProvider(); loadUsers(); loadUsage(); loadOrders(); loadRoutes();
    const t = setInterval(() => { loadUsers(); loadUsage(); loadOrders(); }, 8000);
    return () => clearInterval(t);
  }, []);

  const saveProvider = async () => {
    setMsg("");
    try {
      await api("PUT", "/api/admin/provider", {
        base_url: form.base_url,
        api_key: form.api_key || undefined,  // 留空表示保持原 Key
        model: form.model,
        temperature: Number(form.temperature),
        max_tokens: Number(form.max_tokens),
      });
      setMsg("已保存。Key 仅保存在服务端，不会回显明文。");
      setForm((f) => ({ ...f, api_key: "" }));
      await loadProvider();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const patchUser = async (uid: number, body: any) => {
    await api("PATCH", `/api/admin/users/${uid}`, body);
    await loadUsers();
  };

  const cancelOrder = async (oid: number) => {
    await api("POST", `/api/admin/orders/${oid}/cancel`);
    await loadOrders();
  };

  const confirmOrder = async (oid: number) => {
    await api("POST", `/api/admin/orders/${oid}/confirm`);
    await Promise.all([loadOrders(), loadUsers()]);
  };

  const maxDaily = Math.max(1, ...(usage?.daily.map((d) => d.tokens) || [1]));

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100 ink-bg">
      <div className="ink-grain" aria-hidden />
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-zinc-950/75 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-4">
          <Link to="/"><Button variant="ghost" size="sm" className="text-zinc-500 hover:text-zinc-200"><ArrowLeft className="w-4 h-4 mr-1" />返回</Button></Link>
          <h1 className="font-bold tracking-[0.15em]">管理后台</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <Tabs defaultValue="provider">
          <TabsList className="bg-zinc-900 border border-zinc-800">
            <TabsTrigger value="provider"><KeyRound className="w-4 h-4 mr-1" />服务商配置</TabsTrigger>
            <TabsTrigger value="routes"><Network className="w-4 h-4 mr-1" />模型路由</TabsTrigger>
            <TabsTrigger value="users"><Users className="w-4 h-4 mr-1" />用户管理</TabsTrigger>
            <TabsTrigger value="invites"><Ticket className="w-4 h-4 mr-1" />内测码</TabsTrigger>
            <TabsTrigger value="orders"><Receipt className="w-4 h-4 mr-1" />订单管理</TabsTrigger>
            <TabsTrigger value="usage"><BarChart3 className="w-4 h-4 mr-1" />用量监控</TabsTrigger>
          </TabsList>

          {/* ---------- 服务商配置 ---------- */}
          <TabsContent value="provider" className="mt-6">
            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  模型服务商（OpenAI 兼容接口）
                  {provider?.configured
                    ? <Badge className="bg-emerald-600">已配置</Badge>
                    : <Badge variant="destructive">未配置 —— 用户无法生成</Badge>}
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  你的 API Key 由平台统一保管（服务端加密存储），按调用量向模型商结算；用户不接触 Key。
                  {provider?.configured && <> 当前 Key：<code className="text-amber-300">{provider.key_preview}</code>（掩码），更新于 {provider.updated_at}</>}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 max-w-2xl">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label>选择服务商（自动填入接口地址与推荐模型）</Label>
                    <ProviderPresetSelect
                      baseUrl={form.base_url}
                      onPick={(preset) => setForm((f) => ({ ...f, base_url: preset.base_url, model: preset.model }))}
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>API Base URL</Label>
                    <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} className="bg-zinc-950 border-zinc-700" />
                    <p className="text-xs text-zinc-500">选择服务商后自动填入；自定义或微调可直接修改</p>
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>API Key（留空则保持原 Key 不变）</Label>
                    <Input type="password" placeholder={provider?.configured ? "已保存，输入以更换" : "sk-xxxxxxxx"} value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} className="bg-zinc-950 border-zinc-700" />
                  </div>
                  <div className="space-y-2">
                    <Label>模型</Label>
                    <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="bg-zinc-950 border-zinc-700" placeholder="kimi-k3" />
                  </div>
                  <div className="space-y-2">
                    <Label>max_tokens</Label>
                    <Input type="number" value={form.max_tokens} onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })} className="bg-zinc-950 border-zinc-700" />
                  </div>
                  <div className="space-y-2">
                    <Label>temperature</Label>
                    <Input type="number" step="0.1" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })} className="bg-zinc-950 border-zinc-700" />
                  </div>
                </div>
                {msg && <p className="text-sm text-amber-300">{msg}</p>}
                <Button className="bg-amber-500 text-zinc-950 hover:bg-amber-400" onClick={saveProvider}>
                  <Save className="w-4 h-4 mr-1" />保存配置
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------- 模型路由 ---------- */}
          <TabsContent value="routes" className="mt-6">
            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader>
                <CardTitle>模型路由（按流水线角色指定模型）</CardTitle>
                <CardDescription className="text-zinc-400">
                  写作、审校、修订等环节可用不同模型（如写作用 GLM-5.3、改稿用 GLM-5.3-Flash 控成本），实现「按章节类型选模型」。
                  未启用的角色回退到「服务商配置」里的默认模型；用户 BYOK 时同样生效。Key 服务端加密存储，不回显明文。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {routes.map((r) => (
                  <RouteRow key={`${r.role}-${r.updated_at || ""}`} route={r} onSaved={loadRoutes} />
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------- 用户管理 ---------- */}
          <TabsContent value="users" className="mt-6">
            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader>
                <CardTitle>用户管理</CardTitle>
                <CardDescription className="text-zinc-400">启用/停用账号；「加油包余额」可直接手动调整（如线下收款赠送）。订阅套餐由用户在「额度中心」自助购买。</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800">
                      <TableHead>用户名</TableHead><TableHead>角色</TableHead><TableHead>状态</TableHead>
                      <TableHead>套餐 / 本月用量</TableHead><TableHead>加油包余额</TableHead><TableHead>工程数</TableHead><TableHead>Token 消耗</TableHead><TableHead>注册时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id} className="border-zinc-800">
                        <TableCell className="font-medium">{u.username}</TableCell>
                        <TableCell>{u.is_admin ? <Badge className="bg-amber-600">管理员</Badge> : "用户"}</TableCell>
                        <TableCell>
                          <Switch checked={u.enabled} disabled={u.is_admin} onCheckedChange={(v) => patchUser(u.id, { enabled: v })} />
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="mr-2">{u.plan}</Badge>
                          {u.used_chapters} / {u.plan_chapters} 章
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="w-24 h-8 bg-zinc-950 border-zinc-700"
                            defaultValue={u.extra_chapters}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (v !== u.extra_chapters) patchUser(u.id, { extra_chapters: v });
                            }}
                          />
                        </TableCell>
                        <TableCell>{u.projects}</TableCell>
                        <TableCell>{u.tokens.toLocaleString()}</TableCell>
                        <TableCell className="text-zinc-500 text-sm">{u.created_at}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------- 内测码 ---------- */}
          <TabsContent value="invites" className="mt-6">
            <InvitePanel />
          </TabsContent>

          {/* ---------- 订单管理 ---------- */}
          <TabsContent value="orders" className="mt-6">
            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader>
                <CardTitle>订单管理</CardTitle>
                <CardDescription className="text-zinc-400">全部用户的订阅与加油包订单。用户扫码付款到站长个人收款码后，在此核实收款并点「确认到账」，额度自动发放。</CardDescription>
              </CardHeader>
              <CardContent>
                {orders.length === 0 ? (
                  <p className="text-sm text-zinc-500">暂无订单</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800">
                        <TableHead>订单号</TableHead><TableHead>用户</TableHead><TableHead>商品</TableHead>
                        <TableHead>金额</TableHead><TableHead>额度</TableHead><TableHead>状态</TableHead>
                        <TableHead>创建时间</TableHead><TableHead>支付时间</TableHead><TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((o) => (
                        <TableRow key={o.id} className="border-zinc-800">
                          <TableCell className="text-zinc-500">#{o.id}</TableCell>
                          <TableCell className="font-medium">{o.username}</TableCell>
                          <TableCell>{o.title}</TableCell>
                          <TableCell>¥{(o.amount_cents / 100).toFixed(0)}</TableCell>
                          <TableCell>{o.kind === "plan" ? `订阅 · ${o.chapters} 章/月` : `+${o.chapters} 章`}</TableCell>
                          <TableCell>
                            {o.status === "paid" ? <Badge className="bg-emerald-600">已支付</Badge>
                              : o.status === "cancelled" ? <Badge variant="secondary">已取消</Badge>
                              : <Badge className="bg-amber-600">待支付</Badge>}
                          </TableCell>
                          <TableCell className="text-zinc-500 text-sm">{o.created_at}</TableCell>
                          <TableCell className="text-zinc-500 text-sm">{o.paid_at ?? "—"}</TableCell>
                          <TableCell>
                            {o.status === "pending" && (
                              <div className="flex gap-2">
                                <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => confirmOrder(o.id)}>
                                  <CheckCircle2 className="w-3 h-3 mr-1" />确认到账
                                </Button>
                                <Button size="sm" variant="outline" className="border-red-800 text-red-400 hover:bg-red-900/20" onClick={() => cancelOrder(o.id)}>
                                  <Ban className="w-3 h-3 mr-1" />取消
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------- 用量监控 ---------- */}
          <TabsContent value="usage" className="mt-6 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {usage && [
                { label: "注册用户", value: usage.totals.users },
                { label: "工程总数", value: usage.totals.projects },
                { label: "生成章节", value: usage.totals.chapters },
                { label: "API 调用次数", value: usage.totals.calls },
                { label: "Token 总量", value: (usage.totals.prompt_tokens + usage.totals.completion_tokens).toLocaleString() },
                { label: "模型成本（估算）", value: `¥${usage.totals.cost.toFixed(2)}` },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl glass-edge bg-zinc-900/60 backdrop-blur px-5 py-4">
                  <p className="text-2xl font-semibold tnum tracking-tight text-amber-300">{s.value}</p>
                  <p className="text-xs text-zinc-500 mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader>
                <CardTitle>按模型统计（成本核算）</CardTitle>
                <CardDescription className="text-zinc-400">
                  按常见模型官方单价估算（元 / 1M tokens，未命中按 ¥4/¥16 默认价）；价格随官方调整，请在后端 _MODEL_PRICES 维护。
                </CardDescription>
              </CardHeader>
              <CardContent>
                {usage && usage.by_model.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800">
                        <TableHead>模型</TableHead><TableHead>调用次数</TableHead><TableHead>Prompt Tokens</TableHead>
                        <TableHead>Completion Tokens</TableHead><TableHead>成本</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usage.by_model.map((r) => (
                        <TableRow key={r.model} className="border-zinc-800">
                          <TableCell className="font-medium">{r.model}</TableCell>
                          <TableCell className="tnum">{r.calls}</TableCell>
                          <TableCell className="tnum">{r.prompt_tokens.toLocaleString()}</TableCell>
                          <TableCell className="tnum">{r.completion_tokens.toLocaleString()}</TableCell>
                          <TableCell className="tnum text-amber-300">¥{r.cost.toFixed(3)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-sm text-zinc-500">暂无用量数据（配置真实模型后自动记录）</p>}
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader>
                <CardTitle>近 30 天每日消耗</CardTitle>
                <CardDescription className="text-zinc-400">Token 消耗量（prompt + completion）</CardDescription>
              </CardHeader>
              <CardContent>
                {usage && usage.daily.length > 0 ? (
                  <div className="flex items-end gap-1 h-40">
                    {usage.daily.map((d) => (
                      <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${d.tokens.toLocaleString()} tokens, ${d.calls} 次调用`}>
                        <div className="w-full bg-amber-500/80 rounded-t" style={{ height: `${(d.tokens / maxDaily) * 100}%` }} />
                        <span className="text-[10px] text-zinc-500 rotate-0">{d.day.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-zinc-500">暂无用量数据（配置真实模型后自动记录）</p>}
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader>
                <CardTitle>按用户统计</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800">
                      <TableHead>用户</TableHead><TableHead>调用次数</TableHead><TableHead>Prompt Tokens</TableHead>
                      <TableHead>Completion Tokens</TableHead><TableHead>工程数</TableHead><TableHead>成本</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usage?.per_user.map((r) => (
                      <TableRow key={r.username} className="border-zinc-800">
                        <TableCell className="font-medium">{r.username}</TableCell>
                        <TableCell>{r.calls}</TableCell>
                        <TableCell>{r.prompt_tokens.toLocaleString()}</TableCell>
                        <TableCell>{r.completion_tokens.toLocaleString()}</TableCell>
                        <TableCell>{r.projects}</TableCell>
                        <TableCell className="tnum text-amber-300">¥{r.cost.toFixed(3)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
