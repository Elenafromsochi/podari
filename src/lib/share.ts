import { haptic } from "@/lib/haptics";
import { toast } from "sonner";
import { APP_BASE_URL } from "@/lib/app-url";
import { giftShareVariants } from "@/lib/random-copy";

/** Каноническая ссылка на страницу подарка. */
export function giftShareUrl(giftId: string): string {
  return `${APP_BASE_URL}/gift/${giftId}`;
}

/**
 * Старый способ копирования через скрытую textarea + execCommand. Работает
 * там, где современный navigator.clipboard заблокирован (например, когда
 * страница открыта внутри Google-переводчика translate.goog).
 */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Универсальное «Поделиться» — единый формат для всего приложения
 * (приглашения, подарки, желания). На телефоне открывает системное меню,
 * откуда ссылку можно отправить КУДА УГОДНО: Telegram, ВКонтакте, WhatsApp,
 * почта и т.д. Если системное меню/буфер недоступны (десктоп, режим перевода
 * страницы и т.п.) — мягко переходим к копированию, а в самом крайнем случае
 * показываем ссылку для ручного копирования. Ссылку всегда можно получить —
 * «Не удалось поделиться» больше не тупик.
 *
 * ВАЖНО: вызывать прямо в обработчике клика (в рамках жеста пользователя),
 * иначе iOS/Safari заблокирует открытие меню.
 */
export async function shareLink(text: string, url: string): Promise<void> {
  haptic("medium");

  const message = `${text}\n${url}`;

  // Открываем окно «Поделиться» Telegram с готовым текстом И ссылкой — так
  // работало раньше и надёжно работает везде, в т.ч. во встроенных браузерах,
  // где системное navigator.share недоступно. Текст и ссылка уходят вместе.
  // Открываем СИНХРОННО (в рамках жеста по кнопке), иначе iOS заблокирует окно.
  if (typeof window !== "undefined") {
    const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    const win = window.open(tg, "_blank", "noopener,noreferrer");
    if (win) return;
  }

  // Если окно заблокировано (редко) — пробуем системное меню.
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: text, text, url });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }

  // Самый крайний случай — копируем текст со ссылкой.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Скопировано 💚", {
        description: "Вставь и отправь в любом мессенджере",
      });
      return;
    } catch {
      /* пробуем старый способ ниже */
    }
  }
  if (legacyCopy(message)) {
    toast.success("Скопировано 💚", {
      description: "Вставь и отправь в любом мессенджере",
    });
    return;
  }
  if (typeof window !== "undefined" && typeof window.prompt === "function") {
    window.prompt("Скопируй ссылку и отправь другу:", message);
    return;
  }
  toast("Ссылка для друга 💚", { description: message, duration: 15000 });
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
