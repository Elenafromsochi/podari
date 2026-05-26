import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const TRUSTED_DAYS = 30;
const WIDGET_AUTH_MAX_AGE_SEC = 86400; // Telegram рекомендация
const REG_TICKET_TTL_MS = 10 * 60 * 1000; // 10 минут на завершение регистрации

export function userEmail(tgId: number | bigint) {
  return `tg_${tgId}@tg.podari.local`;
}

export function userPassword(tgId: number) {
  // Совпадает с telegram-auth.functions.ts — fallback-пароль для пользователей,
  // которые ещё не задали свой собственный пароль.
  const pepper = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "fallback-pepper";
  return createHash("sha256")
    .update(`tg-podari-v1:${tgId}:${pepper}`)
    .digest("hex");
}

export function anonClient() {
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

/** Проверка HMAC-подписи Telegram Login Widget (core.telegram.org/widgets/login#checking-authorization). */
export function verifyWidgetSignature(payload: Record<string, unknown>): {
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
export function signRegistrationTicket(data: {
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

export function verifyRegistrationTicket(ticket: string): {
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

export async function rememberTrustedDevice(
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
export async function issueMagicLink(email: string) {
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
