import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { ShieldCheck, Loader2, Gift, Send } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { loadUser, setTelegramSession, type UserProfile } from "@/lib/auth-state";
import {
  startTelegramLogin,
  pollTelegramLogin,
  completeTelegramLogin,
  loginWithTelegramWebApp,
} from "@/lib/telegram-auth.functions";
import {
  loginWithPassword,
  confirmDeviceCode,
} from "@/lib/password-auth.functions";
import { loginWithVk } from "@/lib/vk-auth.functions";
import { VkLoginButton } from "@/components/VkLoginButton";
import { loginWithYandex } from "@/lib/yandex-auth.functions";
import { YandexLoginButton, readYandexReturnToken } from "@/components/YandexLoginButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_VERSION } from "@/lib/version";
import { getPlatformStats } from "@/lib/stats.functions";
import { plural } from "@/lib/plural";

interface Props {
  onAuthed: (user: UserProfile, isNew: boolean) => void;
  initialNonce?: string | null;
}

// SDK грузится с CDN по требованию (см. эффект ниже) — типизируем по месту
// только то, что реально используем из window.Telegram.WebApp.
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
      };
    };
  }
}

type Phase = "idle" | "waiting" | "approved" | "signing_in";

// Незавершённый вход храним локально: на iPad Safari часто перезагружает
// вкладку, пока ты подтверждаешь вход в Telegram. После возврата приложение
// по сохранённому коду само продолжает ждать подтверждение и впускает.
const PENDING_LOGIN_KEY = "cozygift_pending_login";
const PENDING_LOGIN_TTL_MS = 5 * 60 * 1000;

function savePendingLogin(nonce: string, deepLink: string | null) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      PENDING_LOGIN_KEY,
      JSON.stringify({ nonce, deepLink, ts: Date.now() }),
    );
  } catch {
    /* noop */
  }
}

function readPendingLogin(): { nonce: string; deepLink: string | null } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PENDING_LOGIN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { nonce?: string; deepLink?: string | null; ts?: number };
    if (!v.nonce || !v.ts || Date.now() - v.ts > PENDING_LOGIN_TTL_MS) {
      localStorage.removeItem(PENDING_LOGIN_KEY);
      return null;
    }
    return { nonce: v.nonce, deepLink: v.deepLink ?? null };
  } catch {
    return null;
  }
}

function clearPendingLogin() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(PENDING_LOGIN_KEY);
  } catch {
    /* noop */
  }
}

export function AuthFlow({ onAuthed, initialNonce }: Props) {
  const startFn = useServerFn(startTelegramLogin);
  const pollFn = useServerFn(pollTelegramLogin);
  const completeFn = useServerFn(completeTelegramLogin);
  const webAppLoginFn = useServerFn(loginWithTelegramWebApp);

  const statsFn = useServerFn(getPlatformStats);
  const [stats, setStats] = useState<{ gifts: number; wishes: number } | null>(null);

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

  // --- Вход через VK ID (без VPN) ---
  const vkLoginFn = useServerFn(loginWithVk);
  const handleVkToken = async (accessToken: string) => {
    setPhase("signing_in");
    setStatusText("Входим через VK…");
    try {
      const referrer_id =
        typeof window !== "undefined"
          ? localStorage.getItem("cozygift_pending_ref")
          : null;
      const res = await vkLoginFn({
        data: { access_token: accessToken, referrer_id },
      });
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
      let text = "Не удалось войти через VK";
      if (msg.includes("VK_TOKEN_INVALID")) text = "VK не подтвердил вход — попробуй ещё раз";
      else if (msg.includes("VK_API_UNREACHABLE")) text = "VK временно недоступен";
      console.error("[AuthFlow] handleVkToken failed:", msg);
      toast.error(text, { description: msg, duration: 12000 });
      setPhase("idle");
      setStatusText("");
    }
  };

  // --- Вход через Яндекс (без VPN) ---
  const yandexLoginFn = useServerFn(loginWithYandex);
  const handleYandexToken = async (accessToken: string) => {
    setPhase("signing_in");
    setStatusText("Входим через Яндекс…");
    try {
      const referrer_id =
        typeof window !== "undefined" ? localStorage.getItem("cozygift_pending_ref") : null;
      const res = await yandexLoginFn({ data: { access_token: accessToken, referrer_id } });
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
      let text = "Не удалось войти через Яндекс";
      if (msg.includes("YANDEX_TOKEN_INVALID")) text = "Яндекс не подтвердил вход — попробуй ещё раз";
      else if (msg.includes("YANDEX_API_UNREACHABLE")) text = "Яндекс временно недоступен";
      console.error("[AuthFlow] handleYandexToken failed:", msg);
      toast.error(text, { description: msg, duration: 12000 });
      setPhase("idle");
      setStatusText("");
    }
  };

  // Возврат с Яндекса: если в URL пришёл #access_token — сразу входим.
  useEffect(() => {
    const token = readYandexReturnToken();
    if (token) handleYandexToken(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Открыто как Telegram Web App (кнопка меню бота, ссылки со startapp и
  // т.п.) — Telegram сам передаёт подписанные данные пользователя на
  // странице. Не нужно ни диплинка на бота, ни ожидания подтверждения —
  // входим сразу, автоматически, тем же человеком, что уже писал боту.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const run = async () => {
      if (!window.Telegram?.WebApp) {
        await new Promise<void>((resolve) => {
          const script = document.createElement("script");
          script.src = "https://telegram.org/js/telegram-web-app.js";
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => resolve();
          document.head.appendChild(script);
        });
      }
      if (cancelled) return;
      const tg = window.Telegram?.WebApp;
      const initData = tg?.initData;
      tg?.ready?.();
      if (!initData) return;

      setPhase("signing_in");
      setStatusText("Входим…");
      try {
        const res = await webAppLoginFn({ data: { init_data: initData } });
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
        // Тихий откат: человек ничего не нажимал, поэтому пугать ошибкой не
        // нужно — просто показываем обычный экран входа как раньше.
        console.error("[AuthFlow] TelegramWebApp auto-login failed:", e);
        if (!cancelled) {
          setPhase("idle");
          setStatusText("");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    // Бывает, что автозаполнение браузера показывает текст в полях, но не
    // синхронизирует его с состоянием React (особенно Safari на iPhone) —
    // кнопка при этом выглядела «мёртвой». Теперь она всегда нажимаема и
    // просто явно проверяет заполненность, вместо того чтобы молча ничего
    // не делать.
    if (!pwUsername.trim() || !pwPassword) {
      setPwError("Заполни имя и пароль");
      return;
    }
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
      clearPendingLogin();
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
      else if (msg.includes("NONCE_CONSUMED"))
        text = "Этот вход уже использован — начни заново";
      console.error("[AuthFlow] finishSignIn failed:", msg);
      // Показываем точную причину (код ошибки) — помогает диагностике.
      toast.error(text, { description: msg, duration: 15000 });
      reset();
    }
  };

  const startPolling = (n: string) => {
    deadlineRef.current = Date.now() + 5 * 60 * 1000;
    clearPolling();
    pollingRef.current = window.setInterval(async () => {
      if (Date.now() > deadlineRef.current) {
        clearPolling();
        clearPendingLogin();
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
          clearPendingLogin();
          setStatusText("Вход отклонён в боте. Попробуй ещё раз.");
          setPhase("idle");
        } else if (r.status === "expired" || r.status === "not_found") {
          clearPolling();
          clearPendingLogin();
          setStatusText("Ссылка истекла. Попробуй ещё раз.");
          setPhase("idle");
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
    setStatusText("Открой бота и нажми Start");
    if (nonce) {
      // запоминаем код входа, чтобы пережить перезагрузку вкладки после Telegram
      savePendingLogin(nonce, deepLink);
      startPolling(nonce);
    }
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
      savePendingLogin(res.nonce, res.deep_link);
      window.open(res.deep_link, "_blank", "noopener,noreferrer");
      setStatusText("Открой бота и нажми Start");
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
    clearPendingLogin();
    setPhase("idle");
    setNonce(null);
    setDeepLink(null);
    setStatusText("");
    // сразу готовим свежую ссылку, чтобы кнопка снова открывала бота с одного тапа
    if (pwMode !== "form") void ensureLink();
  };

  // Живой счётчик подарков/желаний для посадочной — без авторизации.
  useEffect(() => {
    let alive = true;
    statsFn()
      .then((s) => {
        if (alive) setStats(s);
      })
      .catch(() => {
        /* нет связи — просто не показываем счётчик */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Если пользователь пришёл по ссылке t.me-бота (?login=<nonce>) —
  // сразу начинаем polling, не открывая новый deep-link.
  useEffect(() => {
    if (initialNonce) {
      setNonce(initialNonce);
      setPhase("waiting");
      setStatusText("Подтверди вход в боте");
      startPolling(initialNonce);
      return () => clearPolling();
    }
    // Возврат из Telegram после перезагрузки вкладки: возобновляем
    // незавершённый вход по сохранённому коду — без повторного захода в бота.
    const pending = readPendingLogin();
    if (pending) {
      setNonce(pending.nonce);
      setDeepLink(pending.deepLink);
      setPhase("waiting");
      setStatusText("Подтверждаем вход… если ещё не подтвердил — открой бота");
      startPolling(pending.nonce);
    } else if (pwMode !== "form") {
      // Заранее готовим ссылку на бота, чтобы первый тап открывал его сразу.
      void ensureLink();
    }
    return () => clearPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNonce]);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-8">
      <div className="flex flex-1 flex-col gap-5">
        <div className="flex flex-col items-center gap-2.5 pt-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-peach shadow-sm">
            <Gift className="h-8 w-8 text-peach-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            ПОДАРИ — сервис для тех, кто любит ДАРИТЬ и ПОЛУЧАТЬ подарки 🎁
          </h1>
          <p className="text-balance text-sm text-muted-foreground">
            Выбирай подарки, загадывай желания и дари другим — бесплатно
            и рядом с тобой.
          </p>
        </div>

        {/* Короткая инфографика «что тут можно делать» — только на стартовом
            экране для новичков, чтобы сразу было понятно, зачем входить.
            Крупные эмодзи делают плашки живее и ярче. */}
        {phase === "idle" && pwMode === "hidden" && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="flex flex-col items-center gap-1 rounded-2xl bg-mint px-2 py-3.5 text-mint-foreground">
              <span className="text-[28px] leading-none">🎁</span>
              <span className="text-sm font-semibold">Получай</span>
              <span className="text-[11px] leading-tight opacity-80">
                Выбирай из предложенных
              </span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-2xl bg-lavender px-2 py-3.5 text-lavender-foreground">
              <span className="text-[28px] leading-none">🌟</span>
              <span className="text-sm font-semibold">Загадывай</span>
              <span className="text-[11px] leading-tight opacity-80">
                Желание — его исполнят
              </span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-2xl bg-peach px-2 py-3.5 text-peach-foreground">
              <span className="text-[28px] leading-none">💚</span>
              <span className="text-sm font-semibold">Дари</span>
              <span className="text-[11px] leading-tight opacity-80">
                И исполняй желания
              </span>
            </div>
          </div>
        )}

        {/* Живой счётчик-соцдоказательство: сколько подарков/желаний прямо
            сейчас на платформе. Пульсирующая точка добавляет ощущение «живого». */}
        {phase === "idle" && stats && stats.gifts > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center text-xs text-muted-foreground">
            <span className="relative mr-0.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Уже на платформе{" "}
            <span className="font-semibold text-foreground">{stats.gifts}</span>{" "}
            {plural(stats.gifts, ["подарок", "подарка", "подарков"])}
            {stats.wishes > 0 && (
              <>
                {" "}и{" "}
                <span className="font-semibold text-foreground">{stats.wishes}</span>{" "}
                {plural(stats.wishes, ["желание", "желания", "желаний"])}
              </>
            )}
          </div>
        )}

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
                onInput={(e) =>
                  setPwUsername((e.target as HTMLInputElement).value.replace(/^@/, ""))
                }
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
                onInput={(e) => setPwPassword((e.target as HTMLInputElement).value)}
                placeholder="••••••••"
              />
              {pwError && <p className="text-xs text-destructive">{pwError}</p>}
              <Button type="submit" className="mt-1 w-full" disabled={pwBusy}>
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

          {/* Вход: во время ожидания подтверждения в боте — одна крупная кнопка
              «Открыть Telegram ещё раз». В остальное время — три равных
              кнопки в один ряд (Telegram, VK, Яндекс) под подписью «Войти
              с помощью», без предпочтения одному способу над другими. */}
          {pwMode !== "code" && (phase === "idle" || phase === "waiting") && (
            <>
              {phase === "waiting" ? (
                <>
                  {deepLink ? (
                    <Button
                      asChild
                      size="lg"
                      className="w-full rounded-xl bg-[#229ED9] text-white shadow hover:bg-[#1b8ec2]"
                    >
                      <a
                        href={deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onTapBotLink}
                      >
                        Открыть Telegram ещё раз
                      </a>
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      className="w-full rounded-xl bg-[#229ED9] text-white shadow hover:bg-[#1b8ec2]"
                      onClick={startLogin}
                    >
                      Авторизоваться через Телеграм
                    </Button>
                  )}
                  <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Нажми Start в боте — вернёшься сюда автоматически 💚
                  </p>
                </>
              ) : (
                <>
                  <p className="text-center text-xs font-medium text-muted-foreground">
                    Войти с помощью
                  </p>
                  <div className="grid w-full grid-cols-3 gap-2">
                    {deepLink ? (
                      <a
                        href={deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onTapBotLink}
                        className="flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-xl bg-[#229ED9] text-white shadow-sm transition active:scale-[0.98] hover:brightness-105"
                      >
                        <Send className="h-4 w-4" />
                        <span className="text-[10px] font-medium leading-none">Telegram</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={startLogin}
                        className="flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-xl bg-[#229ED9] text-white shadow-sm transition active:scale-[0.98] hover:brightness-105"
                      >
                        <Send className="h-4 w-4" />
                        <span className="text-[10px] font-medium leading-none">Telegram</span>
                      </button>
                    )}
                    <VkLoginButton compact onToken={handleVkToken} />
                    <YandexLoginButton compact />
                  </div>
                </>
              )}
            </>
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

          {(phase === "approved" || phase === "signing_in") && (
            <div className="flex w-full items-center justify-center gap-2 rounded-2xl bg-muted/40 p-4 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin" />
              {statusText || "Входим…"}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Жмёшь кнопку → «Start» в боте → ты уже в «Подари» 💚
        </p>

        <p className="mt-auto flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Безопасно • через Telegram или по паролю
        </p>
        <p className="text-center text-[11px] text-muted-foreground/60">
          Подари · {APP_VERSION}
        </p>
      </div>
    </div>
  );
}
