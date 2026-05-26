import { useState } from "react";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { Sparkles, ShieldCheck } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { loadUser, setTelegramSession, type UserProfile } from "@/lib/auth-state";
import { widgetSignIn } from "@/lib/telegram-widget.functions";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";
import {
  TelegramLoginButton,
  type TelegramWidgetPayload,
} from "@/components/TelegramLoginButton";

interface Props {
  onAuthed: (user: UserProfile, isNew: boolean) => void;
  // оставлено для обратной совместимости с index.tsx, не используется
  initialNonce?: string | null;
}

export function AuthFlow({ onAuthed }: Props) {
  const [loading, setLoading] = useState(false);
  const widgetSignInFn = useServerFn(widgetSignIn);

  const handleWidgetAuth = async (payload: TelegramWidgetPayload) => {
    if (loading) return;
    setLoading(true);
    try {
      const referrer_id =
        typeof window !== "undefined"
          ? localStorage.getItem("cozygift_pending_ref")
          : null;

      const res = await widgetSignInFn({
        data: {
          payload: payload as unknown as Record<string, unknown>,
          device_id: getDeviceId(),
          device_label: getDeviceLabel(),
          referrer_id,
        },
      });

      await setTelegramSession(res.access_token, res.refresh_token);
      const profile = await loadUser();
      if (!profile) throw new Error("Профиль не загружен");

      if (typeof window !== "undefined") {
        localStorage.removeItem("cozygift_pending_ref");
      }

      confetti({ particleCount: 140, spread: 90, origin: { y: 0.4 }, scalar: 1.1 });
      toast.success(
        res.is_new
          ? `Добро пожаловать, ${profile.display_name} 💚`
          : `С возвращением, ${profile.display_name} 💚`,
      );
      onAuthed(profile, res.is_new);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let text = "Не удалось войти через Telegram";
      if (msg.includes("WIDGET_BAD_SIGNATURE"))
        text = "Не удалось проверить подпись Telegram";
      else if (msg.includes("WIDGET_EXPIRED"))
        text = "Подтверждение Telegram устарело — попробуй ещё раз";
      else if (msg.includes("WIDGET_NOT_CONFIGURED"))
        text = "Виджет Telegram временно недоступен";
      toast.error(text);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-8">
      <div className="flex flex-1 flex-col gap-7">
        <div className="flex flex-col items-center gap-3 pt-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-peach shadow-sm">
            <Sparkles className="h-8 w-8 text-peach-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Вход в «Подари» 🎁
          </h1>
          <p className="text-balance text-sm text-muted-foreground">
            Сервис, где люди дарят друг другу время, вещи и заботу.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <TelegramLoginButton onAuth={handleWidgetAuth} />
          {loading && (
            <p className="text-xs text-muted-foreground">Входим...</p>
          )}
        </div>

        <div className="rounded-2xl bg-muted/40 p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Как это устроено</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Один клик — вход через Telegram</li>
            <li>Никаких паролей и кодов в чате</li>
            <li>Это устройство сервис запомнит на 30 дней</li>
          </ul>
        </div>

        <p className="mt-auto flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Безопасно • без спама
        </p>
      </div>
    </div>
  );
}
