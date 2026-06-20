import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyUser } from "@/lib/notify.server";

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "Podari_podarki_bot";
const NONCE_TTL_MS = 5 * 60 * 1000;

function makeNonce() {
  return randomBytes(9).toString("base64url");
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

/** Находит id существующего auth-пользователя по email (через admin API). */
async function findAuthUserId(email: string): Promise<string | null> {
  // generateLink возвращает объект пользователя для существующего email
  // (письмо при этом не отправляется — нам нужен только user.id).
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error) {
    console.error("[telegram-auth] FIND_USER_FAILED", error);
    return null;
  }
  return ((data?.user as { id?: string } | undefined)?.id) ?? null;
}

/** Шаг 1: фронт просит nonce, открывает deep-link на бота. */
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

/** Шаг 2: фронт опрашивает статус подтверждения в боте. */
export const pollTelegramLogin = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ nonce: z.string().min(8).max(32) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("auth_nonces")
      .select("telegram_id, expires_at, consumed_at, approved_at, rejected_at")
      .eq("nonce", data.nonce)
      .maybeSingle();

    if (!row) return { status: "not_found" as const };
    if (row.consumed_at) return { status: "consumed" as const };
    if (row.rejected_at) return { status: "rejected" as const };
    if (new Date(row.expires_at).getTime() < Date.now())
      return { status: "expired" as const };
    if (row.approved_at) return { status: "approved" as const };
    if (row.telegram_id) return { status: "opened" as const };
    return { status: "waiting" as const };
  });

/** Шаг 3: пользователь подтвердил вход в боте — выдаём сессию. */
export const completeTelegramLogin = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ nonce: z.string().min(8).max(32) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("auth_nonces")
      .select(
        "nonce, telegram_id, telegram_username, telegram_first_name, expires_at, consumed_at, approved_at, rejected_at, referrer_id",
      )
      .eq("nonce", data.nonce)
      .maybeSingle();

    if (rowErr) {
      console.error("[telegram-auth] NONCE_LOOKUP_FAILED", rowErr);
      throw new Error("NONCE_LOOKUP_FAILED");
    }
    if (!row) throw new Error("NONCE_NOT_FOUND");
    if (row.consumed_at) throw new Error("NONCE_CONSUMED");
    if (row.rejected_at) throw new Error("NONCE_REJECTED");
    if (new Date(row.expires_at).getTime() < Date.now())
      throw new Error("NONCE_EXPIRED");
    if (!row.approved_at || !row.telegram_id)
      throw new Error("NOT_APPROVED");

    const tgId = Number(row.telegram_id);
    const displayName =
      row.telegram_username || row.telegram_first_name || `Гость ${tgId}`;
    const email = userEmail(tgId);
    const password = userPassword(tgId);

    const anon = createClient(
      (process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL)!,
      (process.env.SUPABASE_PUBLISHABLE_KEY ||
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)!,
    );

    let session = (await anon.auth.signInWithPassword({ email, password }))
      .data.session;

    // Pending referral: nonce → webhook fallback
    let referredBy: string | null =
      (row as { referrer_id?: string | null }).referrer_id ?? null;
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
      if (createErr) {
        if (/already/i.test(createErr.message)) {
          // Аккаунт уже есть, но первый вход по паролю не прошёл — значит
          // пароль был задан с другим "перцем" (раньше env был пуст).
          // Лечим: пере-устанавливаем пароль на актуальный и подтверждаем email.
          const existingId = await findAuthUserId(email);
          if (existingId) {
            const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
              existingId,
              { password, email_confirm: true },
            );
            if (updErr)
              console.error("[telegram-auth] PASSWORD_RESET_FAILED", updErr);
          }
        } else {
          console.error("[telegram-auth] USER_CREATE_FAILED", createErr);
          throw new Error("USER_CREATE_FAILED");
        }
      } else {
        isNewUser = true;
      }
      const r = await anon.auth.signInWithPassword({ email, password });
      if (r.error || !r.data.session) {
        console.error("[telegram-auth] SIGNIN_FAILED", r.error);
        throw new Error("SIGNIN_FAILED");
      }
      session = r.data.session;
    }

    await supabaseAdmin
      .from("profiles")
      .update({
        telegram_id: tgId,
        telegram_username: row.telegram_username,
        display_name: displayName,
      })
      .eq("user_id", session.user.id);

    if (isNewUser && referredBy && referredBy !== session.user.id) {
      // Бонус +50 пригласившему и +1 балл новичку начисляет триггер БД
      // (handle_referral_bonus) автоматически при проставлении referred_by.
      await supabaseAdmin
        .from("profiles")
        .update({ referred_by: referredBy })
        .eq("user_id", session.user.id)
        .is("referred_by", null);
      await supabaseAdmin
        .from("telegram_referrals")
        .delete()
        .eq("telegram_id", tgId);
      // Уведомляем пригласившего, что друг присоединился.
      await notifyUser(
        referredBy,
        `👋 Твой друг ${displayName} присоединился по твоей ссылке! Тебе +50 XP 💚`,
        "/?tab=profile",
      );
    }

    await supabaseAdmin
      .from("auth_nonces")
      .update({ consumed_at: new Date().toISOString() })
      .eq("nonce", row.nonce);

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      is_new: isNewUser,
    };
  });
