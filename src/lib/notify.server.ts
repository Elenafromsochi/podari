import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tgApiSafe } from "@/lib/telegram-api";

const APP_URL = process.env.APP_URL ?? "https://23podari.ru";

/**
 * Отправляет пользователю уведомление в Telegram-бота с кнопкой-ссылкой
 * «Открыть» на нужный экран. Молча выходит, если у пользователя нет
 * telegram_id или он отключил уведомления. Никогда не бросает исключение —
 * сбой уведомления не должен ломать основное действие.
 *
 * @param userId  кому шлём (supabase user_id)
 * @param text    текст уведомления
 * @param path    путь в приложении, напр. "/chat/abc" или "/?tab=chats"
 */
export async function notifyUser(userId: string | null | undefined, text: string, path = "/") {
  try {
    if (!userId) return;

    let telegramId: number | string | null = null;
    let enabled = true;

    // Пытаемся прочитать настройку уведомлений; если колонки ещё нет
    // (миграция не применена) — считаем, что уведомления включены.
    const withPref = await supabaseAdmin
      .from("profiles")
      .select("telegram_id, notifications_enabled")
      .eq("user_id", userId)
      .maybeSingle();

    if (withPref.error) {
      const only = await supabaseAdmin
        .from("profiles")
        .select("telegram_id")
        .eq("user_id", userId)
        .maybeSingle();
      telegramId = (only.data?.telegram_id as number | null) ?? null;
    } else {
      telegramId = (withPref.data?.telegram_id as number | null) ?? null;
      enabled = (withPref.data as { notifications_enabled?: boolean } | null)?.notifications_enabled !== false;
    }

    if (!telegramId || !enabled) return;

    const url = path.startsWith("http") ? path : `${APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
    await tgApiSafe("sendMessage", {
      chat_id: Number(telegramId),
      text,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "Открыть «Подари» 💚", url }]],
      },
    });
  } catch (e) {
    console.error("[notify] failed", e);
  }
}

/** Короткий путь к чату по подарку (или к вкладке чатов, если подарка нет). */
export function chatPath(giftId?: string | null): string {
  return giftId ? `/chat/${giftId}` : "/?tab=chats";
}
