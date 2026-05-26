import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (error) {
      console.error("[roles] load failed", error);
      return { roles: [] as string[], isAdmin: false };
    }
    const roles = (data ?? []).map((r) => r.role as string);
    return { roles, isAdmin: roles.includes("admin") };
  });
