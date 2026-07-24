import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// VK ID App ID и redirect — приложение уровня «Публичное» (PKCE, секрет на
// клиенте не нужен). Домен и redirect должны совпадать с настройками VK ID.
const VK_APP_ID = 54650519;
const VK_REDIRECT_URL = "https://23podari.ru";

// VK ID SDK грузим с CDN только в браузере (SSR-safe). Один экземпляр на вкладку.
const VK_SDK_SRC = "https://unpkg.com/@vkid/sdk@2.6.0/dist-sdk/umd/index.js";

// Раньше вход шёл через новую вкладку + «callback»-режим (SDK сам сообщал
// результат основной странице через постороннюю коммуникацию между вкладками).
// Именно это ненадёжно работало в части браузеров (особенно Safari с его
// защитой от межвкладочного слежения) — окно зависало после «Разрешить».
// Теперь используем ConfigAuthMode.Redirect: переход происходит в ТОЙ ЖЕ
// вкладке (как у входа через Яндекс), без всплывающих окон и постороннего
// обмена сообщениями — такой способ одинаково работает в любом браузере.
const PKCE_VERIFIER_KEY = "cozygift_vk_pkce_verifier";
const PKCE_STATE_KEY = "cozygift_vk_pkce_state";

// SDK грузится с CDN (npm-пакет не ставим), поэтому типизируем по месту —
// только то, что реально используем из window.VKIDSDK.
type VkOneTap = {
  render: (opts: {
    container: HTMLElement;
    showAlternativeLogin?: boolean;
    styles?: { borderRadius?: number; height?: number };
  }) => VkOneTap;
  on: (event: unknown, cb: (data: never) => void) => VkOneTap;
  close?: () => void;
};

type VkidSdk = {
  Config: {
    init: (opts: {
      app: number;
      redirectUrl: string;
      mode?: unknown;
      codeVerifier?: string;
      state?: string;
      source?: unknown;
    }) => void;
  };
  ConfigAuthMode: { Redirect: unknown; InNewWindow: unknown };
  ConfigSource: { LOWCODE: unknown };
  OneTap: new () => VkOneTap;
  WidgetEvents: { ERROR: unknown };
  Auth: {
    exchangeCode: (
      code: string,
      deviceId: string,
    ) => Promise<{ access_token: string }>;
  };
};

declare global {
  interface Window {
    VKIDSDK?: VkidSdk;
  }
}

let sdkPromise: Promise<VkidSdk> | null = null;

function loadVkidSdk(): Promise<VkidSdk> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("VK ID SDK доступен только в браузере"));
  }
  if (window.VKIDSDK) return Promise.resolve(window.VKIDSDK);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<VkidSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = VK_SDK_SRC;
    script.async = true;
    script.onload = () => {
      if (window.VKIDSDK) resolve(window.VKIDSDK);
      else reject(new Error("VK ID SDK не инициализировался"));
    };
    script.onerror = () => reject(new Error("Не удалось загрузить VK ID SDK"));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

// Случайная строка для PKCE code_verifier/state — только разрешённые символы.
function randomPkceString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Разбирает query-параметры, которые VK ID кладёт при возврате из Redirect-режима. */
function readVkReturnParams(): { code: string; deviceId: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const deviceId = params.get("device_id");
  const state = params.get("state");
  if (!code || !deviceId) return null;
  const savedState = localStorage.getItem(PKCE_STATE_KEY);
  if (savedState && state !== savedState) {
    // Пришло что-то постороннее — не наш обмен, игнорируем молча.
    return null;
  }
  return { code, deviceId };
}

function clearVkReturnParams() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("device_id");
    url.searchParams.delete("type");
    window.history.replaceState({}, "", url.toString());
  } catch {
    /* noop */
  }
}

interface Props {
  // Получает VK access_token, должен выдать сессию (см. loginWithVk).
  onToken: (accessToken: string) => Promise<void>;
  // Компактный режим — виджет высотой 48px, чтобы встать в один ряд
  // с кнопками Telegram/Яндекс (вместо полноширинного варианта по умолчанию).
  compact?: boolean;
}

/**
 * Кнопка «Войти через VK» (One Tap). Переход на страницу VK и обратно в той
 * же вкладке (без попапов), после возврата меняет code на access_token.
 */
export function VkLoginButton({ onToken, compact = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;
    let oneTap: { close?: () => void } | null = null;
    let observer: MutationObserver | null = null;

    // Сначала проверяем: может, мы только что вернулись из VK ID (Redirect-
    // режим) — тогда сразу меняем code на токен, без отрисовки виджета.
    const pending = readVkReturnParams();

    loadVkidSdk()
      .then(async (VKID) => {
        if (cancelled) return;

        if (pending) {
          // Чистим URL и localStorage сразу — иначе перезагрузка страницы после
          // ошибки повторно триггерит тот же (уже недействительный) код.
          const codeVerifier = localStorage.getItem(PKCE_VERIFIER_KEY);
          localStorage.removeItem(PKCE_VERIFIER_KEY);
          localStorage.removeItem(PKCE_STATE_KEY);
          clearVkReturnParams();
          if (!codeVerifier) {
            setError("Сессия входа истекла — попробуйте ещё раз");
            setLoading(false);
            return;
          }
          VKID.Config.init({
            app: VK_APP_ID,
            redirectUrl: VK_REDIRECT_URL,
            codeVerifier,
          });
          try {
            const tokens = await VKID.Auth.exchangeCode(pending.code, pending.deviceId);
            await onTokenRef.current(tokens.access_token);
          } catch (err) {
            console.error("[vk-auth] EXCHANGE_FAILED", err);
            setError("Не удалось войти через VK");
          } finally {
            if (!cancelled) setLoading(false);
          }
          return;
        }

        if (!containerRef.current) return;

        const codeVerifier = randomPkceString(64);
        const state = randomPkceString(32);
        localStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
        localStorage.setItem(PKCE_STATE_KEY, state);

        VKID.Config.init({
          app: VK_APP_ID,
          redirectUrl: VK_REDIRECT_URL,
          mode: VKID.ConfigAuthMode.Redirect,
          codeVerifier,
          state,
          source: VKID.ConfigSource.LOWCODE,
        });

        oneTap = new VKID.OneTap();

        oneTap
          .render({
            container: containerRef.current,
            showAlternativeLogin: false,
            // Скругление 12px — как у кнопки «Войти через Telegram» (rounded-xl).
            // В компактном режиме высота 48px — вровень с соседними кнопками в ряду.
            styles: compact ? { borderRadius: 12, height: 48 } : { borderRadius: 12 },
          })
          .on(VKID.WidgetEvents.ERROR, (e: unknown) => {
            console.error("[vk-auth] WIDGET_ERROR", e);
            setError("Не удалось войти через VK");
          });

        // Сам виджет VK не растягивается на всю ширину родителя — рисует
        // только маленький квадратный значок и не занимает выделенное ему
        // место. Принудительно растягиваем то, что он вставил в контейнер
        // (и продолжаем следить — иногда содержимое подменяется чуть позже).
        if (containerRef.current) {
          const stretch = () => {
            const el = containerRef.current;
            if (!el) return;
            for (const child of Array.from(el.children)) {
              (child as HTMLElement).style.width = "100%";
            }
          };
          stretch();
          observer = new MutationObserver(stretch);
          observer.observe(containerRef.current, { childList: true, subtree: true });
        }

        setLoading(false);
      })
      .catch((e) => {
        console.error("[vk-auth] SDK_LOAD_FAILED", e);
        setError("VK ID недоступен");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      try {
        oneTap?.close?.();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full">
      {loading && !error && (
        <div
          className={`flex w-full items-center justify-center gap-1.5 rounded-xl border text-muted-foreground ${
            compact ? "h-12 text-[10px]" : "h-11 text-xs"
          }`}
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          {compact ? "VK…" : "Загружаем VK ID…"}
        </div>
      )}
      {/* overflow-hidden подрезает виджет VK ID под наше скругление — сам SDK
          не всегда точно слушается переданного borderRadius. */}
      <div
        className={`w-full overflow-hidden rounded-xl ${loading ? "hidden" : ""}`}
      >
        <div ref={containerRef} className="flex w-full justify-center" />
      </div>
      {error && (
        <p className={`text-center text-destructive ${compact ? "text-[10px]" : "text-xs"}`}>
          {compact ? "VK недоступен" : error}
        </p>
      )}
    </div>
  );
}
