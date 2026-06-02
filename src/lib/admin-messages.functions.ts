import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/integrations/supabase/admin-middleware";

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
    let q = supabaseAdmin
      .from("admin_messages")
      .select("id, user_id, content, image_path, status, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.onlyNew) q = q.eq("status", "new");
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("user_id, display_name, telegram_username")
        .in("user_id", ids);
      (profs ?? []).forEach((p) =>
        names.set(
          p.user_id!,
          p.telegram_username ? `@${p.telegram_username}` : p.display_name ?? "—",
        ),
      );
    }

    const enriched = await Promise.all(
      (rows ?? []).map(async (r) => {
        let image_url: string | null = null;
        if (r.image_path) {
          const { data: signed } = await supabaseAdmin.storage
            .from("admin-uploads")
            .createSignedUrl(r.image_path, 60 * 60);
          image_url = signed?.signedUrl ?? null;
        }
        return {
          id: r.id,
          user_id: r.user_id,
          user_name: names.get(r.user_id) ?? "—",
          content: r.content,
          image_url,
          status: r.status,
          created_at: r.created_at,
        };
      }),
    );
    return enriched;
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
