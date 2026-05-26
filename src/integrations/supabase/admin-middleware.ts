import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";
import { supabaseAdmin } from "./client.server";

export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (error) {
      console.error("[admin] has_role failed", error);
      throw new Error("FORBIDDEN");
    }
    if (!data) {
      throw new Error("FORBIDDEN");
    }
    return next({ context: { userId, isAdmin: true } });
  });
