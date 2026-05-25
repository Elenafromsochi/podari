import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BOT_USERNAME = "Podari_podarki_bot";
const NONCE_TTL_MS = 5 * 60 * 1000;

function makeNonce() {
  return randomBytes(9).toString("base64url"); // ~12 chars, URL-safe
}

function userPassword(tgId: number) {
  const pepper = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "fallback-pepper";
  return createHash("sha256")
    .update(`tg-podari-v1:${tgId}:${pepper}`)
    .digest("hex");
}

function userEmail(tgId: number) {
  return `tg_${tgId}@tg.podari.local`;
}

/** Шаг 1: фронтенд просит nonce, открывает deep-link на бота. */
export const startTelegramLogin = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        referrer_id: z.string().uuid().optional().nullable(),
      })
      .optional()
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const nonce = makeNonce();
    const { error } = await supabaseAdmin.from("auth_nonces").insert({
      nonce,
      expires_at: new Date(Date.now() + NONCE_TTL_MS).toISOString(),
      referrer_id: data?.referrer_id ?? null,
    });
    if (error) {
      console.error("[telegram-auth] NONCE_CREATE_FAILED", error);
      throw new Error("NONCE_CREATE_FAILED");
    }

    return {
      nonce,
      bot_username: BOT_USERNAME,
      deep_link: `https://t.me/${BOT_USERNAME}?start=${nonce}`,
    };
  });

/** Шаг 2: фронтенд опрашивает — пользователь уже нажал Start? */
export const pollTelegramLogin = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ nonce: z.string().min(8).max(32) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("auth_nonces")
      .select("code, telegram_id, expires_at, consumed_at")
      .eq("nonce", data.nonce)
      .maybeSingle();

    if (!row) return { status: "not_found" as const };
    if (row.consumed_at) return { status: "consumed" as const };
    if (new Date(row.expires_at).getTime() < Date.now())
      return { status: "expired" as const };
    if (row.code && row.telegram_id)
      return { status: "code_sent" as const };
    return { status: "waiting" as const };
  });

/** Шаг 3: пользователь ввёл код из Telegram — выдаём сессию. */
export const verifyTelegramCode = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        nonce: z.string().min(8).max(32),
        code: z.string().regex(/^\d{4}$/),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("auth_nonces")
      .select(
        "nonce, code, telegram_id, telegram_username, telegram_first_name, expires_at, consumed_at, referrer_id",
      )
      .eq("nonce", data.nonce)
      .maybeSingle();

    if (rowErr) {
      console.error("[telegram-auth] NONCE_LOOKUP_FAILED", rowErr);
      throw new Error("NONCE_LOOKUP_FAILED");
    }
    if (!row) throw new Error("NONCE_NOT_FOUND");
    if (row.consumed_at) throw new Error("NONCE_CONSUMED");
    if (new Date(row.expires_at).getTime() < Date.now())
      throw new Error("NONCE_EXPIRED");
    if (!row.code || !row.telegram_id) throw new Error("WAITING_FOR_TELEGRAM");
    if (row.code !== data.code) throw new Error("WRONG_CODE");

    const tgId = Number(row.telegram_id);
    const displayName =
      row.telegram_username || row.telegram_first_name || `Гость ${tgId}`;
    const email = userEmail(tgId);
    const password = userPassword(tgId);

    // Try sign-in; if fails — create user.
    const anon = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
    );

    let session = (await anon.auth.signInWithPassword({ email, password }))
      .data.session;

    // Look up pending referral: сначала из nonce (ссылка из приложения), потом из webhook (deep-link бота)
    let referredBy: string | null = (row as { referrer_id?: string | null }).referrer_id ?? null;
    if (!referredBy) {
      const { data: refRow } = await supabaseAdmin
        .from("telegram_referrals")
        .select("referred_by")
        .eq("telegram_id", tgId)
        .maybeSingle();
      referredBy = (refRow?.referred_by as string | undefined) ?? null;
    }

    let isNewUser = false;
    if (!session) {
      const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          telegram_id: tgId,
          telegram_username: row.telegram_username,
          referred_by: referredBy,
        },
      });
      if (createErr && !/already/i.test(createErr.message)) {
        throw new Error(createErr.message);
      }
      isNewUser = !createErr;
      const r = await anon.auth.signInWithPassword({ email, password });
      if (r.error || !r.data.session) {
        throw new Error(r.error?.message ?? "SIGNIN_FAILED");
      }
      session = r.data.session;
    }

    // Sync profile fields
    await supabaseAdmin
      .from("profiles")
      .update({
        telegram_id: tgId,
        telegram_username: row.telegram_username,
        display_name: displayName,
      })
      .eq("user_id", session.user.id);

    // Referral bonus — только для нового пользователя и только если referrer ≠ сам себе
    if (isNewUser && referredBy && referredBy !== session.user.id) {
      // На случай, если handle_new_user не подтянул (не должно случаться, но страхуемся)
      await supabaseAdmin
        .from("profiles")
        .update({ referred_by: referredBy })
        .eq("user_id", session.user.id)
        .is("referred_by", null);
      await supabaseAdmin.rpc("apply_referral_bonus", {
        _new_user: session.user.id,
      });
      // Подчищаем pending-запись, чтобы не сработала повторно
      await supabaseAdmin
        .from("telegram_referrals")
        .delete()
        .eq("telegram_id", tgId);
    }

    // Mark nonce consumed
    await supabaseAdmin
      .from("auth_nonces")
      .update({ consumed_at: new Date().toISOString() })
      .eq("nonce", row.nonce);

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    };
  });
