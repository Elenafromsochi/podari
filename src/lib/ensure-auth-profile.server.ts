import { supabaseAdmin } from "@/integrations/supabase/client.server";

type AuthProfileIdentity = {
  userId: string;
  displayName: string;
  telegramId?: number;
  telegramUsername?: string | null;
};

/**
 * Keeps social sign-in usable even if the auth.users profile trigger was lost
 * during a database restore. The normal trigger still creates the profile;
 * this idempotent upsert is the server-side safety net.
 */
export async function ensureAuthProfile(identity: AuthProfileIdentity) {
  const profile: {
    user_id: string;
    display_name: string;
    telegram_id?: number;
    telegram_username?: string | null;
  } = {
    user_id: identity.userId,
    display_name: identity.displayName,
  };

  if (identity.telegramId !== undefined) {
    profile.telegram_id = identity.telegramId;
    profile.telegram_username = identity.telegramUsername ?? null;
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .upsert(profile, { onConflict: "user_id" });

  if (error) {
    console.error("[auth-profile] UPSERT_FAILED", error);
    throw new Error("PROFILE_UPSERT_FAILED");
  }
}
