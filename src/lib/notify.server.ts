import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tgApiSafe } from "@/lib/telegram-api";

const APP_URL = process.env.APP_URL ?? "https://23podari.ru";

type NotifyOpts = {
  /**
   * Не слать, если пользователь был активен (last_seen_at) в течение указанного
   * числа секунд — чтобы не дублировать то, что человек и так видит в приложении
   * (например, новые сообщения в открытом чате).
   */
  skipIfActiveWithinSec?: number;
};

/**
 * Отправляет пользователю уведомление в Telegram-бота с кнопкой-ссылкой
 * «Открыть» на нужный экран. Молча выходит, если у пользователя нет
 * telegram_id, он отключил уведомления или (по опции) сейчас онлайн.
 * Никогда не бросает исключение — сбой уведомления не должен ломать действие.
 *
 * @param userId  кому шлём (supabase user_id)
 * @param text    текст уведомления
 * @param path    путь в приложении, напр. "/chat/abc" или "/?tab=chats"
 * @param opts    дополнительные условия отправки
 */
export async function notifyUser(
  userId: string | null | undefined,
  text: string,
  path = "/",
  opts: NotifyOpts = {},
) {
  try {
    if (!userId) return;

    let telegramId: number | string | null = null;
    let lastSeenAt: string | null = null;

    const { data } = await supabaseAdmin
      .from("profiles")
      .select("telegram_id, last_seen_at")
      .eq("user_id", userId)
      .maybeSingle();
    telegramId = (data?.telegram_id as number | null) ?? null;
    lastSeenAt = (data as { last_seen_at?: string | null } | null)?.last_seen_at ?? null;

    if (!telegramId) return;

    // Онлайн-проверка: если человек только что был в приложении — не дублируем.
    if (opts.skipIfActiveWithinSec && lastSeenAt) {
      const ageSec = (Date.now() - new Date(lastSeenAt).getTime()) / 1000;
      if (ageSec >= 0 && ageSec < opts.skipIfActiveWithinSec) return;
    }

    const url = path.startsWith("http") ? path : `${APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
    await tgApiSafe("sendMessage", {
      chat_id: Number(telegramId),
      text,
      // Тихое уведомление: человек видит сообщение в чате с ботом, но телефон
      // не звенит и не вибрирует — не раздражает.
      disable_notification: true,
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
