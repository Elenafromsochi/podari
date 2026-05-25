import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { Sparkles, Send, ArrowLeft, ShieldCheck } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { loadUser, setTelegramSession, type UserProfile } from "@/lib/auth-state";
import {
  startTelegramLogin,
  pollTelegramLogin,
  verifyTelegramCode,
} from "@/lib/telegram-auth.functions";

type Step = "intro" | "code";

interface Props {
  onAuthed: (user: UserProfile, isNew: boolean) => void;
}

export function AuthFlow({ onAuthed }: Props) {
  const [step, setStep] = useState<Step>("intro");
  const [loading, setLoading] = useState(false);

  const [nonce, setNonce] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string>("Podari_podarki_bot");
  const [codeSent, setCodeSent] = useState(false);

  const [otp, setOtp] = useState(["", "", "", ""]);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const start = useServerFn(startTelegramLogin);
  const poll = useServerFn(pollTelegramLogin);
  const verify = useServerFn(verifyTelegramCode);

  const beginLogin = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const referrer_id =
        typeof window !== "undefined"
          ? localStorage.getItem("cozygift_pending_ref")
          : null;
      const res = await start({ data: { referrer_id } });
      setNonce(res.nonce);
      setDeepLink(res.deep_link);
      setBotUsername(res.bot_username);
      setCodeSent(false);
      setOtp(["", "", "", ""]);
      setStep("code");
      // open Telegram
      if (typeof window !== "undefined") {
        window.open(res.deep_link, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      toast.error("Не удалось начать вход", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  };

  // Poll for "bot already sent the code" — чтобы показать пользователю подсказку
  useEffect(() => {
    if (step !== "code" || !nonce || codeSent) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await poll({ data: { nonce } });
        if (stop) return;
        if (r.status === "code_sent") {
          setCodeSent(true);
          toast.success("Код отправлен в Telegram", {
            description: "Проверь чат с ботом",
          });
          inputsRef.current[0]?.focus();
        }
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(tick, 2000);
    tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [step, nonce, codeSent, poll]);

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[i] = d;
    setOtp(next);
    if (d && i < 3) inputsRef.current[i + 1]?.focus();
    if (next.every((x) => x !== "")) {
      submitCode(next.join(""));
    }
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) {
      inputsRef.current[i - 1]?.focus();
    }
  };

  const submitCode = async (code: string) => {
    if (!nonce) return;
    setLoading(true);
    try {
      const { access_token, refresh_token } = await verify({
        data: { nonce, code },
      });
      await setTelegramSession(access_token, refresh_token);
      const profile = await loadUser();
      if (!profile) throw new Error("Профиль не создан");
      if (typeof window !== "undefined") {
        localStorage.removeItem("cozygift_pending_ref");
      }
      confetti({ particleCount: 140, spread: 90, origin: { y: 0.4 }, scalar: 1.1 });
      toast.success(`Привет, ${profile.display_name} 💚`);
      onAuthed(profile, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let text = "Не удалось войти";
      if (msg.includes("WRONG_CODE")) text = "Неверный код";
      else if (msg.includes("WAITING_FOR_TELEGRAM"))
        text = "Сначала нажми Start в Telegram";
      else if (msg.includes("NONCE_EXPIRED")) text = "Код истёк — начни заново";
      else if (msg.includes("NONCE_CONSUMED")) text = "Код уже использован";
      toast.error(text);
      setOtp(["", "", "", ""]);
      inputsRef.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-8">
      {step === "code" && (
        <button
          onClick={() => setStep("intro")}
          className="mb-4 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
      )}

      {step === "intro" && (
        <div className="flex flex-1 flex-col gap-7">
          <div className="flex flex-col items-center gap-3 pt-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-peach shadow-sm">
              <Sparkles className="h-8 w-8 text-peach-foreground" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Добро пожаловать в «Подари» 🎁
            </h1>
            <p className="text-balance text-sm text-muted-foreground">
              Сервис, где люди дарят друг другу время, вещи и заботу.
              Вход — через Telegram, без паролей.
            </p>
          </div>

          <div className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Как это работает</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Жмёшь кнопку ниже — откроется наш бот в Telegram</li>
              <li>В боте нажми <b>Start</b></li>
              <li>Бот пришлёт 4-значный код</li>
              <li>Введи код здесь — и ты внутри</li>
            </ol>
          </div>

          <Button
            onClick={beginLogin}
            disabled={loading}
            className="h-14 rounded-2xl bg-mint text-base font-semibold text-mint-foreground shadow-sm hover:bg-mint/90 disabled:opacity-50"
          >
            <Send className="mr-2 h-5 w-5" />
            {loading ? "Готовим вход..." : "Войти через Telegram"}
          </Button>

          <p className="mt-auto flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Безопасно • без паролей • без спама
          </p>
        </div>
      )}

      {step === "code" && (
        <div className="flex flex-1 flex-col gap-6">
          <div className="flex flex-col items-center gap-3 pt-4 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              Введи код из Telegram
            </h1>
            <p className="text-balance text-sm text-muted-foreground">
              Открой чат с{" "}
              <a
                href={deepLink ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                @{botUsername}
              </a>{" "}
              и нажми <b>Start</b> — бот пришлёт 4 цифры.
            </p>
            {codeSent && (
              <p className="rounded-full bg-mint/40 px-3 py-1 text-xs text-foreground">
                ✅ Код отправлен в Telegram
              </p>
            )}
          </div>

          <div className="flex justify-center gap-3">
            {otp.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputsRef.current[i] = el;
                }}
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                disabled={loading}
                className="h-14 w-12 rounded-2xl border border-input bg-background text-center text-2xl font-semibold shadow-sm outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/40 disabled:opacity-50"
              />
            ))}
          </div>

          {deepLink && (
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mx-auto inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
            >
              <Send className="h-4 w-4" /> Открыть бота ещё раз
            </a>
          )}
        </div>
      )}
    </div>
  );
}
