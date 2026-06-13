// Telegram-based auth wrapper over Supabase.
// Реальный логин — через completeTelegramLogin (см. telegram-auth.functions.ts):
// пользователь подтверждает вход в боте, а серверная функция создаёт/находит
// supabase-юзера по telegram_id и возвращает access/refresh токены.
// Здесь — только утилиты загрузки/выхода и тип профиля.

import { supabase } from "@/integrations/supabase/client";
import { checkLevelUp } from "@/lib/level-up";

export interface UserProfile {
  user_id: string;
  display_name: string;
  balance: number;
  xp: number;
  level: number;
  password_set: boolean;
  telegram_username: string | null;
}

const PROFILE_CACHE_KEY = "cozygift_last_profile";

function readCachedProfile(uid: string): UserProfile | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as UserProfile;
    return p && p.user_id === uid ? p : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(p: UserProfile) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p));
  } catch {
    /* noop */
  }
}

export async function loadUser(): Promise<UserProfile | null> {
  // getSession() читает сохранённую сессию локально и при просроченном
  // access-токене молча обновляет его по refresh_token. В отличие от
  // getUser(), который делает сетевой запрос и при просрочке/обрыве связи
  // возвращает «нет пользователя» — из-за чего человека постоянно
  // выкидывало на экран входа, хотя вход был действителен.
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, balance, xp, level, password_set, telegram_username")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    // Связь с базой моргнула — НЕ выкидываем из аккаунта: сессия жива,
    // отдаём последний известный профиль, числа обновятся при следующем запросе.
    return readCachedProfile(uid);
  }

  const profile = (data as UserProfile) ?? null;
  if (profile) {
    writeCachedProfile(profile);
    checkLevelUp(profile.level);
  }
  return profile;
}

export async function refreshProfile(): Promise<UserProfile | null> {
  return loadUser();
}

export async function signOut() {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    } catch {
      /* noop */
    }
  }
  await supabase.auth.signOut();
}

/** Устанавливает сессию из токенов, полученных от server function. */
export async function setTelegramSession(access_token: string, refresh_token: string) {
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw new Error(error.message);
}
