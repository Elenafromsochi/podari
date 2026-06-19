import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Публичный счётчик для посадочной страницы (без авторизации).
// Считаем активные подарки (status="available") и открытые желания
// (status="open"). Через service-role клиент, чтобы работало до входа.
// Каждый счётчик независим: ошибка одного не обнуляет другой.
export const getPlatformStats = createServerFn({ method: "GET" }).handler(
  async () => {
    async function count(table: "gifts" | "wishes", status: string): Promise<number> {
      try {
        const { count } = await supabaseAdmin
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("status", status);
        return count ?? 0;
      } catch (e) {
        console.error(`[stats] count ${table} failed`, e);
        return 0;
      }
    }

    const [gifts, wishes] = await Promise.all([
      count("gifts", "available"),
      count("wishes", "open"),
    ]);
    return { gifts, wishes };
  },
);
