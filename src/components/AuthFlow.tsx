import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { Sparkles, Phone, ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  extractDigits,
  formatPhone,
  loadUser,
  sendOtp,
  signInWithPhone,
  signUpWithPhone,
  verifyOtp,
  type UserProfile,
} from "@/lib/auth-state";

type Step = "phone" | "otp" | "onboarding";

interface Props {
  onAuthed: (user: UserProfile, isNew: boolean) => void;
}

export function AuthFlow({ onAuthed }: Props) {
  const [step, setStep] = useState<Step>("phone");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  // OTP
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [seconds, setSeconds] = useState(60);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // Onboarding
  const [name, setName] = useState("");

  useEffect(() => {
    if (step !== "otp") return;
    setSeconds(60);
    const t = setInterval(() => {
      setSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [step]);

  const fullPhone = `+7${phoneDigits}`;
  const phoneReady = phoneDigits.length === 10 && agreed;

  const requestCode = async () => {
    if (!phoneReady || loading) return;
    setLoading(true);
    try {
      const code = await sendOtp(fullPhone);
      setLastCode(code);
      setOtp(["", "", "", ""]);
      setStep("otp");
      toast.success("Код отправлен", { description: `Демо-код: ${code}` });
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (seconds > 0) return;
    const code = await sendOtp(fullPhone);
    setLastCode(code);
    setSeconds(60);
    toast.success("Новый код отправлен", { description: `Демо-код: ${code}` });
  };

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[i] = d;
    setOtp(next);
    if (d && i < 3) inputsRef.current[i + 1]?.focus();
    if (next.every((x) => x !== "")) {
      validate(next.join(""));
    }
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) {
      inputsRef.current[i - 1]?.focus();
    }
  };

  const validate = async (code: string) => {
    if (!verifyOtp(fullPhone, code)) {
      toast.error("Неверный код", { description: "Попробуйте ещё раз" });
      setOtp(["", "", "", ""]);
      inputsRef.current[0]?.focus();
      return;
    }
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate?.(40); } catch {}
    }
    setLoading(true);
    try {
      const signedIn = await signInWithPhone(fullPhone);
      if (signedIn) {
        const profile = await loadUser();
        if (profile) {
          toast.success(`С возвращением, ${profile.display_name} 💚`);
          onAuthed(profile, false);
          return;
        }
      }
      // Нет такого пользователя — собираем имя
      setStep("onboarding");
    } catch (e) {
      toast.error("Не удалось войти", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  };

  const finishOnboarding = async () => {
    if (!name.trim()) {
      toast.error("Введите имя");
      return;
    }
    setLoading(true);
    try {
      const profile = await signUpWithPhone(fullPhone, name.trim());
      confetti({ particleCount: 140, spread: 90, origin: { y: 0.4 }, scalar: 1.1 });
      toast.success("+100 подарочных баллов начислено!", {
        description: "Добро пожаловать в игровой мир",
      });
      onAuthed(profile, true);
    } catch (e) {
      toast.error("Не удалось создать аккаунт", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-8">
      {step !== "phone" && (
        <button
          onClick={() => setStep(step === "otp" ? "phone" : "otp")}
          className="mb-4 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
      )}

      {step === "phone" && (
        <div className="flex flex-1 flex-col gap-7">
          <div className="flex flex-col items-center gap-3 pt-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-peach shadow-sm">
              <Sparkles className="h-8 w-8 text-peach-foreground" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Добро пожаловать в Клуб Ресурс
            </h1>
            <p className="text-balance text-sm text-muted-foreground">
              Введите ваш номер телефона для авторизации или регистрации.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="text-xs text-muted-foreground">
              Номер телефона
            </Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="phone"
                inputMode="tel"
                autoComplete="tel"
                value={formatPhone(phoneDigits)}
                onChange={(e) => setPhoneDigits(extractDigits(e.target.value))}
                className="h-12 rounded-2xl pl-10 text-base tracking-wide"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-muted/40 p-4 text-sm">
            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            <span className="leading-snug text-muted-foreground">
              Я согласен с{" "}
              <span className="font-medium text-foreground">правилами Клуба</span>{" "}
              и обработкой персональных данных
            </span>
          </label>

          <Button
            onClick={requestCode}
            disabled={!phoneReady || loading}
            className="h-14 rounded-2xl bg-mint text-base font-semibold text-mint-foreground shadow-sm hover:bg-mint/90 disabled:opacity-50"
          >
            {loading ? "Отправляем..." : "Получить код доступа"}
          </Button>

          <p className="mt-auto flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Защищено • без спама
          </p>
        </div>
      )}

      {step === "otp" && (
        <div className="flex flex-1 flex-col gap-7">
          <div className="flex flex-col items-center gap-3 pt-4 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Подтверждение номера</h1>
            <p className="text-sm text-muted-foreground">
              Мы отправили SMS с кодом на номер{" "}
              <span className="font-medium text-foreground">{formatPhone(phoneDigits)}</span>
            </p>
            {lastCode && (
              <p className="rounded-full bg-peach/40 px-3 py-1 text-xs text-foreground">
                Демо-код: <span className="font-mono font-semibold">{lastCode}</span>
              </p>
            )}
          </div>

          <div className="flex justify-center gap-3">
            {otp.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputsRef.current[i] = el; }}
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

          <div className="text-center text-sm">
            {seconds > 0 ? (
              <span className="text-muted-foreground">
                Повторный запрос доступен через{" "}
                <span className="font-medium text-foreground">{seconds} сек</span>
              </span>
            ) : (
              <button
                onClick={resend}
                className="text-primary underline-offset-4 hover:underline"
              >
                Отправить код повторно
              </button>
            )}
          </div>
        </div>
      )}

      {step === "onboarding" && (
        <div className="flex flex-1 flex-col gap-6">
          <div className="flex flex-col items-center gap-2 pt-4 text-center">
            <div className="text-4xl">🌿</div>
            <h1 className="text-2xl font-semibold tracking-tight">Знакомство</h1>
            <p className="text-sm text-muted-foreground">
              Несколько штрихов — и вы в игре
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Как к вам обращаться?</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Имя"
              className="h-12 rounded-2xl text-base"
            />
          </div>

          <Button
            onClick={finishOnboarding}
            disabled={loading}
            className="mt-2 h-14 rounded-2xl bg-mint text-base font-semibold text-mint-foreground shadow-sm hover:bg-mint/90"
          >
            {loading ? "Создаём аккаунт..." : "Войти в мир подарков"}
          </Button>
        </div>
      )}
    </div>
  );
}
