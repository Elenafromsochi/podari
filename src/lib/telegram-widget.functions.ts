import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TRUSTED_DAYS = 30;
const WIDGET_AUTH_MAX_AGE_SEC = 86400; // Telegram рекомендация
const REG_TICKET_TTL_MS = 10 * 60 * 1000; // 10 минут на завершение регистрации

const deviceIdSchema = z.string().min(8).max(128);
const passwordSchema = z.string().min(8).max(128);

// ---------- Утилиты ----------

function userEmail(tgId: number | bigint) {
  return `tg_${tgId}@tg.podari.local`;
}

function userPassword(tgId: number) {
  // Совпадает с telegram-auth.functions.ts — используется как fallback-пароль
  // для пользователей, которые ещё не задали свой собственный пароль.
  const pepper = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "fallback-pepper";
  return createHash("sha256")
    .update(`tg-podari-v1:${tgId}:${pepper}`)
    .digest("hex");
}

function anonClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
  );
}

function safeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Проверка HMAC-подписи Telegram Login Widget (см. core.telegram.org/widgets/login#checking-authorization). */
function verifyWidgetSignature(payload: Record<string, unknown>): {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  auth_date: number;
} {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    console.error("[tg-widget] TELEGRAM_BOT_TOKEN missing");
    throw new Error("WIDGET_NOT_CONFIGURED");
  }

  const hash = String(payload.hash ?? "");
  if (!hash) throw new Error("WIDGET_INVALID_PAYLOAD");

  const dataCheckString = Object.keys(payload)
    .filter((k) => k !== "hash" && payload[k] !== undefined && payload[k] !== null)
    .sort()
    .map((k) => `${k}=${payload[k]}`)
    .join("\n");

  const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
  const expected = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!safeEqualHex(expected, hash)) {
    throw new Error("WIDGET_BAD_SIGNATURE");
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) throw new Error("WIDGET_INVALID_PAYLOAD");
  if (Math.floor(Date.now() / 1000) - authDate > WIDGET_AUTH_MAX_AGE_SEC) {
    throw new Error("WIDGET_EXPIRED");
  }

  const tgId = Number(payload.id);
  if (!Number.isFinite(tgId)) throw new Error("WIDGET_INVALID_PAYLOAD");

  return {
    telegram_id: tgId,
    username: (payload.username as string | undefined) ?? null,
    first_name: (payload.first_name as string | undefined) ?? null,
    last_name: (payload.last_name as string | undefined) ?? null,
    photo_url: (payload.photo_url as string | undefined) ?? null,
    auth_date: authDate,
  };
}

/** Серверная подпись «билета» регистрации, чтобы клиент не мог подменить telegram_id. */
function signRegistrationTicket(data: {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  photo_url: string | null;
}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const payload = {
    telegram_id: data.telegram_id,
    username: data.username,
    first_name: data.first_name,
    photo_url: data.photo_url,
    exp: Date.now() + REG_TICKET_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyRegistrationTicket(ticket: string): {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  photo_url: string | null;
} {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const [body, sig] = ticket.split(".");
  if (!body || !sig) throw new Error("TICKET_INVALID");
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  if (
    expected.length !== sig.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  ) {
    throw new Error("TICKET_BAD_SIGNATURE");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    throw new Error("TICKET_EXPIRED");
  }
  return {
    telegram_id: Number(payload.telegram_id),
    username: payload.username ?? null,
    first_name: payload.first_name ?? null,
    photo_url: payload.photo_url ?? null,
  };
}

async function rememberTrustedDevice(
  userId: string,
  deviceId: string,
  label: string,
) {
  const expiresAt = new Date(
    Date.now() + TRUSTED_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  await supabaseAdmin.from("trusted_devices").upsert(
    {
      user_id: userId,
      device_id: deviceId,
      label,
      last_seen_at: new Date().toISOString(),
      expires_at: expiresAt,
    },
    { onConflict: "user_id,device_id" },
  );
}

/**
 * Сессия для существующего пользователя через Supabase Admin generateLink (magiclink).
 * Возвращаем token_hash — клиент вызовет supabase.auth.verifyOtp.
 */
async function issueMagicLink(email: string) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    console.error("[tg-widget] generateLink failed", error);
    throw new Error("SESSION_ISSUE_FAILED");
  }
  return data.properties.hashed_token as string;
}

// ---------- Server functions ----------

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

    // Существует ли профиль?
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("user_id, telegram_id, telegram_username, display_name")
      .eq("telegram_id", verified.telegram_id)
      .maybeSingle();

    if (profile?.user_id) {
      // Обновим username/имя на актуальные из Telegram
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

    // Нет профиля → выдаём билет на регистрацию
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

    // На случай race condition — ещё раз проверим, не создан ли уже профиль.
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .eq("telegram_id", ticket.telegram_id)
      .maybeSingle();

    if (existing?.user_id) {
      // Уже есть — просто логиним и ставим устройство в trusted.
      const label = data.device_label?.trim() || "Web";
      await rememberTrustedDevice(existing.user_id, data.device_id, label);
      const token_hash = await issueMagicLink(userEmail(ticket.telegram_id));
      return { status: "ok" as const, token_hash, already_existed: true };
    }

    const email = userEmail(ticket.telegram_id);

    // Создаём пользователя сразу с пользовательским паролем
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
      // Возможно, пользователь успел создаться параллельно — пробуем как fallback
      if (createErr && /already/i.test(createErr.message)) {
        // Обновим пароль на введённый юзером
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

    // Достаём итогового user_id
    const { data: u2 } = await supabaseAdmin.auth.admin.listUsers();
    const user = u2?.users.find((x) => x.email === email);
    if (!user) throw new Error("USER_LOOKUP_FAILED");

    // Заполняем профиль (handle_new_user уже мог создать его при createUser)
    await supabaseAdmin
      .from("profiles")
      .update({
        display_name: data.display_name,
        telegram_id: ticket.telegram_id,
        telegram_username: ticket.username,
        password_set: true,
      })
      .eq("user_id", user.id);

    // Реферальный бонус, если применимо
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

    // Сразу логиним через signInWithPassword (пароль только что задан)
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
