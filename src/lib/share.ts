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

  // ВАЖНО: многие мессенджеры (Telegram на iOS и др.) при системном
  // «Поделиться» берут ТОЛЬКО поле url и выбрасывают отдельное поле text —
  // получатель видит голую ссылку. Поэтому кладём подпись и ссылку ВМЕСТЕ в
  // одно текстовое поле, без отдельного url — тогда текст точно уходит с ней.
  const message = `${text}\n${url}`;

  // 1) Системное «Поделиться» — окно выбора приложения (Telegram, ВК, и т.д.).
  // Передаём title+text+url раздельно: именно такой формат надёжно открывает
  // системное меню на iOS/Android (формат «только текст» на части Safari меню
  // не открывал и уходил в копирование).
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: text, text, url });
      return;
    } catch (e) {
      // Пользователь закрыл меню — это не ошибка, тихо выходим.
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Иначе пробуем копирование ниже.
    }
  }

  // 2) Современный буфер обмена.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Скопировано 💚", {
        description: "Вставь и отправь в любом мессенджере",
      });
      return;
    } catch {
      /* буфер заблокирован — пробуем старый способ ниже */
    }
  }

  // 3) Старый способ копирования (работает там, где clipboard API закрыт).
  if (legacyCopy(message)) {
    toast.success("Скопировано 💚", {
      description: "Вставь и отправь в любом мессенджере",
    });
    return;
  }

  // 4) Последний фолбэк — показываем ссылку, чтобы скопировать вручную.
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
