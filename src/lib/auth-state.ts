// Phone-based auth wrapper over Supabase auth (этап A).
// Реальная регистрация/вход — через Supabase auth.
// Phone превращается в email `<digits>@phone.cozygift.local`,
// пароль детерминированно выводится из телефона (заглушка для демо).
// Код подтверждения генерится локально и показывается в тосте, как было.
//
// Когда подключите Twilio, можно переключить sendOtp/verify на supabase phone-auth.

import { supabase } from "@/integrations/supabase/client";

const OTP_KEY = "cozygift_pending_otp_v1";
const PHONE_DOMAIN = "phone.cozygift.local";

export interface UserProfile {
  user_id: string;
  display_name: string;
  balance: number;
  xp: number;
  level: number;
}

interface PendingOtp {
  phone: string;
  code: string;
  sentAt: number;
}

const phoneToEmail = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@${PHONE_DOMAIN}`;
};

// Детерминированный пароль, чтобы UX «вошёл по телефону + коду» работал.
// В реальном проде заменяется на phone-OTP через SMS-провайдера.
const phoneToPassword = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return `cz-phone-auth-v1-${digits}`;
};

// ---------- Профиль текущего пользователя ----------
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

// ---------- OTP (мок) ----------
export async function sendOtp(phone: string): Promise<string> {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const pending: PendingOtp = { phone, code, sentAt: Date.now() };
  if (typeof window !== "undefined") {
    localStorage.setItem(OTP_KEY, JSON.stringify(pending));
  }
  await new Promise((r) => setTimeout(r, 300));
  return code;
}

export function verifyOtp(phone: string, code: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(OTP_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as PendingOtp;
    return p.phone === phone && p.code === code;
  } catch {
    return false;
  }
}

function clearOtp() {
  if (typeof window !== "undefined") localStorage.removeItem(OTP_KEY);
}

// ---------- Вход / регистрация ----------
/**
 * Пробует войти. Возвращает true — если пользователь существовал и вошёл.
 * Возвращает false — если такого пользователя нет, нужно собрать имя и вызвать signUpWithPhone.
 */
export async function signInWithPhone(phone: string): Promise<boolean> {
  const email = phoneToEmail(phone);
  const password = phoneToPassword(phone);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // invalid_credentials => нет пользователя
    return false;
  }
  clearOtp();
  return true;
}

export async function signUpWithPhone(phone: string, displayName: string): Promise<UserProfile> {
  const email = phoneToEmail(phone);
  const password = phoneToPassword(phone);
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });
  if (error) throw new Error(error.message);
  // auto-confirm включён, поэтому сразу есть сессия. Если нет — войдём.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
    if (e2) throw new Error(e2.message);
  }
  clearOtp();
  // Триггер создал profile; читаем
  const profile = await loadUser();
  if (!profile) throw new Error("Profile not created");
  return profile;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// ---------- Утилиты для телефона ----------
export function formatPhone(digits: string): string {
  const d = digits.padEnd(10, "_");
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}

export function extractDigits(value: string): string {
  return value.replace(/\D/g, "").replace(/^7/, "").slice(0, 10);
}
