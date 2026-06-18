import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getAdminOverview,
  getAdminUsers,
  getSleepingUsers,
  exportSleepingCsv,
  sendTelegramBroadcast,
} from "@/lib/admin.functions";
import { loadUser } from "@/lib/auth-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft,
  Download,
  Send,
  RefreshCw,
  TrendingUp,
  Users,
  Moon,
  Coins,
  Gift,
} from "lucide-react";
import { GlobalChrome } from "@/components/GlobalChrome";
import { AdminInbox } from "@/components/AdminInbox";


export const Route = createFileRoute("/insights")({
  head: () => ({ meta: [{ title: "Insights · Подари" }, { name: "robots", content: "noindex" }] }),
  component: InsightsPage,
});

type Overview = Awaited<ReturnType<typeof getAdminOverview>>;
type UsersResp = Awaited<ReturnType<typeof getAdminUsers>>;

function InsightsPage() {
  const navigate = useNavigate();
  const overviewFn = useServerFn(getAdminOverview);
  const usersFn = useServerFn(getAdminUsers);
  const sleepingFn = useServerFn(getSleepingUsers);
  const csvFn = useServerFn(exportSleepingCsv);
  const broadcastFn = useServerFn(sendTelegramBroadcast);

  const [authChecked, setAuthChecked] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UsersResp | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [onlySleeping, setOnlySleeping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadUser().then((u) => {
      if (!u) navigate({ to: "/" });
      else setAuthChecked(true);
    });
  }, [navigate]);

  const reload = async () => {
    setLoading(true);
    try {
      const [o, u] = await Promise.all([
        overviewFn({}),
        usersFn({ data: { page, pageSize: 50, search: search || undefined, onlySleeping } }),
      ]);
      setOverview(o);
      setUsers(u);
    } catch (e: any) {
      toast.error(e?.message?.includes("FORBIDDEN") ? "Нет доступа" : "Ошибка загрузки");
      if (e?.message?.includes("FORBIDDEN")) navigate({ to: "/", search: { tab: "profile" } as never });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authChecked) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, page, onlySleeping]);

  const handleSearch = () => { setPage(0); reload(); };

  const handleExport = async () => {
    try {
      const csv = await csvFn({});
      const blob = new Blob([csv as string], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sleeping_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error("Не удалось выгрузить");
    }
  };

  if (!authChecked) return <GlobalChrome><div className="min-h-[60dvh]" /></GlobalChrome>;

  return (
    <GlobalChrome>
    <div className="min-h-[100dvh] bg-[#0a0a0f] text-zinc-100">
      <style>{`
        .ins-card { background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; }
        .ins-tile { background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(236,72,153,0.05)); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; }
        .ins-row-sleep { background: rgba(239,68,68,0.06); }
        .ins-fade { animation: insFade .4s ease both; }
        @keyframes insFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div className="max-w-6xl mx-auto px-4 py-5">
        <header className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Link to="/" search={{ tab: "profile" } as never} className="text-zinc-400 hover:text-zinc-100">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-semibold">Insights</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={reload} disabled={loading} className="text-zinc-300 hover:text-white hover:bg-white/5">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </header>

        {/* KPI tiles */}
        {overview && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 ins-fade">
            <Kpi icon={<Coins className="w-4 h-4" />} label="Баллов в резерве" value={overview.economy.escrow.toFixed(2)} />
            <Kpi icon={<TrendingUp className="w-4 h-4" />} label="Эмиссия авансов" value={overview.economy.emission.toFixed(2)} />
            <Kpi icon={<Gift className="w-4 h-4" />} label="Подарков в ленте" value={overview.economy.availableGifts} />
            <Kpi icon={<Coins className="w-4 h-4" />} label="Ср. цена дара" value={overview.economy.avgGiftCost.toFixed(2)} />
            <Kpi icon={<Users className="w-4 h-4" />} label="DAU" value={overview.activity.dau} />
            <Kpi icon={<Users className="w-4 h-4" />} label="WAU" value={overview.activity.wau} />
            <Kpi icon={<TrendingUp className="w-4 h-4" />} label="Новые / 7д" value={overview.activity.newUsers7} />
            <Kpi icon={<TrendingUp className="w-4 h-4" />} label="Отменено / 7д" value={overview.economy.txCancelled7} />
          </section>
        )}

        {/* Sleeping widget */}
        {overview && (
          <section className="ins-card p-4 mb-5 ins-fade">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                  <Moon className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <div className="text-xs text-zinc-400">Спящие 3+ дней</div>
                  <div className="text-2xl font-semibold">{overview.activity.sleeping}</div>
                  <div className="text-xs text-zinc-500">из {overview.activity.totalUsers} всего</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleExport} className="border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10">
                  <Download className="w-4 h-4 mr-1" /> CSV
                </Button>
                <Button size="sm" onClick={() => setBroadcastOpen(true)} className="bg-indigo-500 hover:bg-indigo-400 text-white">
                  <Send className="w-4 h-4 mr-1" /> Пуш в Telegram
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* Funnel + sparkline */}
        {overview && (
          <section className="grid md:grid-cols-2 gap-3 mb-5 ins-fade">
            <div className="ins-card p-4">
              <div className="text-xs text-zinc-400 mb-3">Воронка</div>
              <FunnelRow label="Зарегистрировались" value={overview.funnel.registered} max={overview.funnel.registered} />
              <FunnelRow label="Опубликовали подарок" value={overview.funnel.posted} max={overview.funnel.registered} />
              <FunnelRow label="Получили подарок" value={overview.funnel.received} max={overview.funnel.registered} />
              <FunnelRow label="Подарили" value={overview.funnel.gifted} max={overview.funnel.registered} />
            </div>
            <div className="ins-card p-4">
              <div className="text-xs text-zinc-400 mb-3">Новые регистрации (14 дней)</div>
              <Sparkline points={overview.activity.sparkline} />
            </div>
          </section>
        )}

        {/* Tops */}
        {overview && (
          <section className="grid md:grid-cols-3 gap-3 mb-5 ins-fade">
            <TopList title="Топ дарителей / 30д" items={overview.tops.givers} />
            <TopList title="Топ получателей / 30д" items={overview.tops.receivers} />
            <TopList title="Топ рефереров" items={overview.tops.referrers} />
          </section>
        )}

        {/* Admin inbox */}
        <AdminInbox />

        {/* Users table */}
        <section className="ins-card p-4 ins-fade">

          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Input
              placeholder="Поиск по имени или @username"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="max-w-xs bg-white/5 border-white/10 text-zinc-100 placeholder:text-zinc-500"
            />
            <Button size="sm" variant="outline" onClick={handleSearch} className="border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10">Найти</Button>
            <label className="flex items-center gap-2 text-xs text-zinc-400 ml-2">
              <input
                type="checkbox"
                checked={onlySleeping}
                onChange={(e) => { setOnlySleeping(e.target.checked); setPage(0); }}
              />
              Только спящие
            </label>
            {selected.size > 0 && (
              <Button size="sm" onClick={() => setBroadcastOpen(true)} className="ml-auto bg-indigo-500 hover:bg-indigo-400">
                <Send className="w-4 h-4 mr-1" /> Пуш выбранным ({selected.size})
              </Button>
            )}
          </div>

          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead className="text-zinc-500 text-xs">
                <tr className="text-left">
                  <th className="px-2 py-2 w-8"></th>
                  <th className="px-2 py-2">Имя</th>
                  <th className="px-2 py-2 hidden sm:table-cell">@username</th>
                  <th className="px-2 py-2 text-right">Lvl</th>
                  <th className="px-2 py-2 text-right">XP</th>
                  <th className="px-2 py-2 text-right">Баланс</th>
                  <th className="px-2 py-2">Активность</th>
                </tr>
              </thead>
              <tbody>
                {(users?.rows ?? []).map((u: any) => {
                  const days = u.last_seen_at ? Math.floor((Date.now() - new Date(u.last_seen_at).getTime()) / 86400000) : null;
                  const sleep = days === null || days >= 3;
                  return (
                    <tr key={u.user_id} className={`border-t border-white/5 ${sleep ? "ins-row-sleep" : ""}`}>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(u.user_id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(u.user_id); else next.delete(u.user_id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="px-2 py-2 text-zinc-200">{u.display_name ?? "—"}</td>
                      <td className="px-2 py-2 text-zinc-400 hidden sm:table-cell">{u.telegram_username ? `@${u.telegram_username}` : "—"}</td>
                      <td className="px-2 py-2 text-right text-zinc-300">{u.level}</td>
                      <td className="px-2 py-2 text-right text-zinc-400">{u.xp}</td>
                      <td className="px-2 py-2 text-right text-zinc-300">{Number(u.balance).toFixed(2)}</td>
                      <td className="px-2 py-2 text-zinc-400">
                        {days === null ? "никогда" : days === 0 ? "сегодня" : `${days} д. назад`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3 text-xs text-zinc-500">
            <span>{users?.total ?? 0} всего</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="text-zinc-300 hover:text-white">←</Button>
              <span className="self-center">Стр. {page + 1}</span>
              <Button variant="ghost" size="sm" disabled={!users || (page + 1) * 50 >= (users.total ?? 0)} onClick={() => setPage((p) => p + 1)} className="text-zinc-300 hover:text-white">→</Button>
            </div>
          </div>
        </section>
      </div>

      <BroadcastDialog
        open={broadcastOpen}
        onOpenChange={setBroadcastOpen}
        selectedCount={selected.size}
        selectedIds={Array.from(selected)}
        sleepingCount={overview?.activity.sleeping ?? 0}
        totalCount={overview?.activity.totalUsers ?? 0}
        onSend={async (payload) => {
          const res = await broadcastFn({ data: payload });
          toast.success(`Отправлено ${(res as any).sent} из ${(res as any).total}${(res as any).failed ? `, ошибок ${(res as any).failed}` : ""}`);
        }}
      />
    </div>
    </GlobalChrome>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="ins-tile p-3">
      <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">{icon}{label}</div>
      <div className="text-2xl font-semibold text-zinc-100 tabular-nums">{value}</div>
    </div>
  );
}

function FunnelRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-zinc-400 mb-1"><span>{label}</span><span>{value} · {pct}%</span></div>
      <div className="h-2 bg-white/5 rounded overflow-hidden">
        <div className="h-full bg-gradient-to-r from-indigo-500 to-pink-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: { date: string; count: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const w = 280, h = 60;
  const step = w / Math.max(1, points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (p.count / max) * h).toFixed(1)}`).join(" ");
  const total = points.reduce((s, p) => s + p.count, 0);
  return (
    <div>
      <div className="text-2xl font-semibold mb-1">{total}</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16">
        <path d={path} fill="none" stroke="rgba(129,140,248,0.9)" strokeWidth="2" />
      </svg>
    </div>
  );
}

function TopList({ title, items }: { title: string; items: { user_id: string; name: string; count: number }[] }) {
  return (
    <div className="ins-card p-3">
      <div className="text-xs text-zinc-400 mb-2">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-zinc-600">Пока пусто</div>
      ) : (
        <ul className="space-y-1">
          {items.map((i, idx) => (
            <li key={i.user_id} className="flex justify-between text-sm">
              <span className="text-zinc-300 truncate">{idx + 1}. {i.name}</span>
              <span className="text-zinc-500 tabular-nums">{i.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BroadcastDialog({
  open, onOpenChange, selectedCount, selectedIds, sleepingCount, totalCount, onSend,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedCount: number;
  selectedIds: string[];
  sleepingCount: number;
  totalCount: number;
  onSend: (payload: any) => Promise<void>;
}) {
  const [audience, setAudience] = useState<"sleeping" | "all" | "selected">("sleeping");
  const [text, setText] = useState("Привет! Соскучились по тебе в Подари 🎁\nЗайди посмотреть, что нового.");
  const [withButton, setWithButton] = useState(true);
  const [buttonText, setButtonText] = useState("Открыть приложение");
  const [buttonUrl, setButtonUrl] = useState("https://podari.lovable.app");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open && selectedCount > 0) setAudience("selected");
  }, [open, selectedCount]);

  const audienceSize = audience === "sleeping" ? sleepingCount : audience === "all" ? totalCount : selectedCount;

  const handleSend = async () => {
    setSending(true);
    try {
      await onSend({
        audience,
        userIds: audience === "selected" ? selectedIds : undefined,
        text,
        buttonText: withButton ? buttonText : undefined,
        buttonUrl: withButton ? buttonUrl : undefined,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#15151d] border-white/10 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle>Пуш в Telegram</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-zinc-400">Аудитория</Label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {[
                { v: "sleeping", l: `Спящие · ${sleepingCount}` },
                { v: "selected", l: `Выбранные · ${selectedCount}` },
                { v: "all", l: `Все · ${totalCount}` },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setAudience(o.v as any)}
                  disabled={o.v === "selected" && selectedCount === 0}
                  className={`px-2 py-2 rounded-md text-xs border transition ${audience === o.v ? "border-indigo-400 bg-indigo-500/15 text-white" : "border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200"} ${o.v === "selected" && selectedCount === 0 ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Текст (поддерживает HTML)</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="bg-white/5 border-white/10 text-zinc-100 mt-1"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={withButton} onChange={(e) => setWithButton(e.target.checked)} />
            Добавить кнопку-ссылку
          </label>
          {withButton && (
            <div className="grid grid-cols-2 gap-2">
              <Input value={buttonText} onChange={(e) => setButtonText(e.target.value)} placeholder="Текст" className="bg-white/5 border-white/10" />
              <Input value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} placeholder="URL" className="bg-white/5 border-white/10" />
            </div>
          )}
          <div className="text-xs text-zinc-500">Будет отправлено: ~{audienceSize} получателей</div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-zinc-400 hover:text-white">Отмена</Button>
          <Button onClick={handleSend} disabled={sending || audienceSize === 0 || !text.trim()} className="bg-indigo-500 hover:bg-indigo-400">
            {sending ? "Отправка..." : <><Send className="w-4 h-4 mr-1" /> Отправить</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
