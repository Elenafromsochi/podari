import { createServerFn } from "@tanstack/react-start";
import { createClient, type Session } from "@supabase/supabase-js";
import { createHash, createHmac, randomBytes } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyUser } from "@/lib/notify.server";
import { tgApi } from "@/lib/telegram-api";
import { toProxiedStorageUrl } from "@/lib/proxied-storage-url.server";

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "Podari_podarki_bot";
const NONCE_TTL_MS = 5 * 60 * 1000;

/**
 * Лучшая попытка подтянуть фото профиля из Telegram при первом входе.
 * Скачивает самое крупное фото у бота и заливает в Storage — ссылки
 * файлов Telegram временные, поэтому пересохраняем в свой бакет.
 * Никогда не бросает исключение — сбой не должен ломать вход.
 */
async function importTelegramAvatar(tgId: number, userId: string): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    const photos = (await tgApi("getUserProfilePhotos", {
      user_id: tgId,
      limit: 1,
    })) as { result?: { photos?: Array<Array<{ file_id: string }>> } };
    const sizes = photos?.result?.photos?.[0];
    const fileId = sizes?.[sizes.length - 1]?.file_id;
    if (!fileId) return;
    const fileInfo = (await tgApi("getFile", { file_id: fileId })) as {
      result?: { file_path?: string };
    };
    const filePath = fileInfo?.result?.file_path;
    if (!filePath) return;
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!res.ok) return;
    const buf = new Uint8Array(await res.arrayBuffer());
    const ext = filePath.split(".").pop() || "jpg";
    const storagePath = `avatars/${userId}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("gift-images")
      .upload(storagePath, buf, { contentType: "image/jpeg", upsert: true });
    if (upErr) return;
    const { data: pub } = supabaseAdmin.storage.from("gift-images").getPublicUrl(storagePath);
    await supabaseAdmin
      .from("profiles")
      .update({ avatar_url: toProxiedStorageUrl(pub.publicUrl) })
      .eq("user_id", userId)
      .is("avatar_url", null);
  } catch (e) {
    console.error("[telegram-auth] AVATAR_IMPORT_FAILED", e);
  }
}

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

/**
 * Общая часть входа через Telegram: находит/создаёт supabase-юзера по
 * tgId, выдаёт сессию, подтягивает фото, начисляет реферальный бонус.
 * Используется и «долгим» способом (бот + polling), и мгновенным —
 * через подписанные initData, когда сервис открыт как Telegram Web App.
 */
async function findOrCreateTelegramSession(params: {
  tgId: number;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  referredBy: string | null;
}): Promise<{ session: Session; isNewUser: boolean }> {
  const { tgId, telegramUsername, telegramFirstName } = params;
  const displayName = telegramUsername || telegramFirstName || `Гость ${tgId}`;
  const email = userEmail(tgId);
  const password = userPassword(tgId);

  const anon = createClient(
    (process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL)!,
    (process.env.SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)!,
  );

  let session = (await anon.auth.signInWithPassword({ email, password })).data.session;

  // Pending referral: если не передали явно — смотрим webhook-фолбэк.
  let referredBy = params.referredBy;
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
        telegram_username: telegramUsername,
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
          const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(existingId, {
            password,
            email_confirm: true,
          });
          if (updErr) console.error("[telegram-auth] PASSWORD_RESET_FAILED", updErr);
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
      telegram_username: telegramUsername,
      display_name: displayName,
    })
    .eq("user_id", session.user.id);

  // Фото профиля подтягиваем в фоне — не задерживаем вход. Только если у
  // человека ещё нет своего (не перетираем то, что он сам загрузил/поменял).
  {
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("avatar_url")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (prof && !(prof as { avatar_url?: string | null }).avatar_url) {
      void importTelegramAvatar(tgId, session.user.id);
    }
  }

  if (isNewUser && referredBy && referredBy !== session.user.id) {
    // Бонус +50 пригласившему и +1 балл новичку начисляет триггер БД
    // (handle_referral_bonus) автоматически при проставлении referred_by.
    await supabaseAdmin
      .from("profiles")
      .update({ referred_by: referredBy })
      .eq("user_id", session.user.id)
      .is("referred_by", null);
    await supabaseAdmin.from("telegram_referrals").delete().eq("telegram_id", tgId);
    // Уведомляем пригласившего, что друг присоединился.
    await notifyUser(
      referredBy,
      `👋 Твой друг ${displayName} присоединился по твоей ссылке! Тебе +50 XP 💚`,
      "/friends",
    );
  }

  return { session, isNewUser };
}

/**
 * Проверяет подпись initData, которую Telegram кладёт в Web App при
 * открытии (кнопка меню бота и т.п.) — стандартный алгоритм Telegram:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Возвращает разобранные поля, если подпись верна и данные не протухли.
 */
function verifyTelegramWebAppInitData(
  initData: string,
): { id: number; username: string | null; first_name: string | null } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computedHash !== hash) return null;

  // Данные старше суток не принимаем — на случай, если ссылка «утекла».
  const authDate = Number(params.get("auth_date") ?? "0");
  if (!authDate || Date.now() - authDate * 1000 > 24 * 60 * 60 * 1000) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw) as { id?: number; username?: string; first_name?: string };
    if (!user.id) return null;
    return {
      id: user.id,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
    };
  } catch {
    return null;
  }
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
    const { session, isNewUser } = await findOrCreateTelegramSession({
      tgId,
      telegramUsername: row.telegram_username,
      telegramFirstName: row.telegram_first_name,
      referredBy: (row as { referrer_id?: string | null }).referrer_id ?? null,
    });

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

/**
 * Мгновенный вход, когда сервис открыт как Telegram Web App (кнопка меню
 * бота и подобные): Telegram сам передаёт подписанные данные пользователя
 * прямо на странице (через window.Telegram.WebApp.initData) — не нужно
 * ни диплинка на бота, ни ожидания подтверждения. Проверяем подпись и
 * сразу выдаём сессию по тому же tgId, что и в обычном входе через бота.
 */
export const loginWithTelegramWebApp = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ init_data: z.string().min(1).max(4000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const verified = verifyTelegramWebAppInitData(data.init_data);
    if (!verified) throw new Error("INIT_DATA_INVALID");

    const { session, isNewUser } = await findOrCreateTelegramSession({
      tgId: verified.id,
      telegramUsername: verified.username,
      telegramFirstName: verified.first_name,
      referredBy: null,
    });

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      is_new: isNewUser,
    };
  });
