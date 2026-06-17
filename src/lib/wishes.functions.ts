import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function failOp(code: string, err: unknown): never {
  console.error(`[wishes] ${code}`, err);
  throw new Error(code);
}

// ---------- Publish wish ----------
export const publishWish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(2000).nullable().optional(),
        category: z.string().min(1).max(80).default("разное"),
        cost: z.number().int().min(1).max(5).default(1),
        image_url: z.string().max(15_000_000).nullable().optional(),
        image_urls: z.array(z.string().max(15_000_000)).max(10).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const urls = (data.image_urls ?? []).filter(Boolean);
    const cover = data.image_url ?? urls[0] ?? "";
    const allUrls = cover && !urls.includes(cover) ? [cover, ...urls] : urls;

    let { data: row, error } = await supabase.rpc("publish_wish", {
      _title: data.title,
      _description: data.description ?? "",
      _image_url: cover,
      _category: data.category,
      _cost: data.cost,
    });
    // Если миграция со стоимостью желаний ещё не накатана — RPC не знает про
    // _cost. Тогда мягко откатываемся к старой сигнатуре (без стоимости),
    // чтобы загадывание не ломалось в переходный период.
    if (error && /_cost|function|PGRST202|does not exist|schema cache/i.test(error.message || "")) {
      ({ data: row, error } = await supabase.rpc("publish_wish", {
        _title: data.title,
        _description: data.description ?? "",
        _image_url: cover,
        _category: data.category,
      }));
    }
    if (error) failOp(error.message || "PUBLISH_WISH_FAILED", error);
    const wishId = row as unknown as string;
    if (allUrls.length > 0 && wishId) {
      await supabase
        .from("wishes")
        .update({ image_urls: allUrls })
        .eq("id", wishId)
        .eq("owner_id", userId);
    }
    return { id: wishId };
  });

// ---------- List wishes (feed) ----------
export const listWishes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ category: z.string().optional() }).default({}).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const build = (cols: string) => {
      let q = supabase
        .from("wishes")
        .select(cols)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(60);
      if (data.category) q = q.eq("category", data.category);
      return q;
    };
    // Пытаемся выбрать со стоимостью; если миграция со столбцом cost ещё не
    // накатана — откатываемся к набору без неё (cost тогда считаем за 1).
    let { data: rows, error } = await build(
      "id,title,description,category,image_url,status,owner_id,created_at,cost",
    );
    if (error && /cost/i.test(error.message || "")) {
      ({ data: rows, error } = await build(
        "id,title,description,category,image_url,status,owner_id,created_at",
      ));
    }
    if (error) failOp("LIST_WISHES_FAILED", error);

    const wishes = ((rows ?? []) as unknown as Array<{
      id: string;
      title: string;
      description: string | null;
      category: string;
      image_url: string | null;
      status: string;
      owner_id: string;
      created_at: string;
      cost?: number;
    }>);
    const ids = Array.from(new Set(wishes.map((w) => w.owner_id)));
    const nameMap = new Map<string, { name: string; level: number }>();
    if (ids.length) {
      const { data: profs } = await supabase.rpc("get_public_profiles", { _user_ids: ids });
      for (const p of ((profs ?? []) as Array<{ user_id: string; display_name: string; level: number }>)) {
        nameMap.set(p.user_id, { name: p.display_name || "Гость", level: p.level ?? 1 });
      }
    }
    return wishes.map((w) => ({
      ...w,
      cost: Number(w.cost) || 1,
      is_own: w.owner_id === userId,
      owner_name: nameMap.get(w.owner_id)?.name ?? "Гость",
      owner_level: nameMap.get(w.owner_id)?.level ?? 1,
    }));
  });

// ---------- My wishes ----------
export const getMyWishes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("wishes")
      .select("id,title,description,category,image_url,status,created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });
    if (error) failOp("MY_WISHES_FAILED", error);
    return data ?? [];
  });

// ---------- Fulfill (claim) wish ----------
export const fulfillWish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ wish_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("fulfill_wish", { _wish_id: data.wish_id });
    if (error) failOp(error.message || "FULFILL_WISH_FAILED", error);
    const first = (rows as Array<{ transaction_id: string; chat_id: string }>)?.[0];
    return {
      transaction_id: first?.transaction_id,
      chat_id: first?.chat_id,
    };
  });

// ---------- Wish handover request (giver -> wisher) ----------
export const requestWishHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ transaction_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("request_wish_handover", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp(error.message || "WISH_HANDOVER_FAILED", error);
    return { ok: true };
  });

// ---------- Confirm wish received (wisher) ----------
export const confirmWishReceived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ transaction_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("confirm_wish_received", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp(error.message || "WISH_CONFIRM_FAILED", error);
    return { ok: true };
  });

// ---------- Cancel wish claim ----------
export const cancelWishClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ transaction_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("cancel_wish_claim", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp(error.message || "WISH_CANCEL_FAILED", error);
    return { ok: true };
  });

// ---------- Delete own wish (only if status='open') ----------
export const deleteWish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ wish_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wishes")
      .delete()
      .eq("id", data.wish_id)
      .eq("owner_id", userId)
      .eq("status", "open");
    if (error) failOp("DELETE_WISH_FAILED", error);
    return { ok: true };
  });
