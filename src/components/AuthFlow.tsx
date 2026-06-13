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
import {
  loginWithPassword,
  confirmDeviceCode,
} from "@/lib/password-auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  // --- Вход по паролю (логин = имя в Telegram) ---
  const loginPwdFn = useServerFn(loginWithPassword);
  const confirmCodeFn = useServerFn(confirmDeviceCode);
  const [savedUsername] = useState<string>(() => {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem("cozygift_tg_username") ?? "";
  });
  const [deviceId] = useState<string>(() => {
    if (typeof localStorage === "undefined") return "web-unknown";
    let d = localStorage.getItem("cozygift_device_id");
    if (!d) {
      d = crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random()}`;
      localStorage.setItem("cozygift_device_id", d);
    }
    return d;
  });
  const [pwUsername, setPwUsername] = useState(savedUsername);
  const [pwPassword, setPwPassword] = useState("");
  const [pwMode, setPwMode] = useState<"hidden" | "form" | "code">(
    savedUsername ? "form" : "hidden",
  );
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);

  const rememberUsername = (u?: string | null) => {
    const name = (u ?? pwUsername ?? "").replace(/^@/, "");
    if (name) {
      try {
        localStorage.setItem("cozygift_tg_username", name);
      } catch {
        /* noop */
      }
    }
  };

  const sessionAndDone = async (access: string, refresh: string) => {
    await setTelegramSession(access, refresh);
    const profile = await loadUser();
    if (!profile) throw new Error("Профиль не загружен");
    rememberUsername(profile.telegram_username);
    confetti({ particleCount: 140, spread: 90, origin: { y: 0.4 }, scalar: 1.1 });
    onAuthed(profile, false);
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwBusy(true);
    try {
      const res = await loginPwdFn({
        data: {
          username: pwUsername,
          password: pwPassword,
          device_id: deviceId,
          device_label: "Web",
        },
      });
      if (res.status === "ok") {
        await sessionAndDone(res.access_token, res.refresh_token);
      } else {
        setChallengeId(res.challenge_id);
        setPwMode("code");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      let text = "Не удалось войти";
      if (/INVALID_CREDENTIALS/.test(msg)) text = "Неверное имя или пароль";
      else if (/PASSWORD_NOT_SET/.test(msg))
        text = "Пароль ещё не задан — войди через Telegram и задай пароль в профиле";
      setPwError(text);
    } finally {
      setPwBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeId) return;
    setPwError(null);
    setPwBusy(true);
    try {
      const res = await confirmCodeFn({
        data: {
          challenge_id: challengeId,
          code,
          device_id: deviceId,
          device_label: "Web",
          remember: true,
        },
      });
      await sessionAndDone(res.access_token, res.refresh_token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      let text = "Не удалось подтвердить код";
      if (/WRONG_CODE/.test(msg)) text = "Неверный код";
      else if (/EXPIRED/.test(msg)) text = "Код истёк — попробуй ещё раз";
      setPwError(text);
    } finally {
      setPwBusy(false);
    }
  };

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
      rememberUsername(profile.telegram_username);
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

  // Готовим ссылку на бота ЗАРАНЕЕ (на загрузке экрана), чтобы тап по кнопке
  // открывал бота сразу, в рамках жеста пользователя — без блокировки Safari.
  const ensureLink = async () => {
    try {
      const referrer_id =
        typeof window !== "undefined"
          ? localStorage.getItem("cozygift_pending_ref")
          : null;
      const res = await startFn({ data: { referrer_id } });
      setNonce(res.nonce);
      setDeepLink(res.deep_link);
      startPolling(res.nonce);
    } catch {
      /* нет связи — кнопка-фолбэк вызовет startLogin по тапу */
    }
  };

  // Пользователь тапнул по «настоящей» ссылке-кнопке: бот уже открывается сам,
  // нам остаётся показать ожидание и слушать подтверждение.
  const onTapBotLink = () => {
    setPhase("waiting");
    setStatusText("Открой бота, нажми Start, затем ✅ Это я");
    if (nonce) startPolling(nonce);
  };

  // Фолбэк, если ссылка не подготовилась заранее (нет сети при загрузке).
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
    // сразу готовим свежую ссылку, чтобы кнопка снова открывала бота с одного тапа
    if (pwMode !== "form") void ensureLink();
  };

  // Если пользователь пришёл по ссылке t.me-бота (?login=<nonce>) —
  // сразу начинаем polling, не открывая новый deep-link.
  useEffect(() => {
    if (initialNonce) {
      setNonce(initialNonce);
      setPhase("waiting");
      setStatusText("Подтверди вход в боте");
      startPolling(initialNonce);
    } else if (pwMode !== "form") {
      // Заранее готовим ссылку на бота, чтобы первый тап открывал его сразу.
      void ensureLink();
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
            Выбери свой первый подарок 🎁
          </h1>
          <p className="text-balance text-sm text-muted-foreground">
            Один клик — подтверждение в Telegram-боте.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          {phase === "idle" && pwMode === "form" && (
            <form
              onSubmit={submitPassword}
              className="flex w-full flex-col gap-2 rounded-2xl bg-muted/40 p-4"
            >
              <p className="text-sm font-medium">
                С возвращением{savedUsername ? `, @${savedUsername}` : ""}! 💚
              </p>
              <Label htmlFor="pw-user" className="text-xs text-muted-foreground">
                Имя в Telegram
              </Label>
              <Input
                id="pw-user"
                name="username"
                autoComplete="username"
                value={pwUsername}
                onChange={(e) => setPwUsername(e.target.value.replace(/^@/, ""))}
                placeholder="username"
              />
              <Label htmlFor="pw-pass" className="text-xs text-muted-foreground">
                Пароль
              </Label>
              <Input
                id="pw-pass"
                name="password"
                type="password"
                autoComplete="current-password"
                value={pwPassword}
                onChange={(e) => setPwPassword(e.target.value)}
                placeholder="••••••••"
              />
              {pwError && <p className="text-xs text-destructive">{pwError}</p>}
              <Button
                type="submit"
                className="mt-1 w-full"
                disabled={pwBusy || !pwUsername || !pwPassword}
              >
                {pwBusy ? "Входим…" : "Войти"}
              </Button>
            </form>
          )}

          {phase === "idle" && pwMode === "code" && (
            <form
              onSubmit={submitCode}
              className="flex w-full flex-col gap-2 rounded-2xl bg-muted/40 p-4"
            >
              <p className="text-sm font-medium">Код из Telegram</p>
              <p className="text-xs text-muted-foreground">
                Это новое устройство — мы отправили 4-значный код в бота. Введи
                его один раз, чтобы запомнить устройство.
              </p>
              <Input
                inputMode="numeric"
                maxLength={4}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="1234"
              />
              {pwError && <p className="text-xs text-destructive">{pwError}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={pwBusy || code.length !== 4}
              >
                {pwBusy ? "Проверяем…" : "Подтвердить"}
              </Button>
            </form>
          )}

          {phase === "idle" && pwMode !== "code" && (
            deepLink ? (
              <Button
                asChild
                size="lg"
                variant={pwMode === "form" ? "outline" : "default"}
                className="w-full"
              >
                <a
                  href={deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onTapBotLink}
                >
                  {pwMode === "form"
                    ? "Войти через Telegram"
                    : "Авторизоваться через Телеграм"}
                </a>
              </Button>
            ) : (
              <Button
                size="lg"
                variant={pwMode === "form" ? "outline" : "default"}
                className="w-full"
                onClick={startLogin}
              >
                {pwMode === "form"
                  ? "Войти через Telegram"
                  : "Авторизоваться через Телеграм"}
              </Button>
            )
          )}

          {/* Вход по паролю доступен всегда — даже на новом устройстве,
              где имя ещё не сохранено. Так можно не заходить через бота. */}
          {phase === "idle" && pwMode === "hidden" && (
            <button
              type="button"
              onClick={() => setPwMode("form")}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Уже задавал пароль? Войти по паролю
            </button>
          )}
          {phase === "idle" && pwMode === "form" && !savedUsername && (
            <button
              type="button"
              onClick={() => setPwMode("hidden")}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              ← Войти через Telegram
            </button>
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
          <ShieldCheck className="h-3.5 w-3.5" /> Безопасно • через Telegram или по паролю
        </p>
      </div>
    </div>
  );
}
