import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  anonClient,
  issueMagicLink,
  rememberTrustedDevice,
  signRegistrationTicket,
  userEmail,
  verifyRegistrationTicket,
  verifyWidgetSignature,
} from "./telegram-widget.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const deviceIdSchema = z.string().min(8).max(128);
const passwordSchema = z.string().min(8).max(128);

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
 * Шаг 1. Принимаем подписанный payload от Telegram Login Widget.
 *   - Если пользователь существует → отдаём magic-link token_hash + ставим устройство в trusted.
 *   - Если нет → отдаём подписанный «билет» для шага регистрации.
 */
export const widgetSignIn = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        payload: widgetPayloadSchema,
        device_id: deviceIdSchema,
        device_label: z.string().trim().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = verifyWidgetSignature(
      data.payload as Record<string, unknown>,
    );

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("user_id, telegram_id, telegram_username, display_name")
      .eq("telegram_id", verified.telegram_id)
      .maybeSingle();

    if (profile?.user_id) {
      await supabaseAdmin
        .from("profiles")
        .update({
          telegram_username: verified.username ?? profile.telegram_username,
        })
        .eq("user_id", profile.user_id);

      const label = data.device_label?.trim() || "Web";
      await rememberTrustedDevice(profile.user_id, data.device_id, label);

      const token_hash = await issueMagicLink(userEmail(verified.telegram_id));

      return {
        status: "ok" as const,
        token_hash,
      };
    }

    const ticket = signRegistrationTicket({
      telegram_id: verified.telegram_id,
      username: verified.username,
      first_name: verified.first_name,
      photo_url: verified.photo_url,
    });

    return {
      status: "need_registration" as const,
      ticket,
      preview: {
        telegram_id: verified.telegram_id,
        username: verified.username,
        first_name: verified.first_name,
        photo_url: verified.photo_url,
      },
    };
  });

/**
 * Шаг 2. Регистрация: пользователь подтвердил данные и придумал пароль.
 */
export const widgetCompleteRegistration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        ticket: z.string().min(20).max(2048),
        display_name: z.string().trim().min(1).max(80),
        password: passwordSchema,
        device_id: deviceIdSchema,
        device_label: z.string().trim().max(120).optional(),
        referrer_id: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const ticket = verifyRegistrationTicket(data.ticket);

    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .eq("telegram_id", ticket.telegram_id)
      .maybeSingle();

    if (existing?.user_id) {
      const label = data.device_label?.trim() || "Web";
      await rememberTrustedDevice(existing.user_id, data.device_id, label);
      const token_hash = await issueMagicLink(userEmail(ticket.telegram_id));
      return { status: "ok" as const, token_hash, already_existed: true };
    }

    const email = userEmail(ticket.telegram_id);

    const { data: created, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: data.password,
        email_confirm: true,
        user_metadata: {
          display_name: data.display_name,
          telegram_id: ticket.telegram_id,
          telegram_username: ticket.username,
          referred_by: data.referrer_id ?? null,
        },
      });
    if (createErr || !created?.user) {
      console.error("[tg-widget] createUser failed", createErr);
      if (createErr && /already/i.test(createErr.message)) {
        const { data: u } = await supabaseAdmin.auth.admin.listUsers();
        const found = u?.users.find((x) => x.email === email);
        if (found) {
          await supabaseAdmin.auth.admin.updateUserById(found.id, {
            password: data.password,
          });
        }
      } else {
        throw new Error("USER_CREATE_FAILED");
      }
    }

    const { data: u2 } = await supabaseAdmin.auth.admin.listUsers();
    const user = u2?.users.find((x) => x.email === email);
    if (!user) throw new Error("USER_LOOKUP_FAILED");

    await supabaseAdmin
      .from("profiles")
      .update({
        display_name: data.display_name,
        telegram_id: ticket.telegram_id,
        telegram_username: ticket.username,
        password_set: true,
      })
      .eq("user_id", user.id);

    if (data.referrer_id && data.referrer_id !== user.id) {
      await supabaseAdmin
        .from("profiles")
        .update({ referred_by: data.referrer_id })
        .eq("user_id", user.id)
        .is("referred_by", null);
      await supabaseAdmin.rpc("apply_referral_bonus", { _new_user: user.id });
    }

    const label = data.device_label?.trim() || "Web";
    await rememberTrustedDevice(user.id, data.device_id, label);

    const anon = anonClient();
    const { data: signIn, error: signInErr } =
      await anon.auth.signInWithPassword({ email, password: data.password });
    if (signInErr || !signIn.session) {
      console.error("[tg-widget] post-register sign-in failed", signInErr);
      throw new Error("POST_REGISTER_SIGNIN_FAILED");
    }

    return {
      status: "ok" as const,
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      already_existed: false,
    };
  });
