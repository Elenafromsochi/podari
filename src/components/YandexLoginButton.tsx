// Вход через Яндекс — неявный OAuth: уводим на oauth.yandex.ru, оттуда Яндекс
// возвращает access_token во фрагменте URL (#access_token=...). Возврат ловит
// AuthFlow (см. handleYandexReturn) и меняет токен на supabase-сессию.
//
// Client ID берём из переменной окружения VITE_YANDEX_CLIENT_ID. Пока она не
// задана (приложение в Яндекс OAuth не зарегистрировано) — кнопка не
// показывается, чтобы не вести в никуда.

const YANDEX_CLIENT_ID = import.meta.env.VITE_YANDEX_CLIENT_ID as string | undefined;
const YANDEX_REDIRECT_URL =
  (import.meta.env.VITE_YANDEX_REDIRECT_URL as string | undefined) || "https://23podari.ru";

export const YANDEX_LOGIN_FLAG = "cozygift_yandex_login";

export function isYandexConfigured(): boolean {
  return !!YANDEX_CLIENT_ID;
}

export function YandexLoginButton() {
  if (!YANDEX_CLIENT_ID) return null;

  const start = () => {
    try {
      localStorage.setItem(YANDEX_LOGIN_FLAG, "1");
    } catch {
      /* noop */
    }
    const u = new URL("https://oauth.yandex.ru/authorize");
    u.searchParams.set("response_type", "token");
    u.searchParams.set("client_id", YANDEX_CLIENT_ID);
    u.searchParams.set("redirect_uri", YANDEX_REDIRECT_URL);
    window.location.href = u.toString();
  };

  return (
    <button
      type="button"
      onClick={start}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#FC3F1D] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] hover:brightness-105"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[13px] font-bold text-[#FC3F1D]">
        Я
      </span>
      Войти через Яндекс
    </button>
  );
}

/** Достаёт access_token из #фрагмента после возврата с Яндекса (или null). */
export function readYandexReturnToken(): string | null {
  if (typeof window === "undefined") return null;
  let flagged = false;
  try {
    flagged = localStorage.getItem(YANDEX_LOGIN_FLAG) === "1";
  } catch {
    /* noop */
  }
  if (!flagged) return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.includes("access_token=")) return null;
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  // Чистим флаг и фрагмент, чтобы не сработало повторно.
  try {
    localStorage.removeItem(YANDEX_LOGIN_FLAG);
  } catch {
    /* noop */
  }
  try {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    /* noop */
  }
  return token;
}
