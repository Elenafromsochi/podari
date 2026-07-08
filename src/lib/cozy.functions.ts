import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { notifyUser, chatPath, giftPath } from "@/lib/notify.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Уведомляет всех модераторов (role='admin') в Telegram. */
async function notifyAdmins(text: string, path = "/") {
  try {
    const { data } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
    const ids = Array.from(
      new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id).filter(Boolean)),
    );
    await Promise.all(ids.map((id) => notifyUser(id, text, path)));
  } catch {
    /* уведомление админам не критично — не роняем действие */
  }
}

const APP_URL = process.env.APP_URL ?? "https://23podari.ru";

/** Оформляет «заявку о споре» в общую папку админов (admin_messages): сделка не
 *  завершена — даритель отметил передачу, а получатель отказался. В заявке видны
 *  оба участника (имя, @telegram, ID) со ссылками, чтобы админ сразу связался и
 *  написал им лично, плюс сам оставленный отзыв. Отзыв при этом НЕ стирается —
 *  остаётся скрытым, решение за модератором. */
async function openDisputeTicket(tx: {
  id: string;
  sender_id: string | null;
  receiver_id: string | null;
  gift_id: string | null;
}) {
  try {
    const ids = [tx.sender_id, tx.receiver_id].filter((v): v is string => !!v);
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("user_id, display_name, telegram_username")
      .in("user_id", ids);
    const pmap = new Map(
      ((profs ?? []) as Array<{
        user_id: string;
        display_name: string | null;
        telegram_username: string | null;
      }>).map((p) => [p.user_id, p]),
    );
    const { data: g } = await supabaseAdmin
      .from("gifts")
      .select("title")
      .eq("id", tx.gift_id)
      .maybeSingle();
    // Скрытый отзыв дарителя по этой сделке (если оставил при передаче).
    const { data: rev } = await supabaseAdmin
      .from("reviews")
      .select("rating, comment")
      .eq("transaction_id", tx.id)
      .eq("visible", false)
      .maybeSingle();

    const line = (uid: string | null, role: string) => {
      if (!uid) return `${role}: —`;
      const p = pmap.get(uid);
      const name = p?.display_name || "—";
      const tg = p?.telegram_username ? ` · @${p.telegram_username}` : "";
      const tgLink = p?.telegram_username
        ? `\n   ✉️ Написать: https://t.me/${p.telegram_username}`
        : "";
      return `${role}: ${name}${tg}\n   🆔 ${uid}\n   👤 Профиль: ${APP_URL}/user/${uid}${tgLink}`;
    };

    const comment = (rev as { comment?: string | null } | null)?.comment;
    const reviewLine = rev
      ? `\n\n⭐ Отзыв дарителя (пока скрыт, не зафиксирован): ${
          (rev as { rating?: number | null }).rating ?? "—"
        }/5${comment ? ` — «${comment}»` : ""}`
      : "";

    const content =
      `🛑 СПОР ПО СДЕЛКЕ — сделка не завершена\n` +
      `Подарок: «${(g as { title?: string } | null)?.title ?? "—"}»\n` +
      `Даритель отметил передачу, получатель нажал «не получил».\n\n` +
      `${line(tx.sender_id, "🎁 Даритель")}\n\n` +
      `${line(tx.receiver_id, "📥 Получатель")}` +
      reviewLine +
      `\n\n💬 Открыть чат сделки: ${APP_URL}/chat/${tx.gift_id}`;

    await supabaseAdmin.from("admin_messages").insert({
      user_id: tx.sender_id ?? tx.receiver_id,
      content,
      status: "new",
    });
  } catch {
    /* заявку в админку создать не удалось — не роняем действие */
  }
}

/** Удаляет «ожидающие» (скрытые) отзывы по сделке — когда сделка не состоялась,
 *  чтобы отзыв дарителя, написанный при передаче, не зафиксировался. */
async function dropPendingReviews(transactionId: string) {
  try {
    await supabaseAdmin
      .from("reviews")
      .delete()
      .eq("transaction_id", transactionId)
      .eq("visible", false);
  } catch {
    /* колонки visible может ещё не быть — тогда чистить нечего */
  }
}

/** Делает скрытый отзыв дарителя видимым и начисляет за него XP (через триггер) —
 *  когда получатель подтвердил получение подарка. */
async function revealPendingReviews(transactionId: string) {
  try {
    const { data } = await supabaseAdmin
      .from("reviews")
      .update({ visible: true })
      .eq("transaction_id", transactionId)
      .eq("visible", false)
      .select("target_id");
    for (const r of (data ?? []) as Array<{ target_id: string | null }>) {
      if (r.target_id)
        await notifyUser(r.target_id, `⭐ Тебе оставили новый отзыв! Загляни в профиль.`, "/?tab=profile");
    }
  } catch {
    /* колонки visible может ещё не быть */
  }
}


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
        quantity: z.number().int().min(1).max(99).default(1),
        city: z.string().max(80).nullable().optional(),
        is_online: z.boolean().default(false),
        // Скрытый подарок — не показывается в общей ленте; получить можно
        // только по прямой ссылке (личный подарок конкретному человеку).
        hidden: z.boolean().default(false),
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

    // Онлайн-подарок не привязан к городу; иначе берём указанный город.
    const giftCity = data.is_online ? null : (data.city?.trim() || null);
    // Скрытый подарок дарится одному конкретному человеку по ссылке — всегда
    // один экземпляр (иначе claim_gift после первой брони вернул бы статус
    // 'available' и подарок «всплыл» бы в ленте).
    const qty = data.hidden ? 1 : data.quantity;
    const baseInsert = {
      title: data.title,
      description: data.description ?? null,
      category: data.category,
      image_url: cover,
      image_urls: allUrls,
      status: data.hidden ? "hidden" : "available",
      cost: data.cost,
      owner_id: userId,
      gift_kind: data.gift_kind,
      price_tier: data.price_tier,
      price_rub: data.price_rub ?? null,
      condition: data.condition ?? null,
      cost_flag,
    };

    // Пишем с городом/онлайн; если миграция ещё не применена (нет колонок) —
    // повторяем без них, чтобы публикация не падала. PostgREST в этом случае
    // отдаёт PGRST204 («Could not find the 'city' column … in the schema cache»),
    // Postgres — 42703; ловим оба варианта.
    const isUndefinedColumn = (e: { code?: string; message?: string } | null) =>
      e?.code === "42703" ||
      e?.code === "PGRST204" ||
      /column .* does not exist|could not find the .* column|schema cache/i.test(
        e?.message ?? "",
      );

    // quantity/quantity_remaining идут в «расширенной» вставке вместе с
    // city/is_online: если миграция ещё не накатана — повторяем без них.
    let ins = await supabase
      .from("gifts")
      .insert({
        ...baseInsert,
        city: giftCity,
        is_online: data.is_online,
        quantity: qty,
        quantity_remaining: qty,
      })
      .select("id")
      .single();
    if (ins.error && isUndefinedColumn(ins.error)) {
      ins = await supabase.from("gifts").insert(baseInsert).select("id").single();
    }
    if (ins.error) failOp("GIFT_SAVE_FAILED", ins.error);

    // Запоминаем город в профиле (необязательно — игнорируем ошибки/отсутствие колонки).
    if (giftCity) {
      try {
        await supabase.from("profiles").update({ city: giftCity }).eq("user_id", userId);
      } catch {
        /* noop */
      }
    }

    return { id: ins.data.id, cost_flag };
  });

// ---------- Скрыть / открыть подарок (личный подарок по ссылке) ----------
// Переключает подарок между 'hidden' (виден только по ссылке) и 'available'
// (в общей ленте). Разрешено только владельцу и только пока подарок не в
// сделке (статус 'available' или 'hidden'). Скрытый — всегда один экземпляр.
export const setGiftHidden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ gift_id: z.string().uuid(), hidden: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nextStatus = data.hidden ? "hidden" : "available";
    const patch: Record<string, unknown> = { status: nextStatus, updated_at: new Date().toISOString() };
    // При скрытии делаем подарок одноразовым (см. комментарий в publishGift).
    if (data.hidden) {
      patch.quantity = 1;
      patch.quantity_remaining = 1;
    }
    const upd = async (p: Record<string, unknown>) =>
      supabase
        .from("gifts")
        .update(p)
        .eq("id", data.gift_id)
        .eq("owner_id", userId)
        .in("status", ["available", "hidden"])
        .select("id, status")
        .maybeSingle();
    let { data: row, error } = await upd(patch);
    // Если колонок quantity ещё нет — повторяем без них.
    if (error) ({ data: row, error } = await upd({ status: nextStatus }));
    if (error) failOp("GIFT_HIDE_FAILED", error);
    if (!row) throw new Error("GIFT_NOT_EDITABLE");
    return { id: (row as { id: string }).id, status: (row as { status: string }).status };
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
    // Никаких авто-сообщений от получателя: первое сообщение человек отправляет
    // сам (в чате оно только ПРЕДЛАГАЕТСЯ шаблоном). Владельцу о брони приходит
    // отдельное уведомление ниже, а сама сделка видна в списке чатов и без
    // сообщений (список строится по сделкам, а не по сообщениям).
    // Уведомляем владельца подарка о брони. quantity нужен, чтобы подсказки
    // «остался последний / разобрали все» слать только для многоразовых.
    // Если колонки quantity ещё нет (миграция не накатана) — читаем без неё.
    type GiftNotifyRow = { owner_id?: string | null; title?: string | null; quantity?: number | null };
    let g: GiftNotifyRow | null = null;
    {
      const withQty = await supabase
        .from("gifts")
        .select("owner_id, title, quantity")
        .eq("id", data.gift_id)
        .maybeSingle();
      if (withQty.error || !withQty.data) {
        const noQty = await supabase
          .from("gifts")
          .select("owner_id, title")
          .eq("id", data.gift_id)
          .maybeSingle();
        g = (noQty.data as GiftNotifyRow | null) ?? null;
      } else {
        g = withQty.data as GiftNotifyRow;
      }
    }
    if (g?.owner_id && g.owner_id !== userId) {
      await notifyUser(
        g.owner_id,
        `🎁 Кто-то забронировал твой подарок «${g.title}»! Загляни в чат — договоритесь о встрече.`,
        chatPath(data.gift_id),
      );
      // Для многоразового подарока: подсказываем владельцу, что экземпляры
      // заканчиваются. remaining приходит из claim_gift только после миграции.
      const remaining = ((first as { remaining?: number } | null)?.remaining ?? null) as
        | number
        | null;
      const qty = g.quantity ?? 1;
      if (qty > 1 && remaining === 1) {
        await notifyUser(
          g.owner_id,
          `🎁 У подарка «${g.title}» остался последний экземпляр.`,
          giftPath(data.gift_id),
        );
      } else if (qty > 1 && remaining === 0) {
        await notifyUser(
          g.owner_id,
          `🎁 Все экземпляры подарка «${g.title}» разобрали! Хочешь подарить снова? Открой подарок и нажми «Подарить снова».`,
          giftPath(data.gift_id),
        );
      }
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
    if (error) failOp("MESSAGE_SEND_FAILED", error);
    // Уведомляем собеседника о новом сообщении.
    const { data: ch } = await supabase
      .from("chats")
      .select("user_a, user_b, gift_id")
      .eq("id", data.chat_id)
      .maybeSingle();
    const other = ch ? (ch.user_a === userId ? ch.user_b : ch.user_a) : null;
    if (other && other !== userId) {
      const preview =
        data.content.length > 80 ? `${data.content.slice(0, 80)}…` : data.content;
      await notifyUser(other, `💬 Новое сообщение: «${preview}»`, chatPath(ch?.gift_id), {
        skipIfActiveWithinSec: 90,
      });
    }
    return row;
  });

// ---------- Confirm handover ----------
export const confirmHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transaction_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.rpc("confirm_handover", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp("HANDOVER_FAILED", error);
    // Сделка состоялась — «фиксируем» скрытый отзыв дарителя (делаем видимым, +XP).
    await revealPendingReviews(data.transaction_id);
    const { data: tx } = await supabase
      .from("transactions")
      .select("sender_id, receiver_id, gift_id")
      .eq("id", data.transaction_id)
      .maybeSingle();
    if (tx) {
      const other = tx.sender_id === userId ? tx.receiver_id : tx.sender_id;
      await notifyUser(
        other,
        `✅ Получатель подтвердил, что получил подарок. Спасибо за добро! 💚`,
        chatPath(tx.gift_id),
      );
    }
    return { ok: true };
  });

// ---------- Request handover (giver asks receiver to confirm) ----------
export const requestHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transaction_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.rpc("request_handover", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp("HANDOVER_FAILED", error);
    const { data: tx } = await supabase
      .from("transactions")
      .select("sender_id, receiver_id, gift_id")
      .eq("id", data.transaction_id)
      .maybeSingle();
    if (tx) {
      const other = tx.sender_id === userId ? tx.receiver_id : tx.sender_id;
      await notifyUser(
        other,
        `📦 Даритель отметил, что передал подарок — подтверди получение в чате.`,
        chatPath(tx.gift_id),
      );
    }
    return { ok: true };
  });

// ---------- Decline handover (receiver says "не получил") ----------
export const declineHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transaction_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Узнаём, отмечал ли даритель передачу — тогда это спор (один сказал
    // «передал», другой «не получил»), о нём уведомляем модераторов.
    const { data: before } = await supabase
      .from("transactions")
      .select("sender_id, receiver_id, gift_id, handover_requested_at")
      .eq("id", data.transaction_id)
      .maybeSingle();
    const { error } = await supabase.rpc("decline_handover", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp("HANDOVER_FAILED", error);
    const tx = before;
    if (tx) {
      const other = tx.sender_id === userId ? tx.receiver_id : tx.sender_id;
      await notifyUser(
        other,
        `⚠️ Получатель отметил, что пока не получил подарок. Загляни в чат — разберитесь вместе.`,
        chatPath(tx.gift_id),
      );
      // Спор: даритель отметил передачу, а получатель — «не получил».
      // Отзыв дарителя НЕ стираем — оформляем заявку в общую папку админов
      // (с обоими участниками и ссылками для связи) и пингуем модераторов.
      if (tx.handover_requested_at) {
        await openDisputeTicket({
          id: data.transaction_id,
          sender_id: tx.sender_id,
          receiver_id: tx.receiver_id,
          gift_id: tx.gift_id,
        });
        const { data: g } = await supabase
          .from("gifts")
          .select("title")
          .eq("id", tx.gift_id)
          .maybeSingle();
        await notifyAdmins(
          `🛑 Спор по сделке: даритель отметил, что передал «${(g as { title?: string } | null)?.title ?? ""}», а получатель нажал «не получил». Заявка в папке админов — нужен разбор.`,
          "/?tab=profile",
        );
      } else {
        // Спора нет (передачу не отмечали) — просто чистим скрытый отзыв, если был.
        await dropPendingReviews(data.transaction_id);
      }
    }
    return { ok: true };
  });

// ---------- Cancel claim (отказаться от подарка) ----------
export const cancelClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transaction_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.rpc("cancel_claim", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp("CLAIM_CANCEL_FAILED", error);
    // Сделка отменена — стираем скрытый (ожидающий) отзыв дарителя.
    await dropPendingReviews(data.transaction_id);
    const { data: tx } = await supabase
      .from("transactions")
      .select("sender_id, receiver_id, gift_id")
      .eq("id", data.transaction_id)
      .maybeSingle();
    if (tx) {
      const other = tx.sender_id === userId ? tx.receiver_id : tx.sender_id;
      await notifyUser(
        other,
        `↩️ Получатель отказался от подарка — он снова доступен другим.`,
        chatPath(tx.gift_id),
      );
    }
    return { ok: true };
  });

// ---------- Cancel by sender (даритель отказывается от дарения) ----------
export const cancelBySender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transaction_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.rpc("cancel_by_sender", {
      _transaction_id: data.transaction_id,
    });
    if (error) failOp("SENDER_CANCEL_FAILED", error);
    // Даритель отменил дарение — стираем его скрытый (ожидающий) отзыв.
    await dropPendingReviews(data.transaction_id);
    const { data: tx } = await supabase
      .from("transactions")
      .select("sender_id, receiver_id, gift_id")
      .eq("id", data.transaction_id)
      .maybeSingle();
    if (tx) {
      const other = tx.sender_id === userId ? tx.receiver_id : tx.sender_id;
      await notifyUser(
        other,
        `↩️ Даритель отменил передачу подарка. Балл вернулся — выбери другой 💚`,
        chatPath(tx.gift_id),
      );
    }
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
        // Отзыв дарителя, написанный в момент передачи: хранится скрытым и
        // «фиксируется» (становится видимым, начисляет XP) только когда
        // получатель подтвердит получение. Если сделка сорвётся — стирается.
        pending: z.boolean().default(false),
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

    const baseReview = {
      transaction_id: data.transaction_id,
      target_id: data.target_id,
      author_id: userId,
      rating: data.rating,
      comment: data.comment ?? null,
      is_auto: data.is_auto,
      condition_confirmed: data.condition_confirmed ?? null,
      proof_image_url: data.proof_image_url ?? null,
    };
    // Скрытый (ожидающий) отзыв пишем с visible=false; обычный — видимый сразу.
    let { error } = await supabase.from("reviews").insert({ ...baseReview, visible: !data.pending });
    // Если колонки visible ещё нет (миграция не накатана) — пишем без неё.
    const isUndefinedColumn = (e: { code?: string; message?: string } | null) =>
      e?.code === "42703" ||
      e?.code === "PGRST204" ||
      /column .* does not exist|could not find the .* column|schema cache/i.test(e?.message ?? "");
    if (error && isUndefinedColumn(error)) {
      ({ error } = await supabase.from("reviews").insert(baseReview));
    }
    if (error) failOp("REVIEW_FAILED", error);
    // Скрытый отзыв пока никого не уведомляет — уведомим при подтверждении сделки.
    if (!data.pending) {
      await notifyUser(
        data.target_id,
        `⭐ Тебе оставили новый отзыв! Загляни в профиль.`,
        "/?tab=profile",
      );
    }
    return { ok: true };
  });

// ---------- Republish (подарить тот же подарок снова — для услуг/аренды) ----------
export const republishGift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ gift_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const isUndefinedColumn = (e: { code?: string; message?: string } | null) =>
      e?.code === "42703" ||
      e?.code === "PGRST204" ||
      /column .* does not exist|could not find the .* column|schema cache/i.test(e?.message ?? "");

    const full =
      "owner_id, title, description, category, image_url, image_urls, cost, gift_kind, price_tier, price_rub, condition, city, is_online, quantity";
    let { data: g, error } = await supabase.from("gifts").select(full).eq("id", data.gift_id).maybeSingle();
    if (error)
      ({ data: g, error } = await supabase
        .from("gifts")
        .select("owner_id, title, description, category, image_url, image_urls, cost, gift_kind, price_tier, price_rub, condition")
        .eq("id", data.gift_id)
        .maybeSingle());
    if (error) failOp("GIFT_LOAD_FAILED", error);
    if (!g) throw new Error("GIFT_NOT_FOUND");
    const gg = g as Record<string, unknown>;
    if (gg.owner_id !== userId) throw new Error("NOT_OWNER");

    const base: Record<string, unknown> = {
      title: gg.title,
      description: gg.description ?? null,
      category: gg.category,
      image_url: gg.image_url ?? null,
      image_urls: gg.image_urls ?? [],
      status: "available",
      cost: gg.cost ?? 1,
      owner_id: userId,
      gift_kind: gg.gift_kind ?? "specialist_time",
      price_tier: gg.price_tier ?? "under_3k",
      price_rub: gg.price_rub ?? null,
      condition: gg.condition ?? null,
    };

    const dupQty = typeof gg.quantity === "number" && gg.quantity > 0 ? gg.quantity : 1;
    let ins = await supabase
      .from("gifts")
      .insert({
        ...base,
        city: gg.city ?? null,
        is_online: gg.is_online ?? false,
        quantity: dupQty,
        quantity_remaining: dupQty,
      })
      .select("id")
      .single();
    if (ins.error && isUndefinedColumn(ins.error)) {
      ins = await supabase.from("gifts").insert(base).select("id").single();
    }
    if (ins.error) failOp("GIFT_SAVE_FAILED", ins.error);
    return { id: ins.data.id };
  });

// ---------- Re-offer (подарить снова) ----------
// Владелец заново открывает многоразовый подарок: задаёт новое количество,
// остальное описание сохраняется как было. Доступно, только когда экземпляры
// кончились (статус не 'available') — иначе нет смысла.
export const reofferGift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        gift_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("gifts")
      .update({
        quantity: data.quantity,
        quantity_remaining: data.quantity,
        status: "available",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.gift_id)
      .eq("owner_id", userId);
    if (error) failOp("REOFFER_FAILED", error);
    return { ok: true };
  });

// ---------- Public single gift (для страницы подарка по ссылке, без входа) ----------
export const getPublicGift = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ gift_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const full =
      "id, title, description, category, image_url, image_urls, cost, condition, status, owner_id, gift_kind, city, is_online, quantity, quantity_remaining";
    let { data: g, error } = await supabaseAdmin.from("gifts").select(full).eq("id", data.gift_id).maybeSingle();
    if (error)
      ({ data: g, error } = await supabaseAdmin
        .from("gifts")
        .select("id, title, description, category, image_url, image_urls, cost, condition, status, owner_id, gift_kind")
        .eq("id", data.gift_id)
        .maybeSingle());
    if (error || !g) return null;
    const gg = g as Record<string, unknown>;
    let owner_name = "Гость";
    let owner_level = 1;
    if (gg.owner_id) {
      const { data: profs } = await supabaseAdmin.rpc("get_public_profiles", {
        _user_ids: [gg.owner_id],
      });
      const p = ((profs ?? []) as Array<{ display_name: string; level: number }>)[0];
      if (p) {
        owner_name = p.display_name || "Гость";
        owner_level = p.level ?? 1;
      }
    }
    return { ...gg, owner_name, owner_level };
  });

// ---------- Reviews about a user (тексты отзывов) ----------
export const getReviewsAbout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Показываем только «видимые» отзывы: скрытый (ожидающий) отзыв дарителя не
    // виден, пока получатель не подтвердит получение. Если колонки visible ещё
    // нет (миграция не накатана) — читаем без фильтра.
    const buildQuery = (withVisible: boolean) => {
      let q = supabase
        .from("reviews")
        .select("id, rating, comment, created_at, author_id, is_auto")
        .eq("target_id", data.user_id);
      if (withVisible) q = q.eq("visible", true);
      return q.order("created_at", { ascending: false }).limit(50);
    };
    let { data: rows, error: rErr } = await buildQuery(true);
    if (rErr) ({ data: rows } = await buildQuery(false));
    const list = (rows ?? []) as Array<{
      id: string;
      rating: number;
      comment: string | null;
      created_at: string;
      author_id: string;
      is_auto: boolean;
    }>;
    const ids = Array.from(new Set(list.map((r) => r.author_id).filter(Boolean)));
    const nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await supabase.rpc("get_public_profiles", { _user_ids: ids });
      for (const p of (profs ?? []) as Array<{ user_id: string; display_name: string }>) {
        nameMap.set(p.user_id, p.display_name || "Гость");
      }
    }
    const avg =
      list.length > 0 ? list.reduce((s, r) => s + (r.rating ?? 0), 0) / list.length : 0;
    return {
      count: list.length,
      avg: Math.round(avg * 10) / 10,
      items: list.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        created_at: r.created_at,
        author_name: nameMap.get(r.author_id) ?? "Гость",
      })),
    };
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
    const build = (cols: string) =>
      supabase
        .from("gifts")
        .select(cols)
        .eq("owner_id", userId)
        .order("created_at", { ascending: false });
    // С городом/онлайн; если миграция ещё не накатана — без них.
    let { data, error } = await build(
      "id, title, category, description, image_url, status, cost, created_at, city, is_online, quantity, quantity_remaining",
    );
    if (error)
      ({ data, error } = await build(
        "id, title, category, description, image_url, status, cost, created_at",
      ));
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

// ---------- Incoming bookings (кто забронировал мой подарок, ждём передачи) ----------
export const getMyIncomingBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, status, created_at, gift_id, receiver_id, gift:gifts(id, title, image_url, status)",
      )
      .eq("sender_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) failOp("BOOKINGS_LOAD_FAILED", error);
    const rows = data ?? [];
    const ids = Array.from(
      new Set(rows.map((r) => r.receiver_id).filter((v): v is string => !!v)),
    );
    const nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await supabase.rpc("get_public_profiles", { _user_ids: ids });
      for (const p of (profs ?? []) as Array<{ user_id: string; display_name: string }>) {
        nameMap.set(p.user_id, p.display_name || "Гость");
      }
    }
    return rows.map((r) => {
      const g = (r as { gift: { id: string; title: string; image_url: string | null; status: string } | null }).gift;
      return {
        transaction_id: r.id as string,
        created_at: r.created_at as string,
        gift_id: r.gift_id as string,
        receiver_name: (r.receiver_id && nameMap.get(r.receiver_id)) || "Гость",
        gift_title: g?.title ?? "Подарок",
        gift_image: g?.image_url ?? null,
      };
    });
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

    // По каким завершённым сделкам я ещё НЕ оставил отзыв — чтобы показать
    // в списке чатов плашку «Оставьте отзыв». Отзыв = строка в reviews с моим
    // author_id по этой транзакции.
    const completedTxIds = rows
      .filter((r) => r.status === "completed")
      .map((r) => r.id as string);
    const reviewedTxIds = new Set<string>();
    if (completedTxIds.length) {
      const { data: myReviews } = await supabase
        .from("reviews")
        .select("transaction_id")
        .eq("author_id", userId)
        .in("transaction_id", completedTxIds);
      for (const rv of (myReviews ?? []) as Array<{ transaction_id: string }>) {
        reviewedTxIds.add(rv.transaction_id);
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
      needs_review: boolean;
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
        needs_review:
          (r.status as string) === "completed" &&
          !reviewedTxIds.has(r.id as string),
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

    // «Пригласить друга» засчитываем, если друг реально зарегистрировался по
    // ссылке (referred_by) ИЛИ пользователь хоть раз отправил приглашение —
    // факт отправки храним в user_metadata.invited_at (см. markInvited), чтобы
    // галочка не зависела от localStorage конкретного устройства/домена.
    const invitedShared = await invitedFromMeta(userId);

    return {
      chosen: chosen > 0,
      messaged: messaged > 0,
      posted: posted > 0,
      invited: invited > 0 || invitedShared,
      received: received > 0,
      reviewed: reviewed > 0,
      gifted: gifted > 0,
    };
  });

/** Читает из auth-метаданных, отправлял ли пользователь приглашение. */
async function invitedFromMeta(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const meta = (data?.user?.user_metadata ?? {}) as { invited_at?: string };
    return !!meta.invited_at;
  } catch (e) {
    console.error("[cozy] INVITED_META_READ_FAILED", e);
    return false;
  }
}

/** Отмечает, что пользователь отправил приглашение (для шага «Пригласить друга»). */
export const markInvited = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
      if (!meta.invited_at) {
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          user_metadata: { ...meta, invited_at: new Date().toISOString() },
        });
      }
    } catch (e) {
      console.error("[cozy] MARK_INVITED_FAILED", e);
    }
    return { ok: true };
  });

// ---------- Public journey (для профиля любого пользователя, только чтение) ----------
export const getUserJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const uid = data.user_id;
    const cnt = async (
      q: PromiseLike<{ count: number | null }>,
    ): Promise<number> => ((await q).count ?? 0);

    const [chosen, messaged, posted, referrals, received, reviewsWritten, gifted] =
      await Promise.all([
        cnt(supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }).eq("receiver_id", uid)),
        cnt(supabaseAdmin.from("messages").select("id", { count: "exact", head: true }).eq("sender_id", uid)),
        cnt(supabaseAdmin.from("gifts").select("id", { count: "exact", head: true }).eq("owner_id", uid)),
        cnt(supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("referred_by", uid)),
        cnt(supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }).eq("receiver_id", uid).eq("status", "completed")),
        cnt(supabaseAdmin.from("reviews").select("id", { count: "exact", head: true }).eq("author_id", uid)),
        cnt(supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }).eq("sender_id", uid).eq("status", "completed")),
      ]);

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("level")
      .eq("user_id", uid)
      .maybeSingle();
    const level = (prof?.level as number | undefined) ?? 1;

    return {
      db: {
        chosen: chosen > 0,
        messaged: messaged > 0,
        posted: posted > 0,
        invited: referrals > 0,
        received: received > 0,
        reviewed: reviewsWritten > 0,
        gifted: gifted > 0,
      },
      stats: { posted, gifted, received, reviews: reviewsWritten, referrals, level },
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
      stats: {
        posted: postedN,
        gifted: giftedN,
        received: receivedN,
        reviews: reviewsN,
        referrals: referralsN,
        level: levelN,
      },
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
// Загрузка подарка для полной формы редактирования (только владелец).
export const getGiftForEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const sel = (cols: string) =>
      supabase.from("gifts").select(cols).eq("id", data.id).maybeSingle();
    let res = await sel(
      "id, owner_id, status, title, description, category, image_url, image_urls, cost, condition, gift_kind, city, is_online, quantity",
    );
    if (res.error)
      res = await sel(
        "id, owner_id, status, title, description, category, image_url, image_urls, cost, condition, gift_kind",
      );
    if (res.error) failOp("GIFT_LOAD_FAILED", res.error);
    const gg = (res.data ?? null) as Record<string, unknown> | null;
    if (!gg) throw new Error("GIFT_NOT_FOUND");
    if (gg.owner_id !== userId) throw new Error("NOT_OWNER");
    return {
      id: gg.id as string,
      owner_id: (gg.owner_id as string | null) ?? null,
      status: (gg.status as string | null) ?? null,
      title: (gg.title as string | null) ?? null,
      description: (gg.description as string | null) ?? null,
      category: (gg.category as string | null) ?? null,
      image_url: (gg.image_url as string | null) ?? null,
      image_urls: (gg.image_urls as string[] | null) ?? null,
      cost: (gg.cost as number | null) ?? null,
      condition: (gg.condition as number | null) ?? null,
      gift_kind: (gg.gift_kind as string | null) ?? null,
      city: (gg.city as string | null) ?? null,
      is_online: (gg.is_online as boolean | null) ?? null,
      quantity: (gg.quantity as number | null) ?? null,
    };
  });

export const updateGift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).nullable().optional(),
        category: z.string().min(1).max(80),
        cost: z.number().int().min(1).max(5).optional(),
        condition: z.number().int().min(1).max(5).nullable().optional(),
        gift_kind: GiftKind.optional(),
        image_url: z.string().max(15_000_000).nullable().optional(),
        image_urls: z.array(z.string().max(15_000_000)).max(10).optional(),
        city: z.string().max(80).nullable().optional(),
        is_online: z.boolean().optional(),
        quantity: z.number().int().min(1).max(99).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let { data: existing, error: loadErr } = await supabase
      .from("gifts")
      .select("id, owner_id, status, quantity")
      .eq("id", data.id)
      .maybeSingle();
    if (loadErr)
      ({ data: existing, error: loadErr } = await supabase
        .from("gifts")
        .select("id, owner_id, status")
        .eq("id", data.id)
        .maybeSingle());
    if (loadErr) failOp("GIFT_LOAD_FAILED", loadErr);
    if (!existing) throw new Error("GIFT_NOT_FOUND");
    const ex = existing as { owner_id?: string; status?: string; quantity?: number };
    if (ex.owner_id !== userId) throw new Error("NOT_OWNER");
    if (ex.status !== "available") throw new Error("GIFT_IN_DEAL");

    const patch: Record<string, unknown> = {
      title: data.title,
      description: data.description ?? null,
      category: data.category,
    };
    if (data.condition !== undefined) patch.condition = data.condition;
    if (data.gift_kind !== undefined) patch.gift_kind = data.gift_kind;
    if (data.image_url !== undefined) patch.image_url = data.image_url;
    if (data.image_urls !== undefined) patch.image_urls = data.image_urls;
    // Стоимость менять можно, но не выше своего уровня (как и при публикации).
    if (typeof data.cost === "number") {
      const { data: prof } = await supabase
        .from("profiles")
        .select("level")
        .eq("user_id", userId)
        .maybeSingle();
      const level = (prof?.level as number | undefined) ?? 1;
      if (data.cost > level) throw new Error("LEVEL_TOO_LOW");
      patch.cost = data.cost;
    }

    // Поля города/онлайна/количества появились позже — если колонок нет
    // (миграция не накатана), повторяем апдейт без них.
    const isUndefinedColumn = (e: { code?: string; message?: string } | null) =>
      e?.code === "42703" ||
      e?.code === "PGRST204" ||
      /column .* does not exist|could not find the .* column|schema cache/i.test(e?.message ?? "");
    const extended: Record<string, unknown> = { ...patch };
    if (data.city !== undefined) extended.city = data.city;
    if (typeof data.is_online === "boolean") extended.is_online = data.is_online;
    if (typeof data.quantity === "number") {
      extended.quantity = data.quantity;
      // Остаток пересобираем только если тираж реально изменился — чтобы не
      // обнулять уже сделанные брони при правке других полей.
      if (data.quantity !== (ex.quantity ?? 1)) {
        extended.quantity_remaining = data.quantity;
      }
    }

    let { error } = await supabase.from("gifts").update(extended).eq("id", data.id);
    if (error && isUndefinedColumn(error)) {
      ({ error } = await supabase.from("gifts").update(patch).eq("id", data.id));
    }
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
