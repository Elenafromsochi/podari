import { haptic } from "@/lib/haptics";
import { toast } from "sonner";
import { APP_BASE_URL } from "@/lib/app-url";
import { giftShareVariants } from "@/lib/random-copy";

/** Каноническая ссылка на страницу подарка. */
export function giftShareUrl(giftId: string): string {
  return `${APP_BASE_URL}/gift/${giftId}`;
}

/**
 * Универсальное «Поделиться» — единый формат для всего приложения
 * (приглашения, подарки, желания). На телефоне открывает системное меню,
 * откуда ссылку можно отправить КУДА УГОДНО: Telegram, ВКонтакте, WhatsApp,
 * почта и т.д. На десктопе / без поддержки — копирует текст со ссылкой в
 * буфер обмена.
 *
 * ВАЖНО: вызывать прямо в обработчике клика (в рамках жеста пользователя),
 * иначе iOS/Safari заблокирует открытие меню.
 */
export async function shareLink(text: string, url: string): Promise<void> {
  haptic("medium");

  // Системное «Поделиться» (мобильные браузеры и часть десктопных).
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: text, text, url });
      return;
    } catch (e) {
      // Пользователь закрыл меню — это не ошибка, тихо выходим.
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Иначе падаем на копирование ниже.
    }
  }

  // Фолбэк — копируем текст вместе со ссылкой, чтобы получатель видел подпись.
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast.success("Скопировано 💚", {
      description: "Вставь и отправь в любом мессенджере",
    });
  } catch {
    toast.error("Не удалось поделиться", { description: url });
  }
}

/**
 * «Поделиться подарком» — обёртка над shareLink с готовой подписью.
 * Вызывать прямо в обработчике клика (жест пользователя).
 */
export async function shareGift(giftId: string, title?: string): Promise<void> {
  const url = giftShareUrl(giftId);
  // Тёплая подпись из общих вариантов («Смотри, какой подарок… прямо для тебя»),
  // та же, что и в окне получения подарка — единый формат по всему приложению.
  const text = thirdVariant(giftShareVariants(title ?? ""));
  await shareLink(text, url);
}

// Берём «третий формат» (последний из набора) — он самый короткий и ясный.
export function thirdVariant(variants: string[]): string {
  return variants[variants.length - 1] ?? variants[0] ?? "";
}
