import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


function failOp(code: string, err: unknown): never {
  console.error(`[cozy] ${code}`, err);
  throw new Error(code);
}

// ---------- Profile ----------
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, display_name, balance, xp, level")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) failOp("PROFILE_LOAD_FAILED", error);
    return data;
  });

// ---------- Level gates ----------
const GiftKind = z.enum(["used_item", "specialist_time", "treat", "event_invite"]);
const PriceTier = z.enum(["under_3k", "tier_3k_6k"]);

function allowedForLevel(level: number, kind: string, tier: string): boolean {
  if (kind === "used_item") {
    if (tier === "under_3k") return level >= 1;
    if (tier === "tier_3k_6k") return level >= 4;
  }
  if (kind === "specialist_time") {
    if (tier === "under_3k") return level >= 2;
    if (tier === "tier_3k_6k") return level >= 5;
  }
  if (kind === "treat") return level >= 3;
  if (kind === "event_invite") return level >= 3;
  return false;
}

// ---------- Publish ----------
export const publishGift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().max(2000).nullable().optional(),
        category: z.string().min(1).max(80),
        image_url: z.string().max(15_000_000).nullable().optional(),
        image_urls: z.array(z.string().max(15_000_000)).max(10).optional(),
        gift_kind: GiftKind.default("used_item"),
        price_tier: PriceTier.default("under_3k"),
        price_rub: z.number().int().min(0).max(1_000_000).nullable().optional(),
        cost: z.number().int().min(1).max(5).default(1),
        condition: z.number().int().min(1).max(5).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    void allowedForLevel;

    let cost_flag = false;
    const { data: similar } = await supabase
      .from("gifts")
      .select("cost")
      .eq("gift_kind", data.gift_kind)
      .eq("category", data.category);
    const sample = (similar ?? [])
      .map((r) => Number(r.cost))
      .filter((n) => n >= 1 && n <= 5);
    if (sample.length >= 3) {
      const avg = sample.reduce((a, b) => a + b, 0) / sample.length;
      if (Math.abs(avg - data.cost) >= 2) cost_flag = true;
    }

    const urls = (data.image_urls ?? []).filter(Boolean);
    const cover = data.image_url ?? urls[0] ?? null;
    const allUrls = cover && !urls.includes(cover) ? [cover, ...urls] : urls;

    const { data: row, error } = await supabase
      .from("gifts")
      .insert({
        title: data.title,
        description: data.description ?? null,
        category: data.category,
        image_url: cover,
        image_urls: allUrls,
        status: "available",
        cost: data.cost,
        owner_id: userId,
        gift_kind: data.gift_kind,
        price_tier: data.price_tier,
        price_rub: data.price_rub ?? null,
        condition: data.condition ?? null,
        cost_flag,
      })
      .select("id")
      .single();
    if (error) failOp("GIFT_SAVE_FAILED", error);
    return { id: row.id, cost_flag };
  });

// ---------- Check gift cost average for soft warning ----------
export const checkGiftCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        gift_kind: GiftKind,
        category: z.string().min(1).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows } = await supabase
      .from("gifts")
      .select("cost")
      .eq("gift_kind", data.gift_kind)
      .eq("category", data.category);
    const sample = (rows ?? [])
      .map((r) => Number(r.cost))
      .filter((n) => n >= 1 && n <= 5);
    if (sample.length < 3) return { avg: null as number | null, count: sample.length };
    const avg = sample.reduce((a, b) => a + b, 0) / sample.length;
    return { avg: Math.round(avg * 10) / 10, count: sample.length };
  });


// ---------- Claim ----------
export const claimGift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ gift_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase.rpc("claim_gift", {
      _gift_id: data.gift_id,
    });
    if (error) {
      // Преобразуем доменные ошибки
      const msg = error.message || "";
      if (msg.includes("INSUFFICIENT_BALANCE")) throw new Error("INSUFFICIENT_BALANCE");
      if (msg.includes("ALREADY_TAKEN")) throw new Error("ALREADY_TAKEN");
      if (msg.includes("OWN_GIFT")) throw new Error("OWN_GIFT");
      if (msg.includes("GIFT_NOT_FOUND")) throw new Error("GIFT_NOT_FOUND");
      failOp("CLAIM_FAILED", error);
    }
    const first = Array.isArray(rows) ? rows[0] : rows;
    return {
      transaction_id: first?.transaction_id as string,
      chat_id: first?.chat_id as string,
    };
  });

// ---------- Chat messages ----------
export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        chat_id: z.string().uuid(),
        content: z.string().trim().min(1).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("messages")
      .insert({
        chat_id: data.chat_id,
        sender_id: userId,
        content: data.content,
      })
      .select("id, sender_id, content, created_at")
      .single();
    if (error) failOp("MESSAGE_SEND_FAILED", error);
    return row;
  });

// ---------- Confirm handover ----------
export const confirmHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transaction_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("confirm_handover", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp("HANDOVER_FAILED", error);
    return { ok: true };
  });

// ---------- Request handover (giver asks receiver to confirm) ----------
export const requestHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transaction_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("request_handover", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp("HANDOVER_FAILED", error);
    return { ok: true };
  });

// ---------- Decline handover (receiver says "не получил") ----------
export const declineHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transaction_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("decline_handover", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp("HANDOVER_FAILED", error);
    return { ok: true };
  });

// ---------- Cancel claim (отказаться от подарка) ----------
export const cancelClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transaction_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("cancel_claim", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp("CLAIM_CANCEL_FAILED", error);
    return { ok: true };
  });

// ---------- Cancel by sender (даритель отказывается от дарения) ----------
export const cancelBySender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transaction_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("cancel_by_sender", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp("SENDER_CANCEL_FAILED", error);
    return { ok: true };
  });

// ---------- Home stats (счётчики на главной, короткий кэш) ----------
// Кэш всего на 30 секунд: иначе только что загаданное желание/выложенный подарок
// до часа не попадают в счётчик и пользователь видит «0 желаний», хотя оно есть в ленте.
type HomeStats = { active_gifts: number; gifted_total: number; wishes_open: number };
const homeStatsCache: { value: HomeStats | null; at: number } = { value: null, at: 0 };

export const getHomeStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HomeStats> => {
    const now = Date.now();
    if (homeStatsCache.value && now - homeStatsCache.at < 30 * 1000) {
      return homeStatsCache.value;
    }
    const { supabase } = context;
    const [a, g, w] = await Promise.all([
      supabase.from("gifts").select("id", { count: "exact", head: true }).eq("status", "available"),
      supabase.from("gifts").select("id", { count: "exact", head: true }).eq("status", "gifted"),
      supabase.from("wishes").select("id", { count: "exact", head: true }).eq("status", "open"),
    ]);
    const value: HomeStats = {
      active_gifts: a.count ?? 0,
      gifted_total: g.count ?? 0,
      wishes_open: w.count ?? 0,
    };
    homeStatsCache.value = value;
    homeStatsCache.at = now;
    return value;
  });

// ---------- Review ----------
export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        transaction_id: z.string().uuid(),
        target_id: z.string().uuid(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(1000).optional(),
        is_auto: z.boolean().default(false),
        condition_confirmed: z.number().int().min(1).max(5).nullable().optional(),
        proof_image_url: z.string().max(15_000_000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Проверяем, что отправитель — участник транзакции и target_id — другая сторона
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .select("sender_id, receiver_id")
      .eq("id", data.transaction_id)
      .maybeSingle();
    if (txErr) failOp("REVIEW_FAILED", txErr);
    if (!tx || (tx.sender_id !== userId && tx.receiver_id !== userId)) {
      throw new Error("NOT_PARTY");
    }
    const expectedTarget = tx.sender_id === userId ? tx.receiver_id : tx.sender_id;
    if (data.target_id !== expectedTarget) throw new Error("INVALID_TARGET");

    const { error } = await supabase.from("reviews").insert({
      transaction_id: data.transaction_id,
      target_id: data.target_id,
      author_id: userId,
      rating: data.rating,
      comment: data.comment ?? null,
      is_auto: data.is_auto,
      condition_confirmed: data.condition_confirmed ?? null,
      proof_image_url: data.proof_image_url ?? null,
    });
    if (error) failOp("REVIEW_FAILED", error);
    return { ok: true };
  });

// ---------- Public deals feed ----------
export const getDealsFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: txs } = await supabase
      .from("transactions")
      .select("id, created_at, sender_id, gift:gifts(id, title, image_url, gift_kind)")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(30);
    const rows = txs ?? [];
    const senderIds = Array.from(
      new Set(rows.map((r) => r.sender_id).filter((v): v is string => !!v)),
    );
    const nameMap = new Map<string, string>();
    if (senderIds.length) {
      const { data: profs } = await supabase
        .rpc("get_public_profiles", { _user_ids: senderIds });
      for (const p of (profs ?? []) as Array<{ user_id: string; display_name: string }>) {
        nameMap.set(p.user_id, p.display_name || "Гость");
      }
    }

    return rows.map((r) => {
      const g = (r as { gift: { id: string; title: string; image_url: string | null; gift_kind: string } | null }).gift;
      return {
        id: r.id as string,
        created_at: r.created_at as string,
        sender_name: (r.sender_id && nameMap.get(r.sender_id)) || "Гость",
        gift_title: g?.title ?? "Подарок",
        gift_image: g?.image_url ?? null,
        gift_kind: g?.gift_kind ?? "used_item",
      };
    });
  });

// ---------- Cabinet lists ----------
export const getMyPostedGifts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("gifts")
      .select("id, title, category, description, image_url, status, created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });
    if (error) failOp("GIFTS_LOAD_FAILED", error);
    return data ?? [];
  });

export const getMyReceivedGifts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, status, created_at, gift:gifts(id, title, category, description, image_url, status)",
      )
      .eq("receiver_id", userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false });
    if (error) failOp("GIFTS_LOAD_FAILED", error);
    return data ?? [];
  });

export const getMyGiftedGifts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, status, created_at, gift:gifts(id, title, category, description, image_url, status)",
      )
      .eq("sender_id", userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false });
    if (error) failOp("GIFTS_LOAD_FAILED", error);
    return data ?? [];
  });

// ---------- Unread counters for cabinet badges ----------
export const getUnreadCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        last_seen_chats_at: z.string().nullable().optional(),
        last_seen_gifts_at: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const sinceChats = data.last_seen_chats_at ?? "1970-01-01T00:00:00Z";
    const sinceGifts = data.last_seen_gifts_at ?? "1970-01-01T00:00:00Z";

    // Активные чаты, где я участвую
    const { data: chats } = await supabase
      .from("chats")
      .select("id, user_a, user_b");
    const chatIds = (chats ?? []).map((c) => c.id as string);

    let chatsUnread = 0;
    if (chatIds.length) {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .in("chat_id", chatIds)
        .neq("sender_id", userId)
        .gt("created_at", sinceChats);
      chatsUnread = count ?? 0;
    }

    // Новые действия по подаркам: транзакции, в которых я участвую, обновлённые позже sinceGifts
    const { count: giftsCount } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .gt("created_at", sinceGifts);

    return { chats_unread: chatsUnread, gifts_unread: giftsCount ?? 0 };
  });


// ---------- Find pending transaction by gift (for chat / handover) ----------
export const getActiveTransactionForGift = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ gift_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("transactions")
      .select("id, status, sender_id, receiver_id")
      .eq("gift_id", data.gift_id)
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) failOp("TRANSACTION_LOAD_FAILED", error);
    return row;
  });

// ---------- My chats grouped by role ----------
export const getMyChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, status, created_at, sender_id, receiver_id, gift:gifts(id, title, image_url, category)",
      )
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order("created_at", { ascending: false });
    if (error) failOp("CHATS_LOAD_FAILED", error);
    const rows = data ?? [];
    const otherIds = Array.from(
      new Set(
        rows.map((r) =>
          r.sender_id === userId ? r.receiver_id : r.sender_id,
        ).filter((v): v is string => !!v),
      ),
    );
    const nameMap = new Map<string, string>();
    if (otherIds.length) {
      const { data: profs } = await supabase
        .rpc("get_public_profiles", { _user_ids: otherIds });
      for (const p of (profs ?? []) as Array<{ user_id: string; display_name: string }>) {
        nameMap.set(p.user_id, p.display_name || "Гость");
      }
    }

    // Последнее сообщение по каждому чату — чтобы отметить непрочитанные.
    const { data: myChats } = await supabase
      .from("chats")
      .select("id, gift_id")
      .or(`user_a.eq.${userId},user_b.eq.${userId}`);
    const giftToChat = new Map<string, string>();
    const chatIds: string[] = [];
    for (const ch of (myChats ?? []) as Array<{ id: string; gift_id: string | null }>) {
      if (ch.gift_id) giftToChat.set(ch.gift_id, ch.id);
      chatIds.push(ch.id);
    }
    const lastMsg = new Map<string, { at: string; fromMe: boolean }>();
    if (chatIds.length) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("chat_id, sender_id, created_at")
        .in("chat_id", chatIds)
        .order("created_at", { ascending: false })
        .limit(500);
      for (const m of (msgs ?? []) as Array<{ chat_id: string; sender_id: string; created_at: string }>) {
        if (!lastMsg.has(m.chat_id)) {
          lastMsg.set(m.chat_id, { at: m.created_at, fromMe: m.sender_id === userId });
        }
      }
    }

    type Item = {
      transaction_id: string;
      status: string;
      gift_id: string;
      gift_title: string;
      gift_image: string | null;
      other_name: string;
      created_at: string;
      last_message_at: string | null;
      last_incoming: boolean;
    };
    const activeGivers: Item[] = [];
    const activeReceivers: Item[] = [];
    const archiveGivers: Item[] = [];
    const archiveReceivers: Item[] = [];
    for (const r of rows) {
      const g = (r as { gift: { id: string; title: string; image_url: string | null } | null }).gift;
      if (!g) continue;
      const otherId = r.sender_id === userId ? r.receiver_id : r.sender_id;
      const lm = lastMsg.get(giftToChat.get(g.id) ?? "");
      const item: Item = {
        transaction_id: r.id as string,
        status: r.status as string,
        gift_id: g.id,
        gift_title: g.title,
        gift_image: g.image_url,
        other_name: (otherId && nameMap.get(otherId)) || "Гость",
        created_at: r.created_at as string,
        last_message_at: lm?.at ?? null,
        last_incoming: lm ? !lm.fromMe : false,
      };
      const isArchived = r.status === "completed" || r.status === "cancelled";
      if (r.receiver_id === userId) {
        (isArchived ? archiveGivers : activeGivers).push(item);
      } else {
        (isArchived ? archiveReceivers : activeReceivers).push(item);
      }
    }
    return {
      with_givers: activeGivers,
      with_receivers: activeReceivers,
      archive_with_givers: archiveGivers,
      archive_with_receivers: archiveReceivers,
    };
  });


// ---------- Onboarding «Первые шаги» ----------
export const getOnboardingSteps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const cnt = async (
      q: PromiseLike<{ count: number | null }>,
    ): Promise<number> => ((await q).count ?? 0);

    const [chosen, messaged, posted, invited, received, reviewed, gifted] =
      await Promise.all([
        cnt(supabase.from("transactions").select("id", { count: "exact", head: true }).eq("receiver_id", userId)),
        cnt(supabase.from("messages").select("id", { count: "exact", head: true }).eq("sender_id", userId)),
        cnt(supabase.from("gifts").select("id", { count: "exact", head: true }).eq("owner_id", userId)),
        cnt(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("referred_by", userId)),
        cnt(supabase.from("transactions").select("id", { count: "exact", head: true }).eq("receiver_id", userId).eq("status", "completed")),
        cnt(supabase.from("reviews").select("id", { count: "exact", head: true }).eq("author_id", userId)),
        cnt(supabase.from("transactions").select("id", { count: "exact", head: true }).eq("sender_id", userId).eq("status", "completed")),
      ]);

    return {
      chosen: chosen > 0,
      messaged: messaged > 0,
      posted: posted > 0,
      invited: invited > 0,
      received: received > 0,
      reviewed: reviewed > 0,
      gifted: gifted > 0,
    };
  });


// ---------- Achievements ----------
export const ACHIEVEMENT_META: Record<
  string,
  { title: string; description: string; emoji: string; xp: number; group: string }
> = {
  first_post:     { title: "Первая публикация", description: "Разместил свой первый подарок",          emoji: "📤", xp: 10, group: "Старт" },
  first_handover: { title: "Первая встреча",    description: "Передал подарок получателю",              emoji: "🤝", xp: 15, group: "Старт" },
  first_receive:  { title: "Первая радость",    description: "Получил свой первый подарок",             emoji: "🎁", xp: 10, group: "Старт" },
  first_review:   { title: "Спасибо сказано",   description: "Оставил первый отзыв",                    emoji: "💌", xp: 10, group: "Старт" },
  giver_5:        { title: "Щедрая душа",       description: "Передал 5 подарков",                      emoji: "💝", xp: 30, group: "Даритель" },
  receiver_5:     { title: "Открытый миру",     description: "Получил 5 подарков",                      emoji: "🌸", xp: 20, group: "Получатель" },
  level_2:        { title: "Новый горизонт",    description: "Достиг 2 уровня",                         emoji: "✨", xp: 25, group: "Прогресс" },
  first_referral: { title: "Пригласил друга",   description: "За каждого друга по ссылке — +50 XP",     emoji: "👯", xp: 0, group: "Социальное" },
};

export type AchievementRow = {
  code: string;
  unlocked: boolean;
  awarded_at: string | null;
  progress: number;
  target: number;
};

export const syncAndGetAchievements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // 1) Запускаем серверную функцию — она идемпотентно начислит всё новое
    const { data: granted, error: rpcErr } = await supabase.rpc("sync_achievements");
    if (rpcErr) failOp("ACHIEVEMENTS_SYNC_FAILED", rpcErr);

    // 2) Грузим текущее состояние
    const [ownedRes, postedRes, giftedRes, receivedRes, reviewsRes, referralsRes, profileRes] =
      await Promise.all([
        supabase
          .from("user_achievements")
          .select("code, awarded_at")
          .eq("user_id", userId),
        supabase.from("gifts").select("id", { count: "exact", head: true }).eq("owner_id", userId),
        supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("sender_id", userId)
          .eq("status", "completed"),
        supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("receiver_id", userId)
          .eq("status", "completed"),
        supabase
          .from("reviews")
          .select("id", { count: "exact", head: true })
          .eq("author_id", userId),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("referred_by", userId),
        supabase
          .from("profiles")
          .select("level")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

    const _ownedMap = new Map<string, string>();
    ((ownedRes.data ?? []) as { code: string; awarded_at: string }[]).forEach((r) =>
      _ownedMap.set(r.code, r.awarded_at),
    );

    const postedN = postedRes.count ?? 0;
    const giftedN = giftedRes.count ?? 0;
    const receivedN = receivedRes.count ?? 0;
    const reviewsN = reviewsRes.count ?? 0;
    const referralsN = referralsRes.count ?? 0;
    const levelN = (profileRes.data as { level?: number } | null)?.level ?? 1;

    const targets: Record<string, { value: number; target: number }> = {
      first_post:     { value: postedN,    target: 1 },
      first_handover: { value: giftedN,    target: 1 },
      first_receive:  { value: receivedN,  target: 1 },
      first_review:   { value: reviewsN,   target: 1 },
      giver_5:        { value: giftedN,    target: 5 },
      receiver_5:     { value: receivedN,  target: 5 },
      level_2:        { value: levelN,     target: 2 },
      first_referral: { value: referralsN, target: 1 },
    };

    const items: AchievementRow[] = Object.keys(targets).map((code) => {
      const t = targets[code];
      return {
        code,
        unlocked: _ownedMap.has(code),
        awarded_at: _ownedMap.get(code) ?? null,
        progress: Math.min(t.value, t.target),
        target: t.target,
      };
    });

    return {
      items,
      newly_granted: (granted ?? []) as { code: string; xp_granted: number }[],
    };
  });

// ---------- Banner: активные сделки и непрочитанные сообщения ----------
export const getDealsBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ last_seen_chats_at: z.string().nullable().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const sinceChats = data.last_seen_chats_at ?? "1970-01-01T00:00:00Z";

    // Активные сделки, где я участвую
    const { data: txs } = await supabase
      .from("transactions")
      .select("id, gift_id, sender_id, receiver_id, status, handover_requested_at, created_at")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    const pending = txs ?? [];
    const giftIds = Array.from(new Set(pending.map((t) => t.gift_id as string).filter(Boolean)));

    let gifts: { id: string; title: string }[] = [];
    if (giftIds.length) {
      const { data } = await supabase.from("gifts").select("id, title").in("id", giftIds);
      gifts = (data ?? []) as { id: string; title: string }[];
    }
    const giftMap = new Map(gifts.map((g) => [g.id, g.title]));

    // Непрочитанные сообщения
    const { data: chats } = await supabase.from("chats").select("id");
    const chatIds = (chats ?? []).map((c) => c.id as string);
    let unread = 0;
    if (chatIds.length) {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .in("chat_id", chatIds)
        .neq("sender_id", userId)
        .gt("created_at", sinceChats);
      unread = count ?? 0;
    }

    const deals = pending.slice(0, 3).map((t) => ({
      transaction_id: t.id as string,
      gift_id: t.gift_id as string,
      gift_title: giftMap.get(t.gift_id as string) ?? "Подарок",
      role: (t.sender_id === userId ? "giver" : "receiver") as "giver" | "receiver",
      handover_requested: !!t.handover_requested_at,
    }));

    return { pending_count: pending.length, unread_msgs: unread, deals };
  });

// ---------- Update / delete gift (only owner, only if not engaged) ----------
export const updateGift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).nullable().optional(),
        category: z.string().min(1).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: loadErr } = await supabase
      .from("gifts")
      .select("id, owner_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (loadErr) failOp("GIFT_LOAD_FAILED", loadErr);
    if (!existing) throw new Error("GIFT_NOT_FOUND");
    if (existing.owner_id !== userId) throw new Error("NOT_OWNER");
    if (existing.status !== "available") throw new Error("GIFT_IN_DEAL");
    const { error } = await supabase
      .from("gifts")
      .update({
        title: data.title,
        description: data.description ?? null,
        category: data.category,
      })
      .eq("id", data.id);
    if (error) failOp("GIFT_UPDATE_FAILED", error);
    return { ok: true };
  });

export const deleteGift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: loadErr } = await supabase
      .from("gifts")
      .select("id, owner_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (loadErr) failOp("GIFT_LOAD_FAILED", loadErr);
    if (!existing) throw new Error("GIFT_NOT_FOUND");
    if (existing.owner_id !== userId) throw new Error("NOT_OWNER");
    if (existing.status !== "available") throw new Error("GIFT_IN_DEAL");
    const { error } = await supabase.from("gifts").delete().eq("id", data.id);
    if (error) failOp("GIFT_DELETE_FAILED", error);
    return { ok: true };
  });
