import { haptic } from "@/lib/haptics";

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
