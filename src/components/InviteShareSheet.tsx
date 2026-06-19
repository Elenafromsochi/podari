import { toast } from "sonner";
import { Send, Copy, X } from "lucide-react";
import { haptic } from "@/lib/haptics";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Ссылка-приглашение (с ?ref=…). Подставляется в шеринг. */
  link: string;
  /** Набор текстов; используется последний («третий формат»). */
  variants: string[];
  /** Заголовок окна. */
  title?: string;
  /** Вызывается ПОСЛЕ фактической отправки/копирования (для зачёта реферала, гида). */
  onShared?: () => void;
}

/**
 * Нижнее окно «Поделиться»: показывает один готовый текст приглашения
 * (последний из набора — «третий формат») и отправляет его через системное
 * окно или копирует. Текст + ссылка уходят вместе, чтобы реферальная ссылка
 * засчиталась. Без выбора из нескольких вариантов — так окно компактное, и
 * кнопка «Поделиться» всегда рядом с текстом, не уезжает вниз.
 */
export function InviteShareSheet({ open, onClose, link, variants, title = "Поделиться", onShared }: Props) {
  if (!open) return null;
  const text = variants[variants.length - 1] ?? variants[0] ?? "";

  const doShare = async () => {
    haptic("medium");
    // 1) Системное окно «Поделиться».
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: "Подари", text, url: link });
        onShared?.();
        onClose();
        return;
      }
    } catch {
      // отмена шеринга — окно оставляем открытым, реферал не засчитываем
      return;
    }
    // 2) Фолбэк: копируем текст со ссылкой.
    await copy();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${text}\n${link}`);
      toast.success("Скопировано — вставь другу 💚");
      onShared?.();
      onClose();
    } catch {
      window.open(
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
        "_blank",
      );
      onShared?.();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/50 p-0 animate-fade-in sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-background p-5 shadow-xl animate-scale-in sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Готовый текст приглашения (для предпросмотра, без выбора). */}
        <div className="rounded-2xl border-2 border-mint bg-mint/15 p-3 text-sm leading-snug">
          {text}
        </div>

        <button
          onClick={doShare}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-mint px-4 py-3 text-sm font-semibold text-mint-foreground shadow-sm transition active:scale-[0.98] hover:bg-mint/90"
        >
          <Send className="h-4 w-4" /> Поделиться
        </button>
        <button
          onClick={copy}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-accent"
        >
          <Copy className="h-4 w-4" /> Скопировать текст и ссылку
        </button>
      </div>
    </div>
  );
}
