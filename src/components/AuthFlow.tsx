import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { Sparkles, ShieldCheck, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { loadUser, setTelegramSession, type UserProfile } from "@/lib/auth-state";
import {
  startTelegramLogin,
  pollTelegramLogin,
  completeTelegramLogin,
} from "@/lib/telegram-auth.functions";
import { Button } from "@/components/ui/button";

interface Props {
  onAuthed: (user: UserProfile, isNew: boolean) => void;
  initialNonce?: string | null;
}

type Phase = "idle" | "waiting" | "approved" | "signing_in";

export function AuthFlow({ onAuthed, initialNonce }: Props) {
  const startFn = useServerFn(startTelegramLogin);
  const pollFn = useServerFn(pollTelegramLogin);
  const completeFn = useServerFn(completeTelegramLogin);

  const [phase, setPhase] = useState<Phase>("idle");
  const [nonce, setNonce] = useState<string | null>(initialNonce ?? null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const pollingRef = useRef<number | null>(null);
  const deadlineRef = useRef<number>(0);

  const clearPolling = () => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const finishSignIn = async (n: string) => {
    setPhase("signing_in");
    setStatusText("Входим…");
    try {
      const res = await completeFn({ data: { nonce: n } });
      await setTelegramSession(res.access_token, res.refresh_token);
      const profile = await loadUser();
      if (!profile) throw new Error("Профиль не загружен");
      confetti({ particleCount: 140, spread: 90, origin: { y: 0.4 }, scalar: 1.1 });
      toast.success(
        res.is_new
          ? `Добро пожаловать, ${profile.display_name} 💚`
          : `С возвращением, ${profile.display_name} 💚`,
      );
      onAuthed(profile, res.is_new);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let text = "Не удалось войти";
      if (msg.includes("NONCE_EXPIRED")) text = "Ссылка истекла — попробуй ещё раз";
      else if (msg.includes("NONCE_REJECTED")) text = "Вход отклонён в боте";
      else if (msg.includes("NOT_APPROVED")) text = "Сначала подтверди вход в боте";
      toast.error(text);
      reset();
    }
  };

  const startPolling = (n: string) => {
    deadlineRef.current = Date.now() + 5 * 60 * 1000;
    clearPolling();
    pollingRef.current = window.setInterval(async () => {
      if (Date.now() > deadlineRef.current) {
        clearPolling();
        setStatusText("Время вышло. Попробуй ещё раз.");
        setPhase("idle");
        return;
      }
      try {
        const r = await pollFn({ data: { nonce: n } });
        if (r.status === "approved") {
          clearPolling();
          setPhase("approved");
          await finishSignIn(n);
        } else if (r.status === "rejected") {
          clearPolling();
          setStatusText("Вход отклонён в боте. Попробуй ещё раз.");
          setPhase("idle");
        } else if (r.status === "expired" || r.status === "not_found") {
          clearPolling();
          setStatusText("Ссылка истекла. Попробуй ещё раз.");
          setPhase("idle");
        } else if (r.status === "opened") {
          setStatusText("Ты открыл бота — теперь нажми ✅ Это я");
        } else {
          setStatusText("Открой бота и нажми Start");
        }
      } catch {
        /* network blip — try next tick */
      }
    }, 1500);
  };

  const startLogin = async () => {
    setPhase("waiting");
    setStatusText("Готовим ссылку…");
    try {
      const referrer_id =
        typeof window !== "undefined"
          ? localStorage.getItem("cozygift_pending_ref")
          : null;
      const res = await startFn({ data: { referrer_id } });
      setNonce(res.nonce);
      setDeepLink(res.deep_link);
      window.open(res.deep_link, "_blank", "noopener,noreferrer");
      setStatusText("Открой бота и нажми Start, затем ✅ Это я");
      startPolling(res.nonce);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Не удалось начать вход", { description: msg });
      setPhase("idle");
      setStatusText("");
    }
  };

  const reset = () => {
    clearPolling();
    setPhase("idle");
    setNonce(null);
    setDeepLink(null);
    setStatusText("");
  };

  // Если пользователь пришёл по ссылке t.me-бота (?login=<nonce>) —
  // сразу начинаем polling, не открывая новый deep-link.
  useEffect(() => {
    if (initialNonce) {
      setNonce(initialNonce);
      setPhase("waiting");
      setStatusText("Подтверди вход в боте");
      startPolling(initialNonce);
    }
    return () => clearPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNonce]);

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
            Один клик — подтверждение в Telegram-боте.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          {phase === "idle" && (
            <Button size="lg" className="w-full" onClick={startLogin}>
              Войти через Telegram
            </Button>
          )}

          {(phase === "waiting" || phase === "approved" || phase === "signing_in") && (
            <div className="flex w-full flex-col items-center gap-3 rounded-2xl bg-muted/40 p-4 text-center">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin" />
                {statusText || "Ожидаем подтверждение в боте…"}
              </div>
              {deepLink && phase === "waiting" && (
                <a
                  href={deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Открыть бота ещё раз
                </a>
              )}
              {phase === "waiting" && (
                <button
                  type="button"
                  onClick={reset}
                  className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" /> Начать заново
                </button>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-muted/40 p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Как это устроено</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Жмёшь кнопку — открывается бот в Telegram</li>
            <li>В боте нажимаешь Start, потом ✅ Это я</li>
            <li>Возвращаешься — мы уже впустили 💚</li>
          </ul>
        </div>

        <p className="mt-auto flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Безопасно • без паролей и кодов
        </p>
      </div>
    </div>
  );
}
