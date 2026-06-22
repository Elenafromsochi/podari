import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, Star, Loader2 } from "lucide-react";
import { getMyPremium, createGlobalInvoice } from "@/lib/premium.functions";
import { haptic } from "@/lib/haptics";

type Status = {
  isPremium: boolean;
  premiumUntil: string | null;
  priceStars: number;
  periodDays: number;
};

// Карточка подписки «Global» — топовые мировые модели по подписке (Telegram Stars).
// Бесплатный тариф работает на российских моделях без VPN; здесь — апгрейд.
export function GlobalPremiumCard() {
  const fetchStatus = useServerFn(getMyPremium);
  const makeInvoice = useServerFn(createGlobalInvoice);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    fetchStatus()
      .then((s) => setStatus(s as Status))
      .catch(() => {});
  }, [fetchStatus]);

  useEffect(() => {
    reload();
  }, [reload]);

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    haptic("light");
    try {
      const { link } = await makeInvoice();
      window.open(link, "_blank");
      toast.success("Открыли оплату в Telegram", {
        description: "После оплаты вернись сюда и нажми «Обновить статус».",
      });
    } catch {
      toast.error("Не получилось открыть оплату. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  const untilLabel = status.premiumUntil
    ? new Date(status.premiumUntil).toLocaleDateString("ru-RU")
    : null;

  return (
    <section className="mb-4 overflow-hidden rounded-3xl border bg-gradient-to-br from-violet-500/10 via-card to-amber-400/10 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-500" />
        <span className="text-[15px] font-semibold">Подари Global</span>
        {status.isPremium && (
          <span className="ml-auto inline-flex items-center rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-600">
            активен
          </span>
        )}
      </div>

      {status.isPremium ? (
        <>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Топовые мировые модели и красивые картинки
            {untilLabel ? ` — до ${untilLabel}` : ""}. Спасибо за поддержку 💚
          </p>
          <button
            type="button"
            onClick={buy}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-semibold transition active:scale-95 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Star className="h-4 w-4 text-amber-500" />
            )}
            Продлить на {status.periodDays} дн. · {status.priceStars}
          </button>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Бесплатно ИИ уже работает на российских моделях (без VPN). Global
            подключает топовые мировые модели и более красивые картинки.
          </p>
          <button
            type="button"
            onClick={buy}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white shadow transition active:scale-95 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Star className="h-4 w-4" />
            )}
            Оформить на {status.periodDays} дн. · {status.priceStars} ⭐
          </button>
        </>
      )}

      <button
        type="button"
        onClick={reload}
        className="mt-2 block text-[12px] text-muted-foreground underline-offset-2 hover:underline"
      >
        Обновить статус
      </button>
    </section>
  );
}
