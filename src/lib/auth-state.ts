// Telegram-based auth wrapper over Supabase.
// Реальный логин — через server function verifyTelegramCode (см. telegram-auth.functions.ts),
// которая создаёт/находит supabase-пользователя по telegram_id и возвращает access/refresh токены.
// Здесь — только утилиты загрузки/выхода и тип профиля.

import { supabase } from "@/integrations/supabase/client";

export interface UserProfile {
  user_id: string;
  display_name: string;
  balance: number;
  xp: number;
  level: number;
}

export async function loadUser(): Promise<UserProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("user_id, display_name, balance, xp, level")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data as UserProfile) ?? null;
}

export async function refreshProfile(): Promise<UserProfile | null> {
  return loadUser();
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Устанавливает сессию из токенов, полученных от server function. */
export async function setTelegramSession(access_token: string, refresh_token: string) {
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw new Error(error.message);
}
