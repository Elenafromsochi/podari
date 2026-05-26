import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  anonClient,
  rememberTrustedDevice,
  userEmail,
  userPassword,
  verifyWidgetSignature,
} from "./telegram-widget.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const deviceIdSchema = z.string().min(8).max(128);

const widgetPayloadSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    auth_date: z.union([z.number(), z.string()]),
    hash: z.string().min(10).max(256),
    username: z.string().max(64).optional().nullable(),
    first_name: z.string().max(128).optional().nullable(),
    last_name: z.string().max(128).optional().nullable(),
    photo_url: z.string().url().max(512).optional().nullable(),
  })
  .passthrough();

/**
 * Единственный шаг входа: подписанный payload от Telegram Login Widget.
 *   - Если пользователь существует → возвращаем сессию.
 *   - Если нет → создаём аккаунт с именем из Telegram и возвращаем сессию.
 * Никаких паролей и кодов в чате.
 */
export const widgetSignIn = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        payload: widgetPayloadSchema,
        device_id: deviceIdSchema,
        device_label: z.string().trim().max(120).optional(),
        referrer_id: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = verifyWidgetSignature(
      data.payload as Record<string, unknown>,
    );

    const email = userEmail(verified.telegram_id);
    const password = userPassword(verified.telegram_id);
    const label = data.device_label?.trim() || "Web";
    const displayName =
      verified.first_name?.trim() ||
      verified.username?.trim() ||
      "Гость";

    // 1. Существует ли профиль с таким telegram_id?
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("user_id, telegram_username")
      .eq("telegram_id", verified.telegram_id)
      .maybeSingle();

    let userId = profile?.user_id as string | undefined;
    let isNew = false;

    if (userId) {
      // Поддерживаем актуальный username + гарантируем, что пароль = детерминированный
      await supabaseAdmin
        .from("profiles")
        .update({
          telegram_username: verified.username ?? profile?.telegram_username,
          password_set: true,
        })
        .eq("user_id", userId);
      // На случай, если пароль был изменён вручную — выравниваем
      await supabaseAdmin.auth.admin.updateUserById(userId, { password });
    } else {
      // 2. Создаём нового пользователя
      const { data: created, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            display_name: displayName,
            telegram_id: verified.telegram_id,
            telegram_username: verified.username,
            referred_by: data.referrer_id ?? null,
          },
        });

      if (createErr || !created?.user) {
        // На случай, если auth-юзер есть, а профиля нет (рассинхрон) — найдём по email
        const { data: list } = await supabaseAdmin.auth.admin.listUsers();
        const found = list?.users.find((x) => x.email === email);
        if (!found) {
          console.error("[tg-widget] createUser failed", createErr);
          throw new Error("USER_CREATE_FAILED");
        }
        await supabaseAdmin.auth.admin.updateUserById(found.id, { password });
        userId = found.id;
      } else {
        userId = created.user.id;
        isNew = true;
      }

      await supabaseAdmin
        .from("profiles")
        .update({
          display_name: displayName,
          telegram_id: verified.telegram_id,
          telegram_username: verified.username,
          password_set: true,
        })
        .eq("user_id", userId);

      if (data.referrer_id && data.referrer_id !== userId) {
        await supabaseAdmin
          .from("profiles")
          .update({ referred_by: data.referrer_id })
          .eq("user_id", userId)
          .is("referred_by", null);
        await supabaseAdmin.rpc("apply_referral_bonus", { _new_user: userId });
      }
    }

    await rememberTrustedDevice(userId!, data.device_id, label);

    // 3. Выдаём сессию через анонимный клиент
    const anon = anonClient();
    const { data: signIn, error: signInErr } =
      await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !signIn.session) {
      console.error("[tg-widget] sign-in failed", signInErr);
      throw new Error("SIGNIN_FAILED");
    }

    return {
      status: "ok" as const,
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      is_new: isNew,
    };
  });
