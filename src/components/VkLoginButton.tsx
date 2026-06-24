import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// VK ID App ID и redirect — приложение уровня «Публичное» (PKCE, секрет на
// клиенте не нужен). Домен и redirect должны совпадать с настройками VK ID.
const VK_APP_ID = 54650519;
const VK_REDIRECT_URL = "https://23podari.ru";

// VK ID SDK грузим с CDN только в браузере (SSR-safe). Один экземпляр на вкладку.
const VK_SDK_SRC = "https://unpkg.com/@vkid/sdk@2.6.0/dist-sdk/umd/index.js";

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
      responseMode: unknown;
      source: unknown;
    }) => void;
  };
  ConfigResponseMode: { Callback: unknown };
  ConfigSource: { LOWCODE: unknown };
  OneTap: new () => VkOneTap;
  WidgetEvents: { ERROR: unknown };
  OneTapInternalEvents: { LOGIN_SUCCESS: unknown };
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

interface Props {
  // Получает VK access_token, должен выдать сессию (см. loginWithVk).
  onToken: (accessToken: string) => Promise<void>;
}

/**
 * Кнопка «Войти через VK» (One Tap). Рендерит виджет VK ID, после авторизации
 * меняет code на access_token (PKCE внутри SDK) и отдаёт токен наружу.
 */
export function VkLoginButton({ onToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let oneTap: { close?: () => void } | null = null;

    loadVkidSdk()
      .then((VKID) => {
        if (cancelled || !containerRef.current) return;

        VKID.Config.init({
          app: VK_APP_ID,
          redirectUrl: VK_REDIRECT_URL,
          responseMode: VKID.ConfigResponseMode.Callback,
          source: VKID.ConfigSource.LOWCODE,
        });

        oneTap = new VKID.OneTap();

        oneTap
          .render({
            container: containerRef.current,
            showAlternativeLogin: false,
            // Скругление 12px — как у кнопки «Войти через Telegram» (rounded-xl).
            styles: { borderRadius: 12 },
          })
          .on(VKID.WidgetEvents.ERROR, (e: unknown) => {
            console.error("[vk-auth] WIDGET_ERROR", e);
            setError("Не удалось войти через VK");
          })
          .on(
            VKID.OneTapInternalEvents.LOGIN_SUCCESS,
            async (data: { code: string; device_id: string }) => {
              try {
                setLoading(true);
                const tokens = await VKID.Auth.exchangeCode(
                  data.code,
                  data.device_id,
                );
                await onToken(tokens.access_token);
              } catch (err) {
                console.error("[vk-auth] EXCHANGE_FAILED", err);
                setError("Не удалось войти через VK");
              } finally {
                setLoading(false);
              }
            },
          );

        setLoading(false);
      })
      .catch((e) => {
        console.error("[vk-auth] SDK_LOAD_FAILED", e);
        setError("VK ID недоступен");
        setLoading(false);
      });

    return () => {
      cancelled = true;
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
      <div ref={containerRef} className="flex w-full justify-center" />
      {loading && !error && (
        <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаем VK ID…
        </p>
      )}
      {error && <p className="text-center text-xs text-destructive">{error}</p>}
    </div>
  );
}
