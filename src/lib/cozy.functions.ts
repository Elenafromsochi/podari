import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const INITIAL_CHAT_MESSAGE = "Мне понравился ваш подарок. Как могу его забрать? 😊";

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
    if (error) throw new Error(error.message);
    return data;
  });

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
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("gifts")
      .insert({
        title: data.title,
        description: data.description ?? null,
        category: data.category,
        image_url: data.image_url ?? null,
        status: "available",
        cost: 100,
        owner_id: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
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
      throw new Error(msg);
    }
    const first = Array.isArray(rows) ? rows[0] : rows;
    if (first?.chat_id) {
      const { error: messageError } = await supabase.from("messages").insert({
        chat_id: first.chat_id as string,
        sender_id: userId,
        content: INITIAL_CHAT_MESSAGE,
      });
      if (messageError) throw new Error(messageError.message);
    }
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
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
    return { ok: true };
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("reviews").insert({
      transaction_id: data.transaction_id,
      target_id: data.target_id,
      author_id: userId,
      rating: data.rating,
      comment: data.comment ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
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
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
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
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", otherIds);
      for (const p of profs ?? []) {
        nameMap.set(p.user_id as string, (p.display_name as string) || "Гость");
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
    };
    const activeGivers: Item[] = [];
    const activeReceivers: Item[] = [];
    const archiveGivers: Item[] = [];
    const archiveReceivers: Item[] = [];
    for (const r of rows) {
      const g = (r as { gift: { id: string; title: string; image_url: string | null } | null }).gift;
      if (!g) continue;
      const otherId = r.sender_id === userId ? r.receiver_id : r.sender_id;
      const item: Item = {
        transaction_id: r.id as string,
        status: r.status as string,
        gift_id: g.id,
        gift_title: g.title,
        gift_image: g.image_url,
        other_name: (otherId && nameMap.get(otherId)) || "Гость",
        created_at: r.created_at as string,
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

