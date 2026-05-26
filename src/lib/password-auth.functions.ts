import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TRUSTED_DAYS = 30;
const CODE_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;

const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((v) => v.replace(/^@/, "").toLowerCase());

const passwordSchema = z.string().min(8).max(128);
const deviceIdSchema = z.string().min(8).max(128);
const codeSchema = z.string().regex(/^\d{4}$/);

function makeCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function sendTelegramCode(chatId: number, code: string, label: string) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    console.error("[password-auth] Telegram secrets missing");
    throw new Error("TELEGRAM_NOT_CONFIGURED");
  }
  const text = `🔐 Подари — код подтверждения входа\n\nКод: ${code}\n\nУстройство: ${label}\nКод действует ${CODE_TTL_MIN} минут.\n\nЕсли это не вы — смените пароль в личном кабинете.`;
  const res = await fetch(
    "https://connector-gateway.lovable.dev/telegram/sendMessage",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[password-auth] sendTelegramCode failed", res.status, body);
    throw new Error("TELEGRAM_SEND_FAILED");
  }
}

function userEmail(tgId: number | bigint) {
  return `tg_${tgId}@tg.podari.local`;
}

function anonClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
  );
}

/**
 * Step 1. Username + password.
 *   - Если устройство доверенное → сразу токены.
 *   - Иначе → шлём код в Telegram, возвращаем challenge_id.
 */
export const loginWithPassword = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        username: usernameSchema,
        password: passwordSchema,
        device_id: deviceIdSchema,
        device_label: z.string().trim().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // 1. Find profile by username (case-insensitive)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("user_id, telegram_id, telegram_username, password_set")
      .ilike("telegram_username", data.username)
      .limit(1)
      .maybeSingle();

    if (!profile?.telegram_id || !profile.user_id) {
      // Общая ошибка, чтобы не палить существование @username
      throw new Error("INVALID_CREDENTIALS");
    }
    if (!profile.password_set) {
      throw new Error("PASSWORD_NOT_SET");
    }

    // 2. Verify password via anon sign-in
    const email = userEmail(profile.telegram_id);
    const anon = anonClient();
    const { data: signIn, error: signInErr } =
      await anon.auth.signInWithPassword({ email, password: data.password });
    if (signInErr || !signIn.session) {
      throw new Error("INVALID_CREDENTIALS");
    }

    // 3. Check trusted device
    const { data: trusted } = await supabaseAdmin
      .from("trusted_devices")
      .select("user_id, expires_at")
      .eq("user_id", profile.user_id)
      .eq("device_id", data.device_id)
      .maybeSingle();

    const isTrusted =
      trusted && new Date(trusted.expires_at).getTime() > Date.now();

    if (isTrusted) {
      await supabaseAdmin
        .from("trusted_devices")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("user_id", profile.user_id)
        .eq("device_id", data.device_id);
      return {
        status: "ok" as const,
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
      };
    }

    // 4. New device → generate code, send via Telegram, store tokens in challenge
    const code = makeCode();
    const label = data.device_label?.trim() || "Web";
    const { data: chal, error: chalErr } = await supabaseAdmin
      .from("device_login_codes")
      .insert({
        user_id: profile.user_id,
        device_id: data.device_id,
        code,
        expires_at: new Date(
          Date.now() + CODE_TTL_MIN * 60 * 1000,
        ).toISOString(),
        pending_access_token: signIn.session.access_token,
        pending_refresh_token: signIn.session.refresh_token,
      })
      .select("id")
      .single();

    if (chalErr || !chal) {
      console.error("[password-auth] challenge insert failed", chalErr);
      throw new Error("CHALLENGE_CREATE_FAILED");
    }

    try {
      await sendTelegramCode(Number(profile.telegram_id), code, label);
    } catch (e) {
      // удалим challenge, чтобы не висел впустую
      await supabaseAdmin.from("device_login_codes").delete().eq("id", chal.id);
      throw e;
    }

    return {
      status: "need_2fa" as const,
      challenge_id: chal.id as string,
    };
  });

/**
 * Step 2. Confirm one-time code, mark device trusted (if remember), return tokens.
 */
export const confirmDeviceCode = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        challenge_id: z.string().uuid(),
        code: codeSchema,
        device_id: deviceIdSchema,
        device_label: z.string().trim().max(120).optional(),
        remember: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: chal, error: chalErr } = await supabaseAdmin
      .from("device_login_codes")
      .select(
        "id, user_id, device_id, code, attempts, expires_at, consumed_at, pending_access_token, pending_refresh_token",
      )
      .eq("id", data.challenge_id)
      .maybeSingle();

    if (chalErr || !chal) throw new Error("CHALLENGE_NOT_FOUND");
    if (chal.consumed_at) throw new Error("CHALLENGE_CONSUMED");
    if (new Date(chal.expires_at).getTime() < Date.now())
      throw new Error("CHALLENGE_EXPIRED");
    if (chal.device_id !== data.device_id) throw new Error("DEVICE_MISMATCH");
    if (chal.attempts >= MAX_ATTEMPTS) throw new Error("TOO_MANY_ATTEMPTS");

    if (chal.code !== data.code) {
      await supabaseAdmin
        .from("device_login_codes")
        .update({ attempts: chal.attempts + 1 })
        .eq("id", chal.id);
      throw new Error("WRONG_CODE");
    }

    if (!chal.pending_access_token || !chal.pending_refresh_token) {
      throw new Error("TOKENS_MISSING");
    }

    // mark consumed, wipe tokens from row
    await supabaseAdmin
      .from("device_login_codes")
      .update({
        consumed_at: new Date().toISOString(),
        pending_access_token: null,
        pending_refresh_token: null,
      })
      .eq("id", chal.id);

    if (data.remember) {
      const expiresAt = new Date(
        Date.now() + TRUSTED_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const label = data.device_label?.trim() || "Web";
      await supabaseAdmin.from("trusted_devices").upsert(
        {
          user_id: chal.user_id,
          device_id: chal.device_id,
          label,
          last_seen_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
        { onConflict: "user_id,device_id" },
      );
    }

    return {
      access_token: chal.pending_access_token,
      refresh_token: chal.pending_refresh_token,
    };
  });

/**
 * Authenticated user sets/changes password.
 * Also marks current device as trusted.
 */
export const setPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        password: passwordSchema,
        device_id: deviceIdSchema,
        device_label: z.string().trim().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { error: updErr } =
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: data.password,
      });
    if (updErr) {
      console.error("[password-auth] updateUserById failed", updErr);
      throw new Error(updErr.message || "PASSWORD_UPDATE_FAILED");
    }

    await supabaseAdmin
      .from("profiles")
      .update({ password_set: true, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    const expiresAt = new Date(
      Date.now() + TRUSTED_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const label = data.device_label?.trim() || "Web";
    await supabaseAdmin.from("trusted_devices").upsert(
      {
        user_id: userId,
        device_id: data.device_id,
        label,
        last_seen_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: "user_id,device_id" },
    );

    return { ok: true as const };
  });

export const listTrustedDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("trusted_devices")
      .select("device_id, label, last_seen_at, expires_at, created_at")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const revokeTrustedDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ device_id: deviceIdSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("trusted_devices")
      .delete()
      .eq("user_id", userId)
      .eq("device_id", data.device_id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
