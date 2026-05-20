// Mock auth + user profile. Stored in localStorage for the demo flow.
const KEY = "cozygift_user_v1";
const OTP_KEY = "cozygift_pending_otp_v1";

export interface UserProfile {
  id: string;
  phone: string;
  name: string;
  ref_code_used?: string;
  xp_balance: number;
  l_points_balance: number;
  level: number;
  created_at: number;
}

export interface PendingOtp {
  phone: string;
  code: string;
  sentAt: number;
}

export function loadUser(): UserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

export function saveUser(u: UserProfile) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(u));
}

export function updateUser(patch: Partial<UserProfile>): UserProfile | null {
  const u = loadUser();
  if (!u) return null;
  const next = { ...u, ...patch };
  saveUser(next);
  return next;
}

export function clearUser() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  localStorage.removeItem(OTP_KEY);
}

// Mock SMS gateway — generates a 4-digit code, stores it locally.
export async function sendOtp(phone: string): Promise<string> {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const pending: PendingOtp = { phone, code, sentAt: Date.now() };
  localStorage.setItem(OTP_KEY, JSON.stringify(pending));
  // Simulate network latency
  await new Promise((r) => setTimeout(r, 600));
  // In real life this would call SMS.ru / Twilio
  console.info("[mock SMS] code:", code);
  return code;
}

export function verifyOtp(phone: string, code: string): boolean {
  try {
    const raw = localStorage.getItem(OTP_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as PendingOtp;
    return p.phone === phone && p.code === code;
  } catch {
    return false;
  }
}

export function userExists(phone: string): boolean {
  const u = loadUser();
  return !!u && u.phone === phone;
}

export function createUser(input: {
  phone: string;
  name: string;
  ref_code_used?: string;
}): UserProfile {
  const hasRef = !!input.ref_code_used?.trim();
  const u: UserProfile = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Date.now()),
    phone: input.phone,
    name: input.name,
    ref_code_used: hasRef ? input.ref_code_used!.trim() : undefined,
    xp_balance: 0,
    l_points_balance: 100, // standard or referral bonus — both give +100
    level: 1,
    created_at: Date.now(),
  };
  saveUser(u);
  return u;
}

export function formatPhone(digits: string): string {
  // digits — only the 10 digits after +7
  const d = digits.padEnd(10, "_");
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}

export function extractDigits(value: string): string {
  return value.replace(/\D/g, "").replace(/^7/, "").slice(0, 10);
}
