import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tgApi } from "@/lib/telegram-api";
import { getUserPlan } from "@/lib/ai-provider";

// Параметры Global-подписки (оплата звёздами Telegram). Через env — чтобы
// менять цену/срок без правок кода.
export const GLOBAL_PRICE_STARS = Number(process.env.GLOBAL_PRICE_STARS ?? 150);
export const GLOBAL_PERIOD_DAYS = Number(process.env.GLOBAL_PERIOD_DAYS ?? 30);

// Текущий статус премиума пользователя (для UI). Колонка premium_until может
// ещё не существовать — getUserPlan это переживает (вернёт free).
export const getMyPremium = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      isPremium: boolean;
      premiumUntil: string | null;
      priceStars: number;
      periodDays: number;
    }> => {
      const plan = await getUserPlan(context.supabase, context.userId);
      let premiumUntil: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (context.supabase as any)
          .from("profiles")
          .select("premium_until")
          .eq("user_id", context.userId)
          .maybeSingle();
        premiumUntil = data?.premium_until ?? null;
      } catch {
        /* колонки ещё нет */
      }
      return {
        isPremium: plan === "premium",
        premiumUntil,
        priceStars: GLOBAL_PRICE_STARS,
        periodDays: GLOBAL_PERIOD_DAYS,
      };
    },
  );

// Создаёт ссылку на оплату звёздами (Telegram Stars, валюта XTR).
// Платёж подтверждается ботом в вебхуке (successful_payment) — там и
// выставляется premium_until. В payload кладём user_id и срок.
export const createGlobalInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ link: string }> => {
    const days = GLOBAL_PERIOD_DAYS;
    const payload = `global:${context.userId}:${days}`;
    const res = (await tgApi("createInvoiceLink", {
      title: "Подари Global",
      description: `Премиум-ИИ (топ-модели, красивые картинки) на ${days} дней`,
      payload,
      currency: "XTR",
      prices: [{ label: `Global · ${days} дней`, amount: GLOBAL_PRICE_STARS }],
    })) as { ok?: boolean; result?: string };
    if (!res?.result) throw new Error("Не удалось создать счёт Telegram");
    return { link: res.result };
  });
