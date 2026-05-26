import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  Sparkles,
  Send,
  ArrowLeft,
  ShieldCheck,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  UserCheck,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadUser, setTelegramSession, type UserProfile } from "@/lib/auth-state";
import { supabase } from "@/integrations/supabase/client";
import {
  startTelegramLogin,
  pollTelegramLogin,
  verifyTelegramCode,
} from "@/lib/telegram-auth.functions";
import {
  loginWithPassword,
  confirmDeviceCode,
} from "@/lib/password-auth.functions";
import {
  widgetSignIn,
  widgetCompleteRegistration,
} from "@/lib/telegram-widget.functions";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";
import {
  TelegramLoginButton,
  type TelegramWidgetPayload,
} from "@/components/TelegramLoginButton";

type Step = "intro" | "password" | "twofa" | "tg_code" | "tg_register";

interface Props {
  onAuthed: (user: UserProfile, isNew: boolean) => void;
  initialNonce?: string | null;
}

export function AuthFlow({ onAuthed, initialNonce }: Props) {
  const [step, setStep] = useState<Step>(initialNonce ? "tg_code" : "intro");
  const [loading, setLoading] = useState(false);

  // password step
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);

  // 2fa
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [twofaOtp, setTwofaOtp] = useState(["", "", "", ""]);
  const twofaInputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // telegram-fallback
  const [nonce, setNonce] = useState<string | null>(initialNonce ?? null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string>("Podari_podarki_bot");
  const [codeSent, setCodeSent] = useState(!!initialNonce);
  const [tgOtp, setTgOtp] = useState(["", "", "", ""]);
  const tgInputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // Telegram widget registration
  const [regTicket, setRegTicket] = useState<string | null>(null);
  const [regPreview, setRegPreview] = useState<{
    telegram_id: number;
    username: string | null;
    first_name: string | null;
    photo_url: string | null;
  } | null>(null);
  const [regDisplayName, setRegDisplayName] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regShowPwd, setRegShowPwd] = useState(false);

  const start = useServerFn(startTelegramLogin);
  const poll = useServerFn(pollTelegramLogin);
  const verify = useServerFn(verifyTelegramCode);
  const loginFn = useServerFn(loginWithPassword);
  const confirmFn = useServerFn(confirmDeviceCode);
  const widgetSignInFn = useServerFn(widgetSignIn);
  const widgetCompleteFn = useServerFn(widgetCompleteRegistration);

  // -------- Telegram Login Widget --------
  const handleWidgetAuth = async (payload: TelegramWidgetPayload) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await widgetSignInFn({
        data: {
          payload: payload as unknown as Record<string, unknown>,
          device_id: getDeviceId(),
          device_label: getDeviceLabel(),
        },
      });
      if (res.status === "ok") {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: res.token_hash,
          type: "magiclink",
        });
        if (error) throw new Error(error.message);
        const profile = await loadUser();
        if (!profile) throw new Error("Профиль не загружен");
        confetti({ particleCount: 120, spread: 85, origin: { y: 0.4 } });
        toast.success(`С возвращением, ${profile.display_name} 💚`);
        onAuthed(profile, false);
        return;
      }
      // need_registration
      setRegTicket(res.ticket);
      setRegPreview(res.preview);
      setRegDisplayName(
        res.preview.first_name || res.preview.username || "Гость",
      );
      setRegPassword("");
      setStep("tg_register");
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

  const submitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !regTicket) return;
    const name = regDisplayName.trim();
    if (name.length < 1) {
      toast.error("Укажи имя");
      return;
    }
    if (regPassword.length < 8) {
      toast.error("Пароль должен быть не короче 8 символов");
      return;
    }
    setLoading(true);
    try {
      const referrer_id =
        typeof window !== "undefined"
          ? localStorage.getItem("cozygift_pending_ref")
          : null;
      const res = await widgetCompleteFn({
        data: {
          ticket: regTicket,
          display_name: name,
          password: regPassword,
          device_id: getDeviceId(),
          device_label: getDeviceLabel(),
          referrer_id,
        },
      });

      if ("access_token" in res && res.access_token) {
        await setTelegramSession(res.access_token, res.refresh_token);
      } else if ("token_hash" in res && res.token_hash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: res.token_hash,
          type: "magiclink",
        });
        if (error) throw new Error(error.message);
      }

      const profile = await loadUser();
      if (!profile) throw new Error("Профиль не загружен");
      if (typeof window !== "undefined") {
        localStorage.removeItem("cozygift_pending_ref");
      }
      confetti({ particleCount: 140, spread: 90, origin: { y: 0.4 }, scalar: 1.1 });
      toast.success(`Добро пожаловать, ${profile.display_name} 💚`);
      onAuthed(profile, !res.already_existed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let text = "Не удалось завершить регистрацию";
      if (msg.includes("TICKET_EXPIRED"))
        text = "Подтверждение устарело — нажми «Войти через Telegram» ещё раз";
      else if (msg.includes("TICKET_"))
        text = "Подпись подтверждения не сошлась — попробуй ещё раз";
      toast.error(text);
    } finally {
      setLoading(false);
    }
  };


  // -------- Telegram fallback flow (новый юзер / забыл пароль) --------
  const beginTelegramLogin = async () => {
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
      setTgOtp(["", "", "", ""]);
      setStep("tg_code");
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

  // Poll
  useEffect(() => {
    if (step !== "tg_code" || !nonce || codeSent) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await poll({ data: { nonce } });
        if (stop) return;
        if (r.status === "code_sent") {
          setCodeSent(true);
          toast.success("Код отправлен в Telegram");
          tgInputsRef.current[0]?.focus();
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

  const setTgDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...tgOtp];
    next[i] = d;
    setTgOtp(next);
    if (d && i < 3) tgInputsRef.current[i + 1]?.focus();
    if (next.every((x) => x !== "")) submitTgCode(next.join(""));
  };

  const submitTgCode = async (code: string) => {
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
      setTgOtp(["", "", "", ""]);
      tgInputsRef.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  // -------- Password flow --------
  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const nick = username.trim().replace(/^@/, "");
    if (nick.length < 1) {
      toast.error("Укажи свой @username из Telegram");
      return;
    }
    if (password.length < 8) {
      toast.error("Пароль должен быть не короче 8 символов");
      return;
    }
    setLoading(true);
    try {
      const device_id = getDeviceId();
      const device_label = getDeviceLabel();
      const res = await loginFn({
        data: { username: nick, password, device_id, device_label },
      });
      if (res.status === "ok") {
        await setTelegramSession(res.access_token, res.refresh_token);
        const profile = await loadUser();
        if (!profile) throw new Error("Профиль не загружен");
        confetti({ particleCount: 100, spread: 80, origin: { y: 0.4 } });
        toast.success(`С возвращением, ${profile.display_name} 💚`);
        onAuthed(profile, false);
        return;
      }
      // need_2fa
      setChallengeId(res.challenge_id);
      setTwofaOtp(["", "", "", ""]);
      setStep("twofa");
      toast.success("Код отправлен в Telegram-бот", {
        description: "Открой чат с ботом, чтобы увидеть код",
      });
      setTimeout(() => twofaInputsRef.current[0]?.focus(), 100);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let text = "Не удалось войти";
      if (msg.includes("INVALID_CREDENTIALS"))
        text = "Неверный @username или пароль";
      else if (msg.includes("PASSWORD_NOT_SET"))
        text =
          "Для этого аккаунта пароль ещё не задан. Войди через Telegram и установи пароль.";
      else if (msg.includes("TELEGRAM_SEND_FAILED"))
        text = "Не удалось отправить код в Telegram. Открой бота и нажми Start.";
      toast.error(text);
    } finally {
      setLoading(false);
    }
  };

  const setTwofaDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...twofaOtp];
    next[i] = d;
    setTwofaOtp(next);
    if (d && i < 3) twofaInputsRef.current[i + 1]?.focus();
    if (next.every((x) => x !== "")) submitTwofa(next.join(""));
  };

  const submitTwofa = async (code: string) => {
    if (!challengeId) return;
    setLoading(true);
    try {
      const { access_token, refresh_token } = await confirmFn({
        data: {
          challenge_id: challengeId,
          code,
          device_id: getDeviceId(),
          device_label: getDeviceLabel(),
          remember,
        },
      });
      await setTelegramSession(access_token, refresh_token);
      const profile = await loadUser();
      if (!profile) throw new Error("Профиль не загружен");
      confetti({ particleCount: 140, spread: 90, origin: { y: 0.4 } });
      toast.success(
        remember
          ? `${profile.display_name}, устройство запомнено на 30 дней 💚`
          : `Привет, ${profile.display_name} 💚`,
      );
      onAuthed(profile, false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let text = "Не удалось подтвердить код";
      if (msg.includes("WRONG_CODE")) text = "Неверный код";
      else if (msg.includes("CHALLENGE_EXPIRED"))
        text = "Код истёк — начни вход заново";
      else if (msg.includes("CHALLENGE_CONSUMED"))
        text = "Код уже использован";
      else if (msg.includes("TOO_MANY_ATTEMPTS"))
        text = "Слишком много попыток — начни вход заново";
      toast.error(text);
      setTwofaOtp(["", "", "", ""]);
      twofaInputsRef.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  // -------- Render --------
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-8">
      {(step === "password" || step === "twofa" || step === "tg_code" || step === "tg_register") && (
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
              Вход в «Подари» 🎁
            </h1>
            <p className="text-balance text-sm text-muted-foreground">
              Сервис, где люди дарят друг другу время, вещи и заботу.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Button
              onClick={() => setStep("password")}
              className="h-14 rounded-2xl bg-mint text-base font-semibold text-mint-foreground shadow-sm hover:bg-mint/90"
            >
              <Lock className="mr-2 h-5 w-5" />
              Войти по паролю
            </Button>

            <Button
              onClick={beginTelegramLogin}
              disabled={loading}
              variant="outline"
              className="h-12 rounded-2xl text-sm font-medium"
            >
              <Send className="mr-2 h-4 w-4" />
              Я тут впервые / забыл пароль
            </Button>
          </div>

          <div className="rounded-2xl bg-muted/40 p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Как это устроено</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Вход — по @username из Telegram и паролю</li>
              <li>На новом устройстве — код подтверждения в Telegram-бот</li>
              <li>Знакомое устройство сервис запомнит на 30 дней</li>
            </ul>
          </div>

          <p className="mt-auto flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Безопасно • без спама
          </p>
        </div>
      )}

      {step === "password" && (
        <form onSubmit={submitPassword} className="flex flex-1 flex-col gap-5">
          <div className="flex flex-col items-center gap-2 pt-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-mint shadow-sm">
              <Lock className="h-7 w-7 text-mint-foreground" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Войти по паролю
            </h1>
            <p className="text-sm text-muted-foreground">
              Введи свой @username из Telegram и пароль
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="username">@username Telegram</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                @
              </span>
              <Input
                id="username"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.replace(/^@/, ""))
                }
                placeholder="ivan_petrov"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={loading}
                className="h-12 rounded-xl pl-7 text-base"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pwd">Пароль</Label>
            <div className="relative">
              <Input
                id="pwd"
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="не короче 8 символов"
                autoComplete="current-password"
                disabled={loading}
                className="h-12 rounded-xl pr-12 text-base"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
                aria-label={showPwd ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
            />
            <span>
              Запомнить это устройство на 30 дней (без кода из Telegram при
              следующем входе)
            </span>
          </label>

          <Button
            type="submit"
            disabled={loading}
            className="h-14 rounded-2xl bg-mint text-base font-semibold text-mint-foreground shadow-sm hover:bg-mint/90"
          >
            {loading ? "Проверяем..." : "Войти"}
          </Button>

          <button
            type="button"
            onClick={beginTelegramLogin}
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Забыл пароль / войти через Telegram
          </button>
        </form>
      )}

      {step === "twofa" && (
        <div className="flex flex-1 flex-col gap-5">
          <div className="flex flex-col items-center gap-2 pt-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-peach shadow-sm">
              <KeyRound className="h-7 w-7 text-peach-foreground" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Подтверждение нового устройства
            </h1>
            <p className="text-balance text-sm text-muted-foreground">
              Мы отправили 4-значный код в наш{" "}
              <a
                href="https://t.me/Podari_podarki_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Telegram-бот
              </a>
              . Открой чат с ним и введи код здесь.
            </p>
          </div>

          <div className="flex justify-center gap-3">
            {twofaOtp.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  twofaInputsRef.current[i] = el;
                }}
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => setTwofaDigit(i, e.target.value)}
                disabled={loading}
                className="h-14 w-12 rounded-2xl border border-input bg-background text-center text-2xl font-semibold shadow-sm outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/40 disabled:opacity-50"
              />
            ))}
          </div>

          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
            />
            <span>Запомнить это устройство на 30 дней</span>
          </label>

          <button
            type="button"
            onClick={() => setStep("password")}
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            ← Вернуться к вводу пароля
          </button>
        </div>
      )}

      {step === "tg_code" && (
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
            {tgOtp.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  tgInputsRef.current[i] = el;
                }}
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => setTgDigit(i, e.target.value)}
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
