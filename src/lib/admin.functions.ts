import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/admin-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tgApi } from "@/lib/telegram-api";

const SLEEP_DAYS = 3;

function daysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

// ---------- Фильтры аудитории (для списка пользователей и рассылки) ----------
// «Статистические» фильтры (по числу подарков/приглашений) читаются из
// admin_user_stats — вьюхи, которая появляется только после применения
// миграции. Остальные (уровень, баланс, дата регистрации) работают всегда,
// они уже есть прямо в profiles.
const UserFilterSchema = z
  .object({
    neverPosted: z.boolean().optional(),
    neverGifted: z.boolean().optional(),
    neverReceived: z.boolean().optional(),
    neverInvited: z.boolean().optional(),
    minGiftsGiven: z.number().int().min(0).optional(),
    minLevel: z.number().int().min(1).optional(),
    maxLevel: z.number().int().min(1).optional(),
    minBalance: z.number().optional(),
    maxBalance: z.number().optional(),
    registeredWithinDays: z.number().int().min(1).optional(),
    registeredBeforeDays: z.number().int().min(1).optional(),
  })
  .optional();
type UserFilters = z.infer<typeof UserFilterSchema>;

function needsStatsView(f?: UserFilters): boolean {
  if (!f) return false;
  return !!(f.neverPosted || f.neverGifted || f.neverReceived || f.neverInvited || f.minGiftsGiven != null);
}

function applyBaseFilters(q: any, f?: UserFilters) {
  if (!f) return q;
  if (f.minLevel != null) q = q.gte("level", f.minLevel);
  if (f.maxLevel != null) q = q.lte("level", f.maxLevel);
  if (f.minBalance != null) q = q.gte("balance", f.minBalance);
  if (f.maxBalance != null) q = q.lte("balance", f.maxBalance);
  if (f.registeredWithinDays != null) q = q.gte("created_at", daysAgo(f.registeredWithinDays));
  if (f.registeredBeforeDays != null) q = q.lte("created_at", daysAgo(f.registeredBeforeDays));
  return q;
}

function applyStatsFilters(q: any, f?: UserFilters) {
  if (!f) return q;
  if (f.neverPosted) q = q.eq("gifts_posted", 0);
  if (f.neverGifted) q = q.eq("gifts_given", 0);
  if (f.neverReceived) q = q.eq("gifts_received", 0);
  if (f.neverInvited) q = q.eq("referrals_count", 0);
  if (f.minGiftsGiven != null) q = q.gte("gifts_given", f.minGiftsGiven);
  return q;
}

// ---------- Overview ----------
export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const now = new Date();
    const day1 = daysAgo(1);
    const day3 = daysAgo(SLEEP_DAYS);
    const day7 = daysAgo(7);
    const day14 = daysAgo(14);
    const day30 = daysAgo(30);

    const [
      pendingTx,
      giftsCount,
      avgCost,
      availableGifts,
      txTotal,
      tx7,
      tx30,
      txCancelled7,
      txCompletedTimes,
      dau,
      wau,
      mau,
      sleepingCount,
      newUsers14,
      newUsers7,
      totalUsers,
      usersWithGift,
      usersReceived,
      usersGifted,
      topGivers,
      topReceivers,
      topReferrers,
    ] = await Promise.all([
      supabaseAdmin.from("transactions").select("amount").eq("status", "pending"),
      supabaseAdmin.from("gifts").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("gifts").select("cost").eq("status", "available"),
      supabaseAdmin.from("gifts").select("id", { count: "exact", head: true }).eq("status", "available"),
      supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }).eq("status", "completed"),
      supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }).eq("status", "completed").gte("created_at", day7),
      supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }).eq("status", "completed").gte("created_at", day30),
      supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }).eq("status", "cancelled").gte("created_at", day7),
      supabaseAdmin.from("transactions").select("created_at, handover_requested_at").eq("status", "completed").not("handover_requested_at", "is", null).limit(500),
      supabaseAdmin.from("profiles").select("user_id", { count: "exact", head: true }).gte("last_seen_at", day1),
      supabaseAdmin.from("profiles").select("user_id", { count: "exact", head: true }).gte("last_seen_at", day7),
      supabaseAdmin.from("profiles").select("user_id", { count: "exact", head: true }).gte("last_seen_at", day30),
      supabaseAdmin.from("profiles").select("user_id", { count: "exact", head: true }).or(`last_seen_at.lt.${day3},last_seen_at.is.null`),
      supabaseAdmin.from("profiles").select("created_at").gte("created_at", day14),
      supabaseAdmin.from("profiles").select("user_id", { count: "exact", head: true }).gte("created_at", day7),
      supabaseAdmin.from("profiles").select("user_id", { count: "exact", head: true }),
      supabaseAdmin.from("gifts").select("owner_id"),
      supabaseAdmin.from("transactions").select("receiver_id").eq("status", "completed"),
      supabaseAdmin.from("transactions").select("sender_id").eq("status", "completed"),
      supabaseAdmin.from("transactions").select("sender_id").eq("status", "completed").gte("created_at", day30),
      supabaseAdmin.from("transactions").select("receiver_id").eq("status", "completed").gte("created_at", day30),
      supabaseAdmin.from("profiles").select("referred_by").not("referred_by", "is", null),
    ]);

    const escrow = (pendingTx.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const giftsTotal = giftsCount.count ?? 0;
    const emission = giftsTotal * 0.2;
    const avgCostVal = (avgCost.data?.length ?? 0)
      ? (avgCost.data!.reduce((s, r) => s + Number(r.cost ?? 0), 0) / avgCost.data!.length)
      : 0;

    const completionTimesMs = (txCompletedTimes.data ?? [])
      .map((r) => {
        if (!r.handover_requested_at) return null;
        return new Date(r.created_at).getTime() - new Date(r.handover_requested_at).getTime();
      })
      .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
    const avgHandoverMinutes = completionTimesMs.length
      ? Math.round(completionTimesMs.reduce((s, v) => s + v, 0) / completionTimesMs.length / 60000)
      : 0;

    // sparkline по дням
    const sparkline: { date: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      sparkline.push({ date: key, count: 0 });
    }
    (newUsers14.data ?? []).forEach((r) => {
      const key = String(r.created_at).slice(0, 10);
      const slot = sparkline.find((s) => s.date === key);
      if (slot) slot.count++;
    });

    function tally<T extends Record<string, unknown>>(rows: T[] | null, key: keyof T) {
      const m = new Map<string, number>();
      (rows ?? []).forEach((r) => {
        const v = r[key];
        if (typeof v === "string") m.set(v, (m.get(v) ?? 0) + 1);
      });
      return m;
    }

    const givers30 = Array.from(tally(topGivers.data as any[], "sender_id")).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const receivers30 = Array.from(tally(topReceivers.data as any[], "receiver_id")).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const referrers = Array.from(tally(topReferrers.data as any[], "referred_by")).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const userIdsToFetch = Array.from(new Set([...givers30.map(([id]) => id), ...receivers30.map(([id]) => id), ...referrers.map(([id]) => id)]));
    const namesMap = new Map<string, string>();
    if (userIdsToFetch.length) {
      const { data } = await supabaseAdmin.from("profiles").select("user_id, display_name, telegram_username").in("user_id", userIdsToFetch);
      (data ?? []).forEach((p) => {
        namesMap.set(p.user_id!, p.telegram_username ? `@${p.telegram_username}` : (p.display_name ?? "—"));
      });
    }
    const enrich = (rows: [string, number][]) => rows.map(([id, n]) => ({ user_id: id, name: namesMap.get(id) ?? "—", count: n }));

    // funnel
    const ownersSet = new Set((usersWithGift.data ?? []).map((r) => r.owner_id).filter(Boolean) as string[]);
    const receiversSet = new Set((usersReceived.data ?? []).map((r) => r.receiver_id).filter(Boolean) as string[]);
    const sendersSet = new Set((usersGifted.data ?? []).map((r) => r.sender_id).filter(Boolean) as string[]);

    return {
      economy: {
        escrow: Number(escrow.toFixed(2)),
        emission: Number(emission.toFixed(2)),
        avgGiftCost: Number(avgCostVal.toFixed(2)),
        availableGifts: availableGifts.count ?? 0,
        txTotal: txTotal.count ?? 0,
        tx7: tx7.count ?? 0,
        tx30: tx30.count ?? 0,
        txCancelled7: txCancelled7.count ?? 0,
        avgHandoverMinutes,
      },
      activity: {
        dau: dau.count ?? 0,
        wau: wau.count ?? 0,
        mau: mau.count ?? 0,
        sleeping: sleepingCount.count ?? 0,
        newUsers7: newUsers7.count ?? 0,
        totalUsers: totalUsers.count ?? 0,
        sparkline,
      },
      funnel: {
        registered: totalUsers.count ?? 0,
        posted: ownersSet.size,
        received: receiversSet.size,
        gifted: sendersSet.size,
      },
      tops: {
        givers: enrich(givers30),
        receivers: enrich(receivers30),
        referrers: enrich(referrers),
      },
    };
  });

// ---------- Users list ----------
export const getAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d) => z.object({
    page: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(200).default(50),
    search: z.string().max(100).optional(),
    onlySleeping: z.boolean().default(false),
    filters: UserFilterSchema,
  }).parse(d))
  .handler(async ({ data }) => {
    const from = data.page * data.pageSize;
    const to = from + data.pageSize - 1;
    const wantsStats = needsStatsView(data.filters);
    const statsCols =
      "user_id, display_name, telegram_username, telegram_id, level, xp, balance, last_seen_at, created_at, gifts_posted, gifts_given, gifts_received, referrals_count";
    const plainCols = "user_id, display_name, telegram_username, telegram_id, level, xp, balance, last_seen_at, created_at";

    const build = (table: "profiles" | "admin_user_stats", cols: string) => {
      let q = (supabaseAdmin.from(table as any) as any)
        .select(cols, { count: "exact" })
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .range(from, to);
      if (data.search && data.search.trim()) {
        const s = data.search.trim().replace(/[%_]/g, "");
        q = q.or(`display_name.ilike.%${s}%,telegram_username.ilike.%${s}%`);
      }
      if (data.onlySleeping) {
        q = q.or(`last_seen_at.lt.${daysAgo(SLEEP_DAYS)},last_seen_at.is.null`);
      }
      q = applyBaseFilters(q, data.filters);
      if (table === "admin_user_stats") q = applyStatsFilters(q, data.filters);
      return q;
    };

    let statsAvailable = false;
    let rows, count, error;
    if (wantsStats) {
      ({ data: rows, count, error } = await build("admin_user_stats", statsCols));
      statsAvailable = !error;
    }
    // Без запрошенных стат-фильтров, либо вьюха ещё не накатана — обычный запрос
    // к profiles (без счётчиков подарков/приглашений).
    if (!wantsStats || error) {
      ({ data: rows, count, error } = await build("profiles", plainCols));
    }
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, statsAvailable };
  });

// ---------- Sleeping export ----------
export const getSleepingUsers = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("user_id, display_name, telegram_username, telegram_id, last_seen_at")
      .or(`last_seen_at.lt.${daysAgo(SLEEP_DAYS)},last_seen_at.is.null`)
      .order("last_seen_at", { ascending: true, nullsFirst: true })
      .limit(2000);
    if (error) throw new Error(error.message);
    const now = Date.now();
    return (data ?? []).map((r) => ({
      ...r,
      days_inactive: r.last_seen_at
        ? Math.floor((now - new Date(r.last_seen_at).getTime()) / 86400000)
        : null,
    }));
  });

export const exportSleepingCsv = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("display_name, telegram_username, telegram_id, last_seen_at")
      .or(`last_seen_at.lt.${daysAgo(SLEEP_DAYS)},last_seen_at.is.null`);
    if (error) throw new Error(error.message);
    const header = "telegram_id,telegram_username,display_name,days_inactive,last_seen_at";
    const now = Date.now();
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = (data ?? []).map((r) => {
      const days = r.last_seen_at ? Math.floor((now - new Date(r.last_seen_at).getTime()) / 86400000) : "";
      return [r.telegram_id ?? "", r.telegram_username ?? "", r.display_name ?? "", days, r.last_seen_at ?? ""].map(esc).join(",");
    });
    return [header, ...lines].join("\n");
  });

// ---------- Telegram broadcast ----------
const BroadcastSchema = z.object({
  audience: z.enum(["sleeping", "all", "selected", "filtered"]),
  userIds: z.array(z.string().uuid()).max(2000).optional(),
  filters: UserFilterSchema,
  text: z.string().min(1).max(4000),
  buttonText: z.string().min(1).max(60).optional(),
  buttonUrl: z.string().url().max(500).optional(),
});

async function sendOne(chatId: number, text: string, button?: { text: string; url: string }) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (button) {
    body.reply_markup = {
      inline_keyboard: [[{ text: button.text, url: button.url }]],
    };
  }
  await tgApi("sendMessage", body);
}

export const sendTelegramBroadcast = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => BroadcastSchema.parse(d))
  .handler(async ({ data }) => {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error("Telegram не подключён");
    }
    let rows: { user_id: string; telegram_id: number | null }[] | null = null;
    let error: { message: string } | null = null;

    if (data.audience === "filtered") {
      const wantsStats = needsStatsView(data.filters);
      if (wantsStats) {
        let q = (supabaseAdmin.from("admin_user_stats" as any) as any)
          .select("user_id, telegram_id")
          .not("telegram_id", "is", null);
        q = applyBaseFilters(q, data.filters);
        q = applyStatsFilters(q, data.filters);
        const res = await q.limit(2000);
        if (res.error) {
          throw new Error(
            "Фильтры по подаркам/приглашениям пока недоступны — нужно применить обновление базы данных",
          );
        }
        rows = res.data as any;
      } else {
        let q = supabaseAdmin.from("profiles").select("user_id, telegram_id").not("telegram_id", "is", null);
        q = applyBaseFilters(q, data.filters);
        const res = await q.limit(2000);
        rows = res.data as any;
        error = res.error;
      }
    } else {
      let q = supabaseAdmin
        .from("profiles")
        .select("user_id, telegram_id")
        .not("telegram_id", "is", null);
      if (data.audience === "sleeping") {
        q = q.or(`last_seen_at.lt.${daysAgo(SLEEP_DAYS)},last_seen_at.is.null`);
      } else if (data.audience === "selected") {
        if (!data.userIds?.length) throw new Error("Не выбраны получатели");
        q = q.in("user_id", data.userIds);
      }
      const res = await q.limit(2000);
      rows = res.data as any;
      error = res.error;
    }
    if (error) throw new Error(error.message);

    const button = data.buttonText && data.buttonUrl ? { text: data.buttonText, url: data.buttonUrl } : undefined;
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    // ~25 msg/sec
    const targets = (rows ?? []).filter((r) => r.telegram_id);
    for (let i = 0; i < targets.length; i += 25) {
      const batch = targets.slice(i, i + 25);
      const results = await Promise.allSettled(
        batch.map((r) => sendOne(Number(r.telegram_id), data.text, button)),
      );
      results.forEach((res) => {
        if (res.status === "fulfilled") sent++;
        else {
          failed++;
          if (errors.length < 5) errors.push(String(res.reason?.message ?? res.reason));
        }
      });
      if (i + 25 < targets.length) await new Promise((r) => setTimeout(r, 1100));
    }
    return { sent, failed, total: targets.length, errors };
  });

// ---------- Check current admin ----------
export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => ({ isAdmin: true }));
