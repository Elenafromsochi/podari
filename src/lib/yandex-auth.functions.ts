import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Вход через Яндекс ID (работает в России без VPN, как и VK).
// Поток: фронт по неявному OAuth (response_type=token) получает access_token
// и присылает сюда. Сервер проверяет токен через login.yandex.ru/info —
// подделать чужой id нельзя, только настоящий токен вернёт валидного юзера.
// Затем создаём/находим supabase-юзера по синтетическому email
// yandex_<id>@yandex.podari.local и выдаём сессию (та же схема, что у VK).

function userPassword(yid: string) {
  const pepper = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "fallback-pepper";
  return createHash("sha256").update(`yandex-podari-v1:${yid}:${pepper}`).digest("hex");
}

function userEmail(yid: string) {
  return `yandex_${yid}@yandex.podari.local`;
}

/** Находит id существующего auth-пользователя по email (через admin API). */
async function findAuthUserId(email: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error) {
    console.error("[yandex-auth] FIND_USER_FAILED", error);
    return null;
  }
  return ((data?.user as { id?: string } | undefined)?.id) ?? null;
}

type YandexUser = {
  id: string;
  display_name?: string;
  real_name?: string;
  first_name?: string;
  last_name?: string;
  login?: string;
  default_email?: string;
};

/** Проверяет OAuth-токен через Яндекс и возвращает профиль пользователя. */
async function fetchYandexUser(accessToken: string): Promise<YandexUser> {
  let resp: Response;
  try {
    resp = await fetch("https://login.yandex.ru/info?format=json", {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
  } catch (e) {
    console.error("[yandex-auth] YANDEX_API_UNREACHABLE", e);
    throw new Error("YANDEX_API_UNREACHABLE");
  }
  if (!resp.ok) {
    console.error("[yandex-auth] YANDEX_TOKEN_INVALID", resp.status);
    throw new Error("YANDEX_TOKEN_INVALID");
  }
  const u = (await resp.json()) as YandexUser;
  if (!u?.id) {
    console.error("[yandex-auth] YANDEX_USER_EMPTY", u);
    throw new Error("YANDEX_TOKEN_INVALID");
  }
  return u;
}

/** Вход по Яндекс access_token: проверяем токен, выдаём supabase-сессию. */
export const loginWithYandex = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        access_token: z.string().min(1),
        referrer_id: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const yu = await fetchYandexUser(data.access_token);
    const yid = String(yu.id);

    const displayName =
      (yu.display_name || yu.real_name || "").trim() ||
      [yu.first_name, yu.last_name].filter(Boolean).join(" ").trim() ||
      yu.login ||
      `Гость ${yid.slice(-4)}`;
    const email = userEmail(yid);
    const password = userPassword(yid);

    const anon = createClient(
      (process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL)!,
      (process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)!,
    );

    let session = (await anon.auth.signInWithPassword({ email, password })).data.session;
    const referredBy: string | null = data.referrer_id ?? null;

    let isNewUser = false;
    if (!session) {
      const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          yandex_id: yid,
          yandex_login: yu.login ?? null,
          referred_by: referredBy,
        },
      });
      if (createErr) {
        if (/already/i.test(createErr.message)) {
          const existingId = await findAuthUserId(email);
          if (existingId) {
            const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(existingId, {
              password,
              email_confirm: true,
            });
            if (updErr) console.error("[yandex-auth] PASSWORD_RESET_FAILED", updErr);
          }
        } else {
          console.error("[yandex-auth] USER_CREATE_FAILED", createErr);
          throw new Error("USER_CREATE_FAILED");
        }
      } else {
        isNewUser = true;
      }
      const r = await anon.auth.signInWithPassword({ email, password });
      if (r.error || !r.data.session) {
        console.error("[yandex-auth] SIGNIN_FAILED", r.error);
        throw new Error("SIGNIN_FAILED");
      }
      session = r.data.session;
    }

    await supabaseAdmin
      .from("profiles")
      .update({ display_name: displayName })
      .eq("user_id", session.user.id);

    if (isNewUser && referredBy && referredBy !== session.user.id) {
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
