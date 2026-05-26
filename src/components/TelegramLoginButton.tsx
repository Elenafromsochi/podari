import { useEffect, useRef } from "react";

const BOT_USERNAME = "Podari_podarki_bot";

export interface TelegramWidgetPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface Props {
  onAuth: (payload: TelegramWidgetPayload) => void;
}

declare global {
  interface Window {
    __podariTgOnAuth?: (user: TelegramWidgetPayload) => void;
  }
}

export function TelegramLoginButton({ onAuth }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Глобальный callback (виджет вызовет его по имени)
    window.__podariTgOnAuth = (user) => onAuth(user);

    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "__podariTgOnAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-userpic", "false");
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [onAuth]);

  return <div ref={containerRef} className="flex justify-center" />;
}
