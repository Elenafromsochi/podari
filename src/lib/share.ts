import { haptic } from "@/lib/haptics";
import { toast } from "sonner";
import { APP_BASE_URL } from "@/lib/app-url";

/** Каноническая ссылка на страницу подарка. */
export function giftShareUrl(giftId: string): string {
  return `${APP_BASE_URL}/gift/${giftId}`;
}

/**
 * «Поделиться подарком»: на телефоне открывает системное меню (отправить
 * другу в любой мессенджер), на десктопе — копирует ссылку в буфер обмена.
 * Вызывать прямо в обработчике клика (жест пользователя).
 */
export async function shareGift(giftId: string, title?: string): Promise<void> {
  haptic("medium");
  const url = giftShareUrl(giftId);
  const text = title ? `Подарок «${title}» на Подари 🎁` : "Подарок на Подари 🎁";

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

  // Фолбэк — копируем ссылку в буфер обмена.
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Ссылка скопирована 💚", { description: "Отправь её другу" });
  } catch {
    toast.error("Не удалось поделиться", { description: url });
  }
}

// Прямой шеринг в Telegram: открывает окно «Поделиться» Telegram с выбором
// контакта и готовым текстом + ссылкой. Без промежуточных окон в приложении.
//
// ВАЖНО: вызывать прямо в обработчике клика (в рамках жеста пользователя),
// иначе Safari/iOS заблокирует открытие новой вкладки.
export function shareToTelegram(text: string, link: string) {
  if (typeof window === "undefined") return;
  haptic("medium");
  const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

// Берём «третий формат» (последний из набора) — он самый короткий и ясный.
export function thirdVariant(variants: string[]): string {
  return variants[variants.length - 1] ?? variants[0] ?? "";
}
