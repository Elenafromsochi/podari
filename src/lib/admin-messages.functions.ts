import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/integrations/supabase/admin-middleware";
import { tgApi } from "@/lib/telegram-api";
import { toProxiedStorageUrl } from "@/lib/proxied-storage-url.server";

// Отправка сообщения админу (от пользователя)
export const sendAdminMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        content: z.string().trim().min(1).max(4000),
        image_path: z.string().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("admin_messages").insert({
      user_id: userId,
      content: data.content,
      image_path: data.image_path ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Админ: список сообщений с именами пользователей и подписанными URL картинок
export const listAdminMessages = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d) =>
    z.object({ onlyNew: z.boolean().default(false) }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const build = (cols: string) => {
      let q = supabaseAdmin
        .from("admin_messages")
        .select(cols)
        .order("created_at", { ascending: false })
        .limit(500);
      if (data.onlyNew) q = q.eq("status", "new");
      return q;
    };
    // С ответом админа; если колонок admin_reply/replied_at ещё нет (миграция
    // не накатана) — читаем без них.
    let { data: rows, error } = await build(
      "id, user_id, content, image_path, status, created_at, admin_reply, replied_at",
    );
    if (error) ({ data: rows, error } = await build("id, user_id, content, image_path, status, created_at"));
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.user_id as string)));
    const names = new Map<string, string>();
    const usernames = new Map<string, string | null>();
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("user_id, display_name, telegram_username")
        .in("user_id", ids);
      (profs ?? []).forEach((p) => {
        names.set(
          p.user_id!,
          p.telegram_username ? `@${p.telegram_username}` : p.display_name ?? "—",
        );
        usernames.set(p.user_id!, p.telegram_username ?? null);
      });
    }

    const enriched = await Promise.all(
      (rows ?? []).map(async (r: any) => {
        let image_url: string | null = null;
        if (r.image_path) {
          const { data: signed } = await supabaseAdmin.storage
            .from("admin-uploads")
            .createSignedUrl(r.image_path, 60 * 60);
          image_url = signed?.signedUrl ? toProxiedStorageUrl(signed.signedUrl) : null;
        }
        return {
          id: r.id,
          user_id: r.user_id,
          user_name: names.get(r.user_id) ?? "—",
          telegram_username: usernames.get(r.user_id) ?? null,
          content: r.content,
          image_url,
          status: r.status,
          created_at: r.created_at,
          admin_reply: (r.admin_reply as string | null) ?? null,
          replied_at: (r.replied_at as string | null) ?? null,
        };
      }),
    );
    return enriched;
  });

// Админ: ответить пользователю — уходит ему личным сообщением в Telegram-бота.
export const replyAdminMessage = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        text: z.string().trim().min(1).max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: msg, error: loadErr } = await supabaseAdmin
      .from("admin_messages")
      .select("id, user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!msg) throw new Error("MESSAGE_NOT_FOUND");

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("telegram_id")
      .eq("user_id", (msg as { user_id: string }).user_id)
      .maybeSingle();
    const telegramId = (prof as { telegram_id?: number | null } | null)?.telegram_id;
    if (!telegramId) throw new Error("NO_TELEGRAM");

    await tgApi("sendMessage", {
      chat_id: Number(telegramId),
      text: `💌 Ответ от команды «Подари»:\n\n${data.text}`,
    });

    let { error } = await supabaseAdmin
      .from("admin_messages")
      .update({ admin_reply: data.text, replied_at: new Date().toISOString(), status: "read" } as any)
      .eq("id", data.id);
    if (error) {
      // Колонок admin_reply/replied_at ещё нет (миграция не накатана) —
      // сообщение всё равно уходит человеку, просто без сохранения текста ответа.
      ({ error } = await supabaseAdmin
        .from("admin_messages")
        .update({ status: "read" })
        .eq("id", data.id));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Админ: пометить прочитанным/новым
export const setAdminMessageStatus = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["new", "read"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("admin_messages")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
