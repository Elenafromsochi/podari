import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Вход через VK ID (работает без VPN, в отличие от Telegram-бота).
// Поток: фронт получает access_token через VK ID SDK / One Tap (PKCE,
// уровень приложения «Публичное» — секрет на клиенте не нужен) и присылает
// его сюда. Сервер проверяет токен через api.vk.com/method/users.get —
// так нельзя подделать чужой id, потому что только настоящий VK-токен
// вернёт валидного пользователя. Затем создаём/находим supabase-юзера по
// синтетическому email vk_<id>@vk.podari.local и выдаём сессию.

const VK_API_VERSION = "5.199";

function userPassword(vkId: number) {
  const pepper = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "fallback-pepper";
  return createHash("sha256")
    .update(`vk-podari-v1:${vkId}:${pepper}`)
    .digest("hex");
}

function userEmail(vkId: number) {
  return `vk_${vkId}@vk.podari.local`;
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
    console.error("[vk-auth] FIND_USER_FAILED", error);
    return null;
  }
  return ((data?.user as { id?: string } | undefined)?.id) ?? null;
}

type VkUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  screen_name?: string;
};

/** Проверяет access_token через VK API и возвращает профиль пользователя. */
async function fetchVkUser(accessToken: string): Promise<VkUser> {
  const url = new URL("https://api.vk.com/method/users.get");
  url.searchParams.set("fields", "screen_name");
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("v", VK_API_VERSION);

  let payload: {
    response?: VkUser[];
    error?: { error_code?: number; error_msg?: string };
  };
  try {
    const resp = await fetch(url.toString());
    payload = (await resp.json()) as typeof payload;
  } catch (e) {
    console.error("[vk-auth] VK_API_UNREACHABLE", e);
    throw new Error("VK_API_UNREACHABLE");
  }

  if (payload.error) {
    console.error("[vk-auth] VK_TOKEN_INVALID", payload.error);
    throw new Error("VK_TOKEN_INVALID");
  }

  const vkUser = payload.response?.[0];
  if (!vkUser?.id) {
    console.error("[vk-auth] VK_USER_EMPTY", payload);
    throw new Error("VK_TOKEN_INVALID");
  }
  return vkUser;
}

/** Вход по VK access_token: проверяем токен, выдаём supabase-сессию. */
export const loginWithVk = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        access_token: z.string().min(1),
        referrer_id: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const vkUser = await fetchVkUser(data.access_token);
    const vkId = Number(vkUser.id);

    const displayName =
      [vkUser.first_name, vkUser.last_name].filter(Boolean).join(" ").trim() ||
      vkUser.screen_name ||
      `Гость ${vkId}`;
    const email = userEmail(vkId);
    const password = userPassword(vkId);

    const anon = createClient(
      (process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL)!,
      (process.env.SUPABASE_PUBLISHABLE_KEY ||
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)!,
    );

    let session = (await anon.auth.signInWithPassword({ email, password }))
      .data.session;

    const referredBy: string | null = data.referrer_id ?? null;

    let isNewUser = false;
    if (!session) {
      const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          vk_id: vkId,
          vk_screen_name: vkUser.screen_name ?? null,
          referred_by: referredBy,
        },
      });
      if (createErr) {
        if (/already/i.test(createErr.message)) {
          // Аккаунт уже есть, но вход по паролю не прошёл — значит пароль был
          // задан с другим «перцем» (раньше env был пуст). Лечим: переустанавливаем
          // пароль на актуальный и подтверждаем email.
          const existingId = await findAuthUserId(email);
          if (existingId) {
            const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
              existingId,
              { password, email_confirm: true },
            );
            if (updErr) console.error("[vk-auth] PASSWORD_RESET_FAILED", updErr);
          }
        } else {
          console.error("[vk-auth] USER_CREATE_FAILED", createErr);
          throw new Error("USER_CREATE_FAILED");
        }
      } else {
        isNewUser = true;
      }
      const r = await anon.auth.signInWithPassword({ email, password });
      if (r.error || !r.data.session) {
        console.error("[vk-auth] SIGNIN_FAILED", r.error);
        throw new Error("SIGNIN_FAILED");
      }
      session = r.data.session;
    }

    await supabaseAdmin
      .from("profiles")
      .update({ display_name: displayName })
      .eq("user_id", session.user.id);

    if (isNewUser && referredBy && referredBy !== session.user.id) {
      // Бонус пригласившему/новичку начисляет триггер БД при проставлении referred_by.
      await supabaseAdmin
        .from("profiles")
        .update({ referred_by: referredBy })
        .eq("user_id", session.user.id)
        .is("referred_by", null);
    }

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      is_new: isNewUser,
    };
  });
